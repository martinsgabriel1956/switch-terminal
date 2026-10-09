use std::collections::HashMap;
use std::io::{Read, Write};
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

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    if let Some(dir) = cwd.or_else(|| std::env::var("HOME").ok()) {
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
    fn busy(&self) -> Option<i32> {
        let fg = self.master.process_group_leader()?;
        let shell = self.child.process_id()? as i32;
        (fg != shell).then_some(fg)
    }

    fn kill(&mut self) {
        if let Some(pg) = self.busy() {
            unsafe { libc::killpg(pg, libc::SIGKILL) };
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


/// O que roda em primeiro plano em cada terminal (o estado RODANDO do painel): o nome do processo,
/// para a troca dizer o que vai encerrar ("npm run dev", "psql"). Só o shell, ou id desconhecido = None.
#[tauri::command]
pub fn pty_status(ptys: State<Ptys>, ids: Vec<u32>) -> Vec<Option<String>> {
    let map = ptys.map.lock().unwrap();
    ids.iter()
        .map(|id| {
            let pg = map.get(id).and_then(Pty::busy)?;
            Some(std::fs::read_to_string(format!("/proc/{pg}/comm")).map(|s| s.trim_end().to_owned()).unwrap_or_default())
        })
        .collect()
}

/// Abre o endereço do dev server no navegador padrão. Só http(s): o resto não sai do app.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("endereço inválido".into());
    }
    let mut child = std::process::Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?;
    // Recolhe o xdg-open quando ele sair, senão fica um zumbi por clique.
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// "Forçar agora" no aviso de troca: SIGKILL no que estiver rodando, sem esperar o prazo.
#[tauri::command]
pub fn pty_force(ptys: State<Ptys>, id: u32) {
    if let Some(pg) = ptys.busy(id) {
        unsafe { libc::killpg(pg, libc::SIGKILL) };
    }
}

#[tauri::command]
pub fn pty_kill_all(ptys: State<Ptys>) {
    ptys.kill_all();
}

/// Algum processo do grupo ainda existe? (sinal 0 só testa, não envia nada)
fn group_alive(pg: i32) -> bool {
    unsafe { libc::killpg(pg, 0) == 0 }
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
    unsafe { libc::killpg(pg, libc::SIGKILL) };
    // SIGKILL não pode ser ignorado; só espera o kernel terminar de derrubar (e soltar as portas).
    for _ in 0..20 {
        if !group_alive(pg) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(true)
}
