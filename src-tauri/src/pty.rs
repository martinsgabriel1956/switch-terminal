use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys {
    next_id: AtomicU32,
    map: Mutex<HashMap<u32, Pty>>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
pub fn pty_spawn(
    ptys: State<Ptys>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| e.to_string())?;

    #[cfg(unix)]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    // O cmd, e não o PowerShell: o 5.1 (o que vem no Windows) não aceita o "&&" da linha do start.
    #[cfg(windows)]
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    if let Some(dir) = cwd.or_else(|| std::env::home_dir().map(|h| h.to_string_lossy().into_owned())) {
        cmd.cwd(dir);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Bytes crus via Channel chegam como ArrayBuffer no JS; o xterm decodifica UTF-8 partido entre chunks.
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let id = ptys.next_id.fetch_add(1, Ordering::Relaxed);
    ptys.map.lock().unwrap().insert(id, Pty { master: pair.master, writer, child });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(ptys: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut map = ptys.map.lock().unwrap();
    let pty = map.get_mut(&id).ok_or("pty não encontrado")?;
    pty.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(ptys: State<Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = ptys.map.lock().unwrap();
    let pty = map.get(&id).ok_or("pty não encontrado")?;
    pty.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

impl Pty {
    /// Grupo em primeiro plano, se não for o próprio shell (ou seja, algo está rodando).
    #[cfg(unix)]
    fn busy(&self) -> Option<i32> {
        let fg = self.master.process_group_leader()?;
        let shell = self.child.process_id()? as i32;
        (fg != shell).then_some(fg)
    }

    /// No Windows não há grupo em primeiro plano: o que roda é o filho do shell, e o "grupo" é a árvore dele.
    #[cfg(windows)]
    fn busy(&self) -> Option<i32> {
        let shell = self.child.process_id()?;
        win::procs().into_iter().find(|p| p.parent == shell).map(|p| p.id as i32)
    }

    fn kill(&mut self) {
        if let Some(pg) = self.busy() {
            kill_group(pg);
        }
        let _ = self.child.kill();
    }
}

impl Ptys {
    fn busy(&self, id: u32) -> Option<i32> {
        self.map.lock().unwrap().get(&id).and_then(Pty::busy)
    }

    pub fn any_busy(&self) -> bool {
        self.map.lock().unwrap().values().any(|p| p.busy().is_some())
    }

    pub fn kill_all(&self) {
        for (_, mut pty) in self.map.lock().unwrap().drain() {
            pty.kill();
        }
    }
}

#[tauri::command]
pub fn pty_kill(ptys: State<Ptys>, id: u32) {
    if let Some(mut pty) = ptys.map.lock().unwrap().remove(&id) {
        pty.kill();
    }
}


/// O que roda em primeiro plano em cada terminal (o estado RODANDO do painel; no SUBINDO, a porta vem do `ports_open`): o nome do processo,
/// para a troca dizer o que vai encerrar ("npm run dev", "psql"). Só o shell, ou id desconhecido = None.
#[tauri::command]
pub fn pty_status(ptys: State<Ptys>, ids: Vec<u32>) -> Vec<Option<String>> {
    let map = ptys.map.lock().unwrap();
    ids.iter()
        .map(|id| {
            let pg = map.get(id).and_then(Pty::busy)?;
            Some(group_name(pg))
        })
        .collect()
}

/// A porta aceita conexão TCP em localhost? IPv4 e depois IPv6: o Node 17+ resolve "localhost" para ::1, e o dev server
/// pode escutar só nele. Recusa em localhost é imediata; o timeout curto cobre o resto.
fn port_open(port: u16) -> bool {
    let timeout = Duration::from_millis(150);
    [SocketAddr::from((Ipv4Addr::LOCALHOST, port)), SocketAddr::from((Ipv6Addr::LOCALHOST, port))]
        .iter()
        .any(|addr| TcpStream::connect_timeout(addr, timeout).is_ok())
}

/// O SUBINDO de um lado com porta conhecida só vira RODANDO quando ela atende. Uma thread por porta, fora da thread
/// principal (comando async) e fora do `pty_status`, que não espera por isso.
#[tauri::command]
pub async fn ports_open(ports: Vec<u16>) -> Vec<bool> {
    std::thread::scope(|s| {
        let checks: Vec<_> = ports.iter().map(|&p| s.spawn(move || port_open(p))).collect();
        checks.into_iter().map(|c| c.join().unwrap_or(false)).collect()
    })
}

/// Abre o endereço do dev server, ou um link clicado no terminal, no navegador padrão. Só http(s): o resto não sai do app.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("endereço inválido".into());
    }
    open_default(&url)
}

/// Abre no programa padrão do sistema (navegador, editor do .json).
pub fn open_default(target: &str) -> Result<(), String> {
    #[cfg(unix)]
    let opener = "xdg-open";
    #[cfg(windows)]
    let opener = "explorer.exe";
    let mut child = std::process::Command::new(opener).arg(target).spawn().map_err(|e| e.to_string())?;
    // Recolhe o processo quando ele sair, senão fica um zumbi por clique.
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// Notificação do sistema (um lado caiu com a janela escondida ou sem foco). Sem `notify-send`, não faz nada.
#[tauri::command]
pub fn notify(summary: String, body: String) {
    let cmd = std::process::Command::new("notify-send").args(["--app-name=Hotswap", "--icon=hotswap", "--", &summary, &body]).spawn();
    if let Ok(mut child) = cmd {
        std::thread::spawn(move || child.wait());
    }
}

/// "Forçar agora" no aviso de troca: SIGKILL no que estiver rodando, sem esperar o prazo.
#[tauri::command]
pub fn pty_force(ptys: State<Ptys>, id: u32) {
    if let Some(pg) = ptys.busy(id) {
        kill_group(pg);
    }
}

#[tauri::command]
pub fn pty_kill_all(ptys: State<Ptys>) {
    ptys.kill_all();
}

/// Algum processo do grupo ainda existe? (sinal 0 só testa, não envia nada)
#[cfg(unix)]
fn group_alive(pg: i32) -> bool {
    unsafe { libc::killpg(pg, 0) == 0 }
}

#[cfg(unix)]
fn kill_group(pg: i32) {
    unsafe { libc::killpg(pg, libc::SIGKILL) };
}

/// Nome do processo, para a troca dizer o que vai encerrar.
#[cfg(unix)]
fn group_name(pg: i32) -> String {
    std::fs::read_to_string(format!("/proc/{pg}/comm")).map(|s| s.trim_end().to_owned()).unwrap_or_default()
}

#[cfg(windows)]
fn group_alive(pg: i32) -> bool {
    !win::tree(pg as u32).is_empty()
}

#[cfg(windows)]
fn kill_group(pg: i32) {
    win::tree(pg as u32).into_iter().for_each(win::kill);
}

#[cfg(windows)]
fn group_name(pg: i32) -> String {
    win::procs().into_iter().find(|p| p.id == pg as u32).map(|p| p.name).unwrap_or_default()
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    pub struct Proc {
        pub id: u32,
        pub parent: u32,
        pub name: String,
    }

    /// Todos os processos do sistema, com o pai e o nome do executável ("node.exe").
    pub fn procs() -> Vec<Proc> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return out;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e);
            while ok != 0 {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                out.push(Proc { id: e.th32ProcessID, parent: e.th32ParentProcessID, name: String::from_utf16_lossy(&e.szExeFile[..len]) });
                ok = Process32NextW(snap, &mut e);
            }
            CloseHandle(snap);
        }
        out
    }

    /// `root` e os descendentes que ainda existem. O Windows não reatribui o pai de quem fica órfão: o neto
    /// (o next-server do npm) continua apontando para o filho que já saiu, e ainda entra aqui.
    /// ponytail: pid reaproveitado pelo sistema pode entrar como descendente; raro no tempo de uma troca.
    pub fn tree(root: u32) -> Vec<u32> {
        let ps = procs();
        let mut ids = vec![root];
        let mut i = 0;
        while i < ids.len() {
            let kids: Vec<u32> = ps.iter().filter(|p| p.parent == ids[i] && !ids.contains(&p.id)).map(|p| p.id).collect();
            ids.extend(kids);
            i += 1;
        }
        ids.retain(|id| ps.iter().any(|p| p.id == *id));
        ids
    }

    pub fn kill(pid: u32) {
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !h.is_null() {
                TerminateProcess(h, 1);
                CloseHandle(h);
            }
        }
    }
}

/// Ctrl+C no grupo em primeiro plano e espera **o grupo inteiro** morrer (não só o shell voltar):
/// o `next-server` é neto do `npm` e pode segurar a porta depois que o npm sai.
/// Estourou `timeout_ms`: SIGKILL no grupo. Retorna se precisou forçar.
#[tauri::command]
pub async fn pty_stop(ptys: State<'_, Ptys>, id: u32, timeout_ms: u64) -> Result<bool, String> {
    let Some(pg) = ptys.busy(id) else { return Ok(false) };
    if let Some(pty) = ptys.map.lock().unwrap().get_mut(&id) {
        pty.writer.write_all(b"\x03").map_err(|e| e.to_string())?;
    }
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if !group_alive(pg) {
            return Ok(false);
        }
    }
    kill_group(pg);
    // SIGKILL não pode ser ignorado; só espera o kernel terminar de derrubar (e soltar as portas).
    for _ in 0..20 {
        if !group_alive(pg) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_open_only_while_listening() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_open(port));
        assert_eq!(tauri::async_runtime::block_on(ports_open(vec![port, port])), vec![true, true]);
        drop(listener);
        assert!(!port_open(port));
    }
}
