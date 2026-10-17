use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default = "default_timeout")]
    stop_timeout_ms: u64,
    /// Liga o modo leitor de tela do xterm (a saída dos terminais vira texto acessível; custa desempenho).
    #[serde(default)]
    screen_reader: bool,
    /// "code", "zed", "code -n": roda com a pasta da aba visível no fim (Ctrl+Shift+O).
    editor_command: Option<String>,
    /// Escolhido em "Abrir com…": o id do .desktop ("dev.zed.Zed.desktop"). Vale antes do `editor_command`.
    editor: Option<String>,
    projects: Vec<ProjectCfg>,
}

fn default_timeout() -> u64 {
    5000
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCfg {
    name: String,
    api: SideCfg,
    front: SideCfg,
    #[serde(default)]
    manual_pairs: Vec<Pair>,
    base_branch: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SideCfg {
    repo: String,
    start_command: Option<String>,
    setup_command: Option<String>,
    /// Start próprio de uma branch ("feat/x": "npm run dev:mock"); a que não está aqui usa o `start_command`.
    #[serde(default)]
    branch_commands: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Pair {
    api: String,
    front: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    stop_timeout_ms: u64,
    screen_reader: bool,
    projects: Vec<ProjectView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    name: String,
    error: Option<String>,
    worktrees: Vec<WorktreeView>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct WorktreeView {
    id: String,
    label: String,
    api: Option<SideView>,
    front: Option<SideView>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SideView {
    path: String,
    /// O que sobe: o da branch, senão o do projeto.
    start_command: Option<String>,
    setup_command: Option<String>,
    /// O do projeto, para o diálogo de edição mostrar o padrão e saber se a branch tem um próprio.
    project_start: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Wt {
    branch: String,
    path: String,
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

fn expand(p: &str) -> String {
    match p.strip_prefix("~/") {
        Some(rest) => format!("{}/{}", home(), rest),
        None => p.to_string(),
    }
}

pub fn config_path() -> String {
    format!("{}/.config/hotswap/config.json", home())
}

/// "Abrir o config.json" no projeto com erro: abre no editor padrão do sistema.
#[tauri::command]
pub fn open_config() -> Result<(), String> {
    let mut child = std::process::Command::new("xdg-open").arg(config_path()).spawn().map_err(|e| e.to_string())?;
    // Recolhe o xdg-open quando ele sair, senão fica um zumbi por clique.
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// "code -n" + pasta → ("code", ["-n", pasta]). Vazio = sem editor.
/// ponytail: separa por espaço, sem aspas nem `$VAR`; programa com espaço no caminho precisa de um link sem espaço.
fn editor_argv(cmd: &str, dir: &str) -> Option<(String, Vec<String>)> {
    let mut parts = cmd.split_whitespace();
    let program = expand(parts.next()?);
    Some((program, parts.map(String::from).chain([dir.to_string()]).collect()))
}

/// Editor de interface gráfica pelas categorias do .desktop; os de terminal (Vim) ficam de fora.
fn is_editor(categories: &str, terminal: bool) -> bool {
    !terminal && categories.split(';').any(|c| c == "TextEditor" || c == "IDE")
}

#[derive(Serialize)]
pub struct Editor {
    id: String,
    name: String,
}

#[derive(Serialize)]
pub struct Editors {
    editors: Vec<Editor>,
    chosen: Option<String>,
    command: Option<String>,
}

/// "Abrir com…": os editores instalados, relidos a cada abertura (o que foi instalado depois aparece sem reiniciar).
/// O GIO lê os .desktop das pastas do XDG (Flatpak e Snap inclusos), já sem os ocultos, e dá o nome no idioma do sistema.
#[tauri::command]
pub fn list_editors() -> Result<Editors, String> {
    use gio::prelude::*;
    let cfg = read_config()?;
    let mut editors: Vec<Editor> = gio::AppInfo::all()
        .into_iter()
        .filter(|a| a.should_show())
        .filter_map(|a| a.downcast::<gio::DesktopAppInfo>().ok())
        .filter(|d| is_editor(d.categories().as_deref().unwrap_or(""), d.boolean("Terminal")))
        .filter_map(|d| Some(Editor { id: d.id()?.to_string(), name: d.name().to_string() }))
        .collect();
    editors.sort_by_key(|e| e.name.to_lowercase());
    let command = cfg.editor_command.filter(|c| !c.trim().is_empty());
    Ok(Editors { editors, chosen: cfg.editor, command })
}

/// Grava a escolha do "Abrir com…" (None: volta ao `editorCommand`) sem mexer no resto do config.
#[tauri::command]
pub fn set_editor(id: Option<String>) -> Result<(), String> {
    let path = config_path();
    let mut cfg = read_config_json(&path)?;
    let root = cfg.as_object_mut().ok_or(format!("{path}: a raiz precisa ser um objeto."))?;
    match id {
        Some(id) => root.insert("editor".into(), id.into()),
        None => root.remove("editor"),
    };
    write_config_json(&path, &cfg)
}

/// Ctrl+Shift+O: abre a pasta no editor escolhido em "Abrir com…" (pelo GIO, como o menu do sistema), senão no
/// `editorCommand`, solto do app (grupo de processos próprio, sem esperar). Lê o config na hora: quem acabou de definir
/// o campo não precisa reler. Ok(false): nenhum dos dois.
#[tauri::command]
pub fn open_in_editor(path: String) -> Result<bool, String> {
    use gio::prelude::*;
    use std::os::unix::process::CommandExt;
    let cfg = read_config()?;
    if let Some(id) = cfg.editor.as_deref() {
        let app = gio::DesktopAppInfo::new(id).ok_or(format!("{id}: não está mais instalado"))?;
        app.launch(&[gio::File::for_path(&path)], None::<&gio::AppLaunchContext>).map_err(|e| format!("{}: {e}", app.name()))?;
        return Ok(true);
    }
    let Some((program, args)) = editor_argv(cfg.editor_command.as_deref().unwrap_or(""), &path) else { return Ok(false) };
    let mut child = Command::new(&program).args(args).process_group(0).spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("{program}: não encontrado"),
        _ => format!("{program}: {e}"),
    })?;
    // Recolhe o processo quando ele sair, senão fica um zumbi por abertura.
    std::thread::spawn(move || child.wait());
    Ok(true)
}

/// Saída de `git worktree list --porcelain`: blocos separados por linha em branco.
fn parse_porcelain(out: &str) -> Vec<Wt> {
    out.split("\n\n")
        .filter_map(|block| {
            let mut path = None;
            let mut branch = None;
            for line in block.lines() {
                // bare: o repo em si; prunable: a pasta da worktree não existe mais.
                if line == "bare" || line.starts_with("prunable") {
                    return None;
                }
                if let Some(p) = line.strip_prefix("worktree ") {
                    path = Some(p.to_string());
                }
                if let Some(b) = line.strip_prefix("branch refs/heads/") {
                    branch = Some(b.to_string());
                }
            }
            let path = path?;
            // Detached HEAD: usa o nome da pasta como "branch".
            let branch = branch.unwrap_or_else(|| path.rsplit('/').next().unwrap_or(&path).to_string());
            Some(Wt { branch, path })
        })
        .collect()
}

/// Pares manuais primeiro, depois pelo nome exato da branch; o que sobra vira solo.
fn pair(api: Vec<Wt>, front: Vec<Wt>, manual: &[Pair]) -> Vec<(Option<Wt>, Option<Wt>)> {
    let mut fronts: HashMap<String, Wt> = front.iter().map(|w| (w.branch.clone(), w.clone())).collect();
    let manual: HashMap<&str, &str> = manual.iter().map(|p| (p.api.as_str(), p.front.as_str())).collect();

    let mut out: Vec<(Option<Wt>, Option<Wt>)> = api
        .into_iter()
        .map(|a| {
            let f = manual
                .get(a.branch.as_str())
                .and_then(|fb| fronts.remove(*fb))
                .or_else(|| fronts.remove(&a.branch));
            (Some(a), f)
        })
        .collect();
    // Solos do front na ordem original do git.
    out.extend(front.into_iter().filter(|f| fronts.contains_key(&f.branch)).map(|f| (None, Some(f))));
    out
}

fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git").arg("-C").arg(repo).args(args).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("{}: {}", repo, String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_worktrees(repo: &str) -> Result<Vec<Wt>, String> {
    git(repo, &["worktree", "list", "--porcelain"]).map(|out| parse_porcelain(&out))
}

/// "Ler worktrees" no formulário de novo projeto: o que o app vai encontrar no repositório escolhido.
#[tauri::command]
pub fn list_worktrees(repo: String) -> Result<Vec<Wt>, String> {
    let repo = expand(repo.trim()).trim_end_matches('/').to_string();
    if repo.is_empty() {
        return Err("Escolha a pasta do repositório.".into());
    }
    git_worktrees(&repo)
}

/// Estado do git de uma pasta: arquivos alterados (rastreados), não rastreados e commits à frente/atrás do upstream.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct GitStatus {
    changed: u32,
    untracked: u32,
    ahead: u32,
    behind: u32,
}

/// Saída de `git status --porcelain=v2 --branch`: cabeçalhos `# branch.*` e uma linha por arquivo
/// (`1`/`2` alterado ou renomeado, `u` em conflito, `?` não rastreado). Sem upstream não há `# branch.ab`.
fn parse_status(out: &str) -> GitStatus {
    let mut s = GitStatus::default();
    for line in out.lines() {
        match line.split_once(' ') {
            Some(("1" | "2" | "u", _)) => s.changed += 1,
            Some(("?", _)) => s.untracked += 1,
            Some(("#", h)) => {
                if let Some((a, b)) = h.strip_prefix("branch.ab ").and_then(|ab| ab.split_once(' ')) {
                    s.ahead = a.trim_start_matches('+').parse().unwrap_or(0);
                    s.behind = b.trim_start_matches('-').parse().unwrap_or(0);
                }
            }
            _ => {}
        }
    }
    s
}

/// Estado do git de cada pasta, na ordem pedida (`None` onde o git falhou). Um processo por pasta, em paralelo: com
/// muitas worktrees a releitura leva o tempo da mais lenta. `--no-optional-locks`: ler não disputa o index.lock com o
/// git do terminal.
#[tauri::command]
pub async fn git_status(paths: Vec<String>) -> Vec<Option<GitStatus>> {
    std::thread::scope(|s| {
        let runs: Vec<_> = paths
            .iter()
            .map(|p| s.spawn(move || git(p, &["--no-optional-locks", "status", "--porcelain=v2", "--branch"]).ok().map(|o| parse_status(&o))))
            .collect();
        runs.into_iter().map(|r| r.join().ok().flatten()).collect()
    })
}

/// A saída do `git pull` diz se avançou: "Already up to date." quando não (antes do git 2.17, "Already up-to-date.").
fn pulled(stdout: &str) -> bool {
    !stdout.contains("Already up to date") && !stdout.contains("Already up-to-date")
}

/// `git pull --ff-only` numa pasta: `Ok(true)` se avançou, `Ok(false)` se já estava em dia, `Err` com a saída crua.
/// `LC_ALL=C`: a saída é lida (`pulled`) e o front resume o erro pelo texto em inglês. `GIT_TERMINAL_PROMPT=0`: sem
/// terminal, um pedido de senha do https seguraria o pull para sempre.
fn pull_one(path: &str) -> Result<bool, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["pull", "--ff-only"])
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err });
    }
    Ok(pulled(&String::from_utf8_lossy(&out.stdout)))
}

/// "Atualizar (pull)": um pull por lado da worktree, em paralelo (cada um espera a rede), na ordem pedida.
#[tauri::command]
pub async fn pull_worktree(paths: Vec<String>) -> Vec<Result<bool, String>> {
    std::thread::scope(|s| {
        let runs: Vec<_> = paths.iter().map(|p| s.spawn(move || pull_one(p))).collect();
        runs.into_iter().map(|r| r.join().unwrap_or_else(|_| Err("o git pull não terminou".into()))).collect()
    })
}

fn side(w: &Option<Wt>, cfg: &SideCfg) -> Option<SideView> {
    w.as_ref().map(|w| SideView {
        path: w.path.clone(),
        start_command: cfg.branch_commands.get(&w.branch).cloned().or_else(|| cfg.start_command.clone()),
        setup_command: cfg.setup_command.clone(),
        project_start: cfg.start_command.clone(),
    })
}

fn view(p: &ProjectCfg, pairs: Vec<(Option<Wt>, Option<Wt>)>) -> Vec<WorktreeView> {
    pairs
        .into_iter()
        .map(|(a, f)| {
            let ab = a.as_ref().map(|w| w.branch.as_str()).unwrap_or("");
            let fb = f.as_ref().map(|w| w.branch.as_str()).unwrap_or("");
            let label = match (ab, fb) {
                ("", x) | (x, "") => x.to_string(),
                (x, y) if x == y => x.to_string(),
                (x, y) => format!("{x} ↔ {y}"),
            };
            WorktreeView { id: format!("{ab}|{fb}"), label, api: side(&a, &p.api), front: side(&f, &p.front) }
        })
        .collect()
}

fn read_config() -> Result<Config, String> {
    let path = config_path();
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("Não consegui ler {path}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("{path} inválido: {e}"))
}

#[tauri::command]
pub fn load_config() -> Result<ConfigView, String> {
    let cfg = read_config()?;

    let projects = cfg
        .projects
        .iter()
        .map(|p| {
            let (error, worktrees) = match (git_worktrees(&expand(&p.api.repo)), git_worktrees(&expand(&p.front.repo))) {
                (Ok(a), Ok(f)) => (None, view(p, pair(a, f, &p.manual_pairs))),
                (Err(e), _) => (Some(format!("API: {e}")), vec![]),
                (_, Err(e)) => (Some(format!("Front: {e}")), vec![]),
            };
            ProjectView { name: p.name.clone(), error, worktrees }
        })
        .collect();

    Ok(ConfigView { stop_timeout_ms: cfg.stop_timeout_ms, screen_reader: cfg.screen_reader, projects })
}

/// Pasta padrão das worktrees: repo bare (`repo/.bare` + uma pasta por branch) → `repo/`; repo normal → `<repo>.worktrees/`.
fn default_dir(repo: &str) -> Result<PathBuf, String> {
    let bare = git(repo, &["config", "--bool", "core.bare"]).unwrap_or_default() == "true";
    if bare {
        let common = git(repo, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
        Ok(Path::new(&common).parent().ok_or("repo sem pasta pai")?.to_path_buf())
    } else {
        Ok(PathBuf::from(format!("{}.worktrees", repo.trim_end_matches('/'))))
    }
}

/// (locais, remotas), sem os `origin/HEAD`.
fn branches(repo: &str) -> Result<(Vec<String>, Vec<String>), String> {
    let out = git(repo, &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])?;
    let (mut local, mut remote) = (vec![], vec![]);
    for r in out.lines() {
        if let Some(b) = r.strip_prefix("refs/heads/") {
            local.push(b.to_string());
        } else if let Some(b) = r.strip_prefix("refs/remotes/") {
            if !b.ends_with("/HEAD") {
                remote.push(b.to_string());
            }
        }
    }
    Ok((local, remote))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideDefaults {
    dir: String,
    local: Vec<String>,
    remote: Vec<String>,
    default_base: String,
}

#[derive(Serialize)]
pub struct WorktreeDefaults {
    api: Result<SideDefaults, String>,
    front: Result<SideDefaults, String>,
}

fn side_defaults(side: &SideCfg, base_branch: &Option<String>) -> Result<SideDefaults, String> {
    let repo = expand(&side.repo);
    let (local, remote) = branches(&repo)?;
    let default_base = [base_branch.as_deref(), Some("main"), Some("master")]
        .into_iter()
        .flatten()
        .find(|b| local.iter().any(|x| x == b))
        .map(str::to_string)
        .or_else(|| local.first().or(remote.first()).cloned())
        .unwrap_or_default();
    Ok(SideDefaults { dir: default_dir(&repo)?.to_string_lossy().into(), local, remote, default_base })
}

/// Valores iniciais do formulário de nova worktree: pasta padrão e branches de cada repo.
#[tauri::command]
pub async fn worktree_defaults(project: String) -> Result<WorktreeDefaults, String> {
    let cfg = read_config()?;
    let p = cfg.projects.iter().find(|p| p.name == project).ok_or("projeto não encontrado")?;
    Ok(WorktreeDefaults { api: side_defaults(&p.api, &p.base_branch), front: side_defaults(&p.front, &p.base_branch) })
}

/// Erro de formulário: `side` aponta o bloco do campo culpado ("api"/"front"); `created` lista o que já deu certo.
#[derive(Serialize, Debug)]
pub struct FormError {
    side: Option<&'static str>,
    message: String,
    created: Vec<&'static str>,
}

impl FormError {
    fn general(message: impl Into<String>) -> Self {
        FormError { side: None, message: message.into(), created: vec![] }
    }
}

/// Cria `<dir>/<branch>`. Branch que já existe (local ou `origin/<branch>`) é reaproveitada e `base` é ignorada.
/// Retorna se criou a branch (desfazer uma edição apaga só o que ela criou).
fn add_one(repo: &str, dir: &str, branch: &str, base: &str) -> Result<bool, String> {
    // Também barra "..", espaços etc.: o nome vira caminho no disco.
    git(repo, &["check-ref-format", "--branch", branch])?;
    let dir = expand(dir.trim());
    if !Path::new(&dir).is_absolute() {
        return Err(format!("diretório precisa ser um caminho absoluto: {dir}"));
    }
    let path = Path::new(&dir).join(branch);
    let path = path.to_str().ok_or("caminho inválido")?;
    let has = |r: &str| git(repo, &["rev-parse", "--verify", "--quiet", r]).is_ok();
    if has(&format!("refs/heads/{branch}")) {
        git(repo, &["worktree", "add", path, branch])?;
        Ok(false)
    } else if has(&format!("refs/remotes/origin/{branch}")) {
        // Explícito: o palpite do git (`worktree add <path> <branch>`) e o `--track` precisam do fetch das remotas
        // configurado no origin, e um bare clonado fora do app não tem. Com ele, o upstream vem do autoSetupMerge.
        git(repo, &["worktree", "add", "-b", branch, path, &format!("origin/{branch}")])?;
        Ok(true)
    } else {
        if base.is_empty() {
            return Err("escolha a branch de origem".into());
        }
        git(repo, &["worktree", "add", "-b", branch, path, base])?;
        Ok(true)
    }
}

/// `origin/<branch>` atualizada (refspec explícito: um bare clonado fora do app não tem o fetch das remotas configurado).
fn fetch_branch(repo: &str, branch: &str) -> Result<String, String> {
    // Valida antes: o nome entra no refspec.
    git(repo, &["check-ref-format", "--branch", branch])?;
    git(repo, &["fetch", "-q", "origin", &format!("+refs/heads/{branch}:refs/remotes/origin/{branch}")])
}

#[derive(Deserialize)]
pub struct SideRequest {
    dir: String,
    base: String,
    /// A branch é de uma PR aberta neste lado: busca `origin/<branch>` antes, para ela ser reaproveitada.
    #[serde(default)]
    fetch: bool,
}

/// Cria a worktree na API, no front ou nos dois. async: o checkout pode demorar e não deve travar a UI.
#[tauri::command]
pub async fn add_worktree(project: String, branch: String, api: Option<SideRequest>, front: Option<SideRequest>) -> Result<(), FormError> {
    let cfg = read_config().map_err(FormError::general)?;
    let p = cfg.projects.iter().find(|p| p.name == project).ok_or(FormError::general("Projeto não encontrado."))?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(FormError::general("Informe o nome da branch."));
    }
    if api.is_none() && front.is_none() {
        return Err(FormError::general("Marque API, Front ou os dois."));
    }
    let mut created = vec![];
    for (req, key, side) in [(api, "api", &p.api), (front, "front", &p.front)] {
        let Some(req) = req else { continue };
        let repo = expand(&side.repo);
        let fetched = if req.fetch { fetch_branch(&repo, branch).map(|_| ()) } else { Ok(()) };
        if let Err(message) = fetched.and_then(|_| add_one(&repo, &req.dir, branch, req.base.trim())) {
            return Err(FormError { side: Some(key), message, created });
        }
        created.push(key);
    }
    Ok(())
}

// ---------- editar worktree ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideInfo {
    /// Pasta principal de um repo não-bare: o git não a move.
    main: bool,
    /// "origin/feat/x" quando a branch tem upstream: renomear não muda o remoto.
    upstream: Option<String>,
    /// Pasta-mãe quando a pasta segue `<diretório>/<branch>`; None quando foi criada fora da convenção.
    dir: Option<String>,
}

/// Pasta principal de um repo não-bare: o git não a move nem a remove.
fn is_main(path: &str) -> Result<bool, String> {
    let abs = |what: &str| git(path, &["rev-parse", "--path-format=absolute", what]);
    Ok(abs("--git-dir")? == abs("--git-common-dir")?)
}

/// `git worktree lock`: o git não move nem remove sem forçar.
fn is_locked(repo: &str, path: &str) -> Result<bool, String> {
    let porcelain = git(repo, &["worktree", "list", "--porcelain"])?;
    Ok(porcelain.split("\n\n").any(|b| b.lines().next() == Some(&format!("worktree {path}")) && b.lines().any(|l| l.starts_with("locked"))))
}

/// O que o diálogo de edição precisa saber de um lado antes de abrir.
#[tauri::command]
pub async fn worktree_info(path: String, branch: String) -> Result<SideInfo, String> {
    let main = is_main(&path)?;
    let upstream = git(&path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", &format!("{branch}@{{upstream}}")]).ok();
    let dir = path.strip_suffix(&format!("/{branch}")).filter(|d| !d.is_empty()).map(str::to_string);
    Ok(SideInfo { main, upstream, dir })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSide {
    path: String,
    branch: String,
    new_branch: String,
    /// Pasta-mãe para onde a pasta vai (`<move_to>/<new_branch>`); None: a pasta fica onde está.
    move_to: Option<String>,
    /// Start desta branch; vazio volta ao do projeto.
    command: String,
}

/// O lado que falta (solo) ou o par manual: fica, desfaz, pareia com uma solo do outro lado ou cria o outro lado.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PairChange {
    Keep,
    Unpair,
    With { branch: String },
    Create { dir: String, base: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRequest {
    project: String,
    api: Option<EditSide>,
    front: Option<EditSide>,
    pair: PairChange,
}

/// Cada passo feito, para desfazer na ordem inversa se um seguinte falhar.
enum Undo {
    Rename { repo: String, from: String, to: String, upstream: Option<String> },
    Move { repo: String, from: String, to: String },
    Create { repo: String, path: String, branch: Option<String> },
}

fn undo(done: Vec<Undo>) {
    for step in done.into_iter().rev() {
        // Desfazer é o melhor possível: um passo que não volta não impede os outros.
        let _ = match step {
            Undo::Rename { repo, from, to, upstream } => git(&repo, &["branch", "-m", &to, &from]).and_then(|_| match upstream {
                Some(u) => git(&repo, &["branch", "-u", &u, &from]),
                None => Ok(String::new()),
            }),
            Undo::Move { repo, from, to } => {
                if let Some(parent) = Path::new(&from).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let back = git(&repo, &["worktree", "move", &to, &from]);
                // A pasta-mãe que o passo criou ("fix/") volta a não existir.
                if let Some(parent) = Path::new(&to).parent() {
                    let _ = std::fs::remove_dir(parent);
                }
                back
            }
            Undo::Create { repo, path, branch } => git(&repo, &["worktree", "remove", "--force", &path]).and_then(|_| match branch {
                Some(b) => git(&repo, &["branch", "-D", &b]),
                None => Ok(String::new()),
            }),
        };
    }
}

/// Valida um lado antes de mexer em qualquer coisa. Retorna o destino da pasta, se ela muda.
fn check_side(repo: &str, s: &EditSide) -> Result<Option<PathBuf>, String> {
    let new = s.new_branch.trim();
    if new.is_empty() {
        return Err("Informe a branch.".into());
    }
    let has = |b: &str| git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_ok();
    if new != s.branch {
        git(repo, &["check-ref-format", "--branch", new]).map_err(|_| "Nome de branch inválido.".to_string())?;
        if !has(&s.branch) {
            return Err("Esta worktree está sem branch (HEAD destacado): não há o que renomear.".into());
        }
        if has(new) {
            return Err(format!("Já existe a branch {new} neste repositório."));
        }
    }
    let Some(dir) = &s.move_to else { return Ok(None) };
    let dir = expand(dir.trim());
    if !Path::new(&dir).is_absolute() {
        return Err(format!("O diretório precisa ser um caminho absoluto: {dir}"));
    }
    let dest = Path::new(&dir).join(new);
    if dest == Path::new(&s.path) {
        return Ok(None);
    }
    if dest.exists() {
        return Err(format!("Já existe {}.", dest.display()));
    }
    if is_locked(repo, &s.path)? {
        return Err("A worktree está travada (git worktree lock): o git não a move.".into());
    }
    Ok(Some(dest))
}

const KEYS: [&str; 2] = ["api", "front"];

/// Edita a worktree inteira ou nada: valida tudo, aplica (renomeia, move, cria o outro lado, grava o config)
/// e, se um passo falhar, desfaz os anteriores.
fn edit_worktree_in(config: &str, req: &EditRequest) -> Result<(), FormError> {
    let side_err = |key: &'static str| move |message: String| FormError { side: Some(key), message, created: vec![] };
    let cfg: Config = serde_json::from_str(&std::fs::read_to_string(config).map_err(|e| FormError::general(e.to_string()))?).map_err(|e| FormError::general(e.to_string()))?;
    let p = cfg.projects.iter().find(|p| p.name == req.project).ok_or(FormError::general("Projeto não encontrado."))?;
    let sides = [(&p.api, &req.api), (&p.front, &req.front)];

    // 1. Valida tudo antes de mexer.
    let mut dests = [None, None];
    for (i, (cfg_side, s)) in sides.iter().enumerate() {
        if let Some(s) = s {
            dests[i] = check_side(&expand(&cfg_side.repo), s).map_err(side_err(KEYS[i]))?;
        }
    }
    // O lado que o seletor de par mexe é o que falta; num par, os dois existem.
    let missing = sides.iter().position(|(_, s)| s.is_none());
    let current = |i: usize| sides[i].1.as_ref().map(|s| s.branch.as_str()).unwrap_or("");
    let renamed = |i: usize| sides[i].1.as_ref().map(|s| s.new_branch.trim()).unwrap_or("");
    match (&req.pair, missing) {
        (PairChange::Keep, _) => {}
        (PairChange::Unpair, None) => {
            if !p.manual_pairs.iter().any(|m| m.api == current(0) && m.front == current(1)) {
                return Err(FormError::general("Só um par manual (nomes diferentes) pode ser desfeito."));
            }
        }
        (PairChange::With { branch }, Some(i)) => {
            let (a, f) = (git_worktrees(&expand(&p.api.repo)), git_worktrees(&expand(&p.front.repo)));
            let solo = match (a, f) {
                (Ok(a), Ok(f)) => pair(a, f, &p.manual_pairs).into_iter().any(|(a, f)| {
                    let (mine, theirs) = if i == 0 { (a, f) } else { (f, a) };
                    mine.as_ref().is_some_and(|w| &w.branch == branch) && theirs.is_none()
                }),
                _ => false,
            };
            if !solo {
                return Err(side_err(KEYS[i])(format!("{branch} não é mais uma worktree solo; releia as worktrees.")));
            }
        }
        (PairChange::Create { .. }, Some(_)) => {}
        _ => return Err(FormError::general("Mudança de par inválida para esta worktree.")),
    }

    // 2. Aplica, guardando como desfazer.
    let mut done = vec![];
    let result = (|| -> Result<(), FormError> {
        for (i, (cfg_side, s)) in sides.iter().enumerate() {
            let Some(s) = s else { continue };
            let repo = expand(&cfg_side.repo);
            let err = side_err(KEYS[i]);
            let new = s.new_branch.trim();
            if new != s.branch {
                let upstream = git(&repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", &format!("{}@{{upstream}}", s.branch)]).ok();
                git(&repo, &["branch", "-m", &s.branch, new]).map_err(err)?;
                done.push(Undo::Rename { repo: repo.clone(), from: s.branch.clone(), to: new.to_string(), upstream: upstream.clone() });
                // A remota continua com o nome antigo: sem upstream, o próximo push cria a nova em vez de ir para a antiga.
                if upstream.is_some() {
                    let _ = git(&repo, &["branch", "--unset-upstream", new]);
                }
            }
            if let Some(dest) = &dests[i] {
                let dest = dest.to_string_lossy().to_string();
                if let Some(parent) = Path::new(&dest).parent() {
                    std::fs::create_dir_all(parent).map_err(|e| err(format!("Não consegui criar {}: {e}", parent.display())))?;
                }
                git(&repo, &["worktree", "move", &s.path, &dest]).map_err(err)?;
                done.push(Undo::Move { repo: repo.clone(), from: s.path.clone(), to: dest });
                // "feat/" vazia depois de mover a última worktree dela; remove_dir só apaga pasta vazia.
                if let Some(parent) = Path::new(&s.path).parent() {
                    let _ = std::fs::remove_dir(parent);
                }
            }
        }
        if let (PairChange::Create { dir, base }, Some(i)) = (&req.pair, missing) {
            let repo = expand(&sides[i].0.repo);
            let branch = renamed(1 - i);
            let made = add_one(&repo, dir, branch, base.trim()).map_err(side_err(KEYS[i]))?;
            let path = Path::new(&expand(dir.trim())).join(branch).to_string_lossy().to_string();
            done.push(Undo::Create { repo, path, branch: made.then(|| branch.to_string()) });
        }

        // 3. Config: comandos por branch e pares manuais, mexendo só nisso.
        let mut json = read_config_json(config).map_err(FormError::general)?;
        let proj = json["projects"]
            .as_array_mut()
            .and_then(|ps| ps.iter_mut().find(|x| x["name"] == req.project.as_str()))
            .ok_or(FormError::general("Projeto não encontrado no config."))?;
        for (i, (cfg_side, s)) in sides.iter().enumerate() {
            let Some(s) = s else { continue };
            let side = proj[KEYS[i]].as_object_mut().ok_or(FormError::general(format!("\"{}\" do projeto precisa ser um objeto.", KEYS[i])))?;
            let mut cmds = side.remove("branchCommands").and_then(|v| v.as_object().cloned()).unwrap_or_default();
            cmds.remove(&s.branch);
            let cmd = s.command.trim();
            if !cmd.is_empty() && Some(cmd) != cfg_side.start_command.as_deref() {
                cmds.insert(s.new_branch.trim().to_string(), cmd.into());
            }
            if !cmds.is_empty() {
                side.insert("branchCommands".into(), cmds.into());
            }
        }
        let obj = proj.as_object_mut().ok_or(FormError::general("Projeto inválido no config."))?;
        let mut pairs = obj.remove("manualPairs").and_then(|v| v.as_array().cloned()).unwrap_or_default();
        // O par manual acompanha os nomes novos.
        for m in pairs.iter_mut() {
            for i in 0..2 {
                if sides[i].1.is_some() && m[KEYS[i]] == current(i) {
                    m[KEYS[i]] = renamed(i).into();
                }
            }
        }
        match (&req.pair, missing) {
            (PairChange::Unpair, _) => pairs.retain(|m| !(m["api"] == renamed(0) && m["front"] == renamed(1))),
            (PairChange::With { branch }, Some(i)) => {
                let (api, front) = if i == 0 { (branch.as_str(), renamed(1)) } else { (renamed(0), branch.as_str()) };
                pairs.push(serde_json::json!({ "api": api, "front": front }));
            }
            _ => {}
        }
        if !pairs.is_empty() {
            obj.insert("manualPairs".into(), pairs.into());
        }
        write_config_json(config, &json).map_err(FormError::general)
    })();
    if result.is_err() {
        undo(done);
    }
    result
}

/// Salvar do diálogo de edição. async: mover a pasta pode demorar e não deve travar a UI.
#[tauri::command]
pub async fn edit_worktree(req: EditRequest) -> Result<(), FormError> {
    edit_worktree_in(&config_path(), &req)
}

// ---------- remover worktree ----------

#[derive(Deserialize)]
pub struct RemoveSide {
    path: String,
    branch: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveRequest {
    project: String,
    api: Option<RemoveSide>,
    front: Option<RemoveSide>,
    /// `git branch -d` depois de remover; a branch não mergeada fica, com um aviso.
    delete_branch: bool,
}

/// O que impede `git worktree remove` sem `--force`, dito antes de mexer em qualquer lado.
fn check_remove(repo: &str, path: &str) -> Result<(), String> {
    if is_main(path)? {
        return Err(format!("{path} é a pasta principal do repositório: o git não a remove."));
    }
    if is_locked(repo, path)? {
        return Err("A worktree está travada (git worktree lock): o git não a remove.".into());
    }
    if !git(path, &["status", "--porcelain"])?.is_empty() {
        return Err(format!("{path} tem mudanças não commitadas ou arquivos não rastreados: commite, guarde (git stash -u) ou apague antes de remover."));
    }
    Ok(())
}

/// Tira do projeto o que era das branches removidas (`(lado, branch)`): o comando próprio e o par manual.
fn forget_branches(proj: &mut serde_json::Value, removed: &[(usize, &str)]) {
    let Some(obj) = proj.as_object_mut() else { return };
    for &(i, branch) in removed {
        if let Some(side) = obj.get_mut(KEYS[i]).and_then(|s| s.as_object_mut()) {
            if let Some(cmds) = side.get_mut("branchCommands").and_then(|c| c.as_object_mut()) {
                cmds.remove(branch);
                if cmds.is_empty() {
                    side.remove("branchCommands");
                }
            }
        }
    }
    if let Some(pairs) = obj.get_mut("manualPairs").and_then(|v| v.as_array_mut()) {
        pairs.retain(|m| !removed.iter().any(|&(i, b)| m[KEYS[i]] == b));
        if pairs.is_empty() {
            obj.remove("manualPairs");
        }
    }
}

/// Remove os lados existentes da worktree: valida os dois antes, remove (sem `--force`), apaga a pasta-mãe vazia,
/// limpa o config e, se pedido, a branch. Devolve os avisos (branch que ficou) sem falhar o resto.
/// No erro, `created` lista os lados que já foram removidos.
fn remove_worktree_in(config: &str, req: &RemoveRequest) -> Result<Vec<String>, FormError> {
    let side_err = |key: &'static str| move |message: String| FormError { side: Some(key), message, created: vec![] };
    let cfg: Config = serde_json::from_str(&std::fs::read_to_string(config).map_err(|e| FormError::general(e.to_string()))?).map_err(|e| FormError::general(e.to_string()))?;
    let p = cfg.projects.iter().find(|p| p.name == req.project).ok_or(FormError::general("Projeto não encontrado."))?;
    let sides = [(expand(&p.api.repo), &req.api), (expand(&p.front.repo), &req.front)];

    // 1. Valida tudo antes de mexer.
    for (i, (repo, s)) in sides.iter().enumerate() {
        if let Some(s) = s {
            check_remove(repo, &s.path).map_err(side_err(KEYS[i]))?;
        }
    }

    // 2. Remove; um lado que falha depois do outro removido para aí, e o erro diz qual já foi.
    let mut removed = vec![];
    let mut failed = None;
    for (i, (repo, s)) in sides.iter().enumerate() {
        let Some(s) = s else { continue };
        if let Err(e) = git(repo, &["worktree", "remove", &s.path]) {
            failed = Some((i, e));
            break;
        }
        // "feat/" vazia depois de remover a última worktree dela; remove_dir só apaga pasta vazia.
        if let Some(parent) = Path::new(&s.path).parent() {
            let _ = std::fs::remove_dir(parent);
        }
        removed.push((i, s.branch.as_str()));
    }

    // 3. O que é do lado removido sai mesmo num erro parcial: o config e, se pedido, a branch.
    let mut notes = vec![];
    if req.delete_branch {
        for &(i, b) in &removed {
            let repo = &sides[i].0;
            // HEAD destacado: o "nome" é o da pasta, não há branch para apagar.
            if git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_err() {
                continue;
            }
            if let Err(e) = git(repo, &["branch", "-d", b]) {
                let side = if i == 0 { "API" } else { "Front" };
                notes.push(if e.contains("not fully merged") {
                    format!("{side}: a branch {b} não está mergeada e ficou (git branch -D {b} apaga)")
                } else {
                    format!("{side}: a branch {b} ficou: {e}")
                });
            }
        }
    }
    let done: Vec<&'static str> = removed.iter().map(|&(i, _)| KEYS[i]).collect();
    let mut json = read_config_json(config).map_err(FormError::general)?;
    if let Some(proj) = json.get_mut("projects").and_then(|ps| ps.as_array_mut()).and_then(|ps| ps.iter_mut().find(|x| x["name"] == req.project.as_str())) {
        let before = proj.clone();
        forget_branches(proj, &removed);
        if *proj != before {
            write_config_json(config, &json).map_err(|e| FormError { side: None, message: e, created: done.clone() })?;
        }
    }

    match failed {
        None => Ok(notes),
        Some((i, e)) => Err(FormError {
            side: Some(KEYS[i]),
            message: if done.is_empty() { e } else { format!("A API já foi removida; o Front falhou: {e}") },
            created: done,
        }),
    }
}

/// "Remover" do diálogo de edição. async: apagar a pasta (node_modules) pode demorar e não deve travar a UI.
#[tauri::command]
pub async fn remove_worktree(req: RemoveRequest) -> Result<Vec<String>, FormError> {
    remove_worktree_in(&config_path(), &req)
}

// ---------- novo projeto ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSide {
    repo: String,
    start_command: String,
    setup_command: String,
}

#[derive(Deserialize)]
pub struct NewProject {
    name: String,
    api: NewSide,
    front: NewSide,
}

/// `/home/x/dev/api` → `~/dev/api`, para o config continuar legível.
fn contract(p: &str) -> String {
    let home = home();
    match p.strip_prefix(&format!("{home}/")) {
        Some(rest) if !home.is_empty() => format!("~/{rest}"),
        _ => p.to_string(),
    }
}

fn side_json(key: &'static str, s: &NewSide) -> Result<serde_json::Value, FormError> {
    let err = |message: String| FormError { side: Some(key), message, created: vec![] };
    let repo = expand(s.repo.trim()).trim_end_matches('/').to_string();
    if repo.is_empty() {
        return Err(err("Escolha a pasta do repositório.".into()));
    }
    git(&repo, &["rev-parse", "--git-dir"]).map_err(|_| err(format!("{repo} não é um repositório git.")))?;
    let mut side = serde_json::json!({ "repo": contract(&repo) });
    for (k, v) in [("startCommand", &s.start_command), ("setupCommand", &s.setup_command)] {
        if !v.trim().is_empty() {
            side[k] = v.trim().into();
        }
    }
    Ok(side)
}

/// Acrescenta o projeto ao config sem mexer no resto (ordem e campos que o usuário editou à mão).
fn add_project_to(path: &str, project: &NewProject) -> Result<(), FormError> {
    fn general(m: impl Into<String>) -> FormError {
        FormError::general(m)
    }
    let name = project.name.trim();
    if name.is_empty() {
        return Err(general("Dê um nome ao projeto."));
    }
    let mut cfg = read_config_json(path).map_err(general)?;
    let entry = serde_json::json!({
        "name": name,
        "api": side_json("api", &project.api)?,
        "front": side_json("front", &project.front)?,
    });
    let projects = cfg
        .as_object_mut()
        .ok_or(general(format!("{path}: a raiz precisa ser um objeto.")))?
        .entry("projects")
        .or_insert_with(|| serde_json::json!([]))
        .as_array_mut()
        .ok_or(general(format!("{path}: \"projects\" precisa ser uma lista.")))?;
    if projects.iter().any(|p| p["name"] == name) {
        return Err(general(format!("Já existe um projeto chamado \"{name}\".")));
    }
    projects.push(entry);
    write_config_json(path, &cfg).map_err(general)
}

/// O config como JSON solto, para mudar um campo sem mexer no resto (ordem e campos que o usuário editou à mão).
fn read_config_json(path: &str) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        // JSON quebrado: recusa em vez de sobrescrever o que o usuário escreveu.
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("{path} tem JSON inválido; corrija o arquivo antes: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({ "projects": [] })),
        Err(e) => Err(format!("Não consegui ler {path}: {e}")),
    }
}

/// Escrita atômica: grava ao lado e renomeia, para nunca deixar o config pela metade.
fn write_config_json(path: &str, cfg: &serde_json::Value) -> Result<(), String> {
    let io = |e: std::io::Error| format!("Não consegui gravar o config: {e}");
    let path = Path::new(path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())? + "\n";
    std::fs::write(&tmp, body).map_err(io)?;
    std::fs::rename(&tmp, path).map_err(io)
}

/// O package manager que o lockfile da pasta indica; sem lockfile, nenhum.
fn lock_pm(dir: &Path) -> Option<&'static str> {
    let by_lock = [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lock", "bun"), ("bun.lockb", "bun"), ("package-lock.json", "npm")];
    by_lock.iter().find(|(lock, _)| dir.join(lock).is_file()).map(|(_, pm)| *pm)
}

/// Lado Node sem dependências instaladas (tem package.json, falta node_modules): o comando de instalação, para rodar
/// antes do startCommand. Segue o package manager do start ("pnpm dev" → pnpm install); start de outro tipo usa o
/// lockfile (sem lockfile, npm). Worktree criada fora do app nasce assim, e o `npm run dev` falharia por falta do
/// binário do dev server.
#[tauri::command]
pub fn missing_deps_install(path: String, start: String) -> Option<String> {
    let dir = Path::new(&path);
    if !dir.join("package.json").is_file() || dir.join("node_modules").exists() {
        return None;
    }
    let by_start = ["npm", "yarn", "pnpm"].into_iter().find(|pm| start.split_whitespace().next() == Some(pm));
    Some(format!("{} install", by_start.or_else(|| lock_pm(dir)).unwrap_or("npm")))
}

/// "Novo projeto": o package manager do lockfile da primeira worktree que tiver um, para o seletor do start.
#[tauri::command]
pub fn lockfile_pm(paths: Vec<String>) -> Option<&'static str> {
    paths.iter().find_map(|p| lock_pm(Path::new(p)))
}

/// Interruptor da ajuda: grava "screenReader" no config (o app relê em seguida e aplica nos terminais abertos).
#[tauri::command]
pub fn set_screen_reader(on: bool) -> Result<(), String> {
    let path = config_path();
    let mut cfg = read_config_json(&path)?;
    cfg.as_object_mut().ok_or(format!("{path}: a raiz precisa ser um objeto."))?.insert("screenReader".into(), on.into());
    write_config_json(&path, &cfg)
}

#[tauri::command]
pub fn add_project(project: NewProject) -> Result<(), FormError> {
    add_project_to(&config_path(), &project)
}

// ---------- GitHub ----------

/// Roda o `gh` (GitHub CLI) com a conta já logada nele; erro de instalação ou login vira o próximo passo.
/// Grupo de processos próprio, fora do PTY: o navegador que o `gh pr view --web` abre fica solto do app.
fn gh(args: &[&str]) -> Result<String, String> {
    use std::os::unix::process::CommandExt;
    let out = Command::new("gh").args(args).process_group(0).output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "Instale o GitHub CLI (gh) para clonar do GitHub.".to_string(),
        _ => e.to_string(),
    })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.contains("gh auth login") {
            return Err("Entre no GitHub pelo terminal com gh auth login.".into());
        }
        return Err(err);
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Serialize)]
pub struct GithubRepos {
    login: String,
    repos: Vec<String>,
}

/// Repositórios que a conta logada no `gh` alcança (dela, de colaborador e das organizações), os mexidos por último primeiro.
#[tauri::command]
pub async fn github_repos() -> Result<GithubRepos, String> {
    let login = gh(&["api", "user", "--jq", ".login"])?;
    let list = gh(&["api", "--paginate", "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member", "--jq", ".[].full_name"])?;
    Ok(GithubRepos { login, repos: list.lines().map(str::to_string).collect() })
}

/// `HOST/OWNER/REPO` para o `--repo` do gh, a partir da URL do origin (https, ssh ou scp `git@host:dono/repo.git`):
/// no bare (`.bare`) não dá para contar com o gh achando o remoto sozinho.
fn gh_repo_of(url: &str) -> Option<String> {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let rest = match url.split_once("://") {
        Some((_, r)) => r.to_string(),
        None => url.replacen(':', "/", 1),
    };
    let rest = rest.rsplit_once('@').map_or(rest.as_str(), |(_, r)| r);
    let parts: Vec<&str> = rest.split('/').collect();
    match parts.as_slice() {
        [host, owner, name] if !host.is_empty() && !owner.is_empty() && !name.is_empty() => Some(parts.join("/")),
        _ => None,
    }
}

fn side_prs(side: &SideCfg) -> Result<serde_json::Value, String> {
    let url = git(&expand(&side.repo), &["remote", "get-url", "origin"])?;
    let repo = gh_repo_of(&url).ok_or(format!("o origin não é um repositório do GitHub: {url}"))?;
    let out = gh(&["pr", "list", "--repo", &repo, "--limit", "100", "--json", "number,title,headRefName,author,isCrossRepository"])?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// `gh pr view <branch> --web --repo HOST/OWNER/REPO`: o repo vem do origin, como no "Da PR".
fn pr_view_args<'a>(repo: &'a str, branch: &'a str) -> [&'a str; 6] {
    ["pr", "view", branch, "--web", "--repo", repo]
}

/// O gh diz `No pull requests found for branch "feat/x"` quando a branch não tem PR.
fn no_pr(err: &str) -> bool {
    err.to_lowercase().contains("no pull requests found")
}

/// "Ver PR": abre no navegador a PR da branch da aba visível, no repositório do origin da pasta dela (no bare o gh não
/// acha o remoto sozinho). Ok(false): a branch não tem PR. Sem gh instalado ou logado, o erro diz o próximo passo.
#[tauri::command]
pub async fn open_pr(path: String, branch: String) -> Result<bool, String> {
    let url = git(&path, &["remote", "get-url", "origin"])?;
    let repo = gh_repo_of(&url).ok_or(format!("o origin não é um repositório do GitHub: {url}"))?;
    match gh(&pr_view_args(&repo, &branch)) {
        Ok(_) => Ok(true),
        Err(e) if no_pr(&e) => Ok(false),
        Err(e) => Err(e),
    }
}

#[derive(Serialize)]
pub struct PullRequests {
    api: Result<serde_json::Value, String>,
    front: Result<serde_json::Value, String>,
}

/// PRs abertas na API e no Front do projeto, como o `gh pr list --json` devolve; o front junta pela branch.
#[tauri::command]
pub async fn pull_requests(project: String) -> Result<PullRequests, String> {
    let cfg = read_config()?;
    let p = cfg.projects.iter().find(|p| p.name == project).ok_or("projeto não encontrado")?;
    // Em paralelo: cada gh leva cerca de 1 s.
    let (api, front) = std::thread::scope(|s| {
        let api = s.spawn(|| side_prs(&p.api));
        let front = side_prs(&p.front);
        (api.join().unwrap_or_else(|_| Err("falha ao listar as PRs da API".into())), front)
    });
    Ok(PullRequests { api, front })
}

/// "dono/repo" do GitHub: só letras, números, ".", "-" e "_"; o nome vira pasta no disco.
fn valid_full_name(full: &str) -> bool {
    let ok = |p: &str| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    matches!(full.split_once('/'), Some((owner, name)) if ok(owner) && ok(name))
}

/// Deixa um clone `--bare` em `<dest>/.bare` no layout do app: `.git` apontando para ele, branches remotas
/// rastreadas (o `--bare` não configura) e a worktree da branch padrão em `<dest>/<branch>`.
fn bare_layout(dest: &Path) -> Result<(), String> {
    std::fs::write(dest.join(".git"), "gitdir: ./.bare\n").map_err(|e| e.to_string())?;
    let repo = dest.to_str().ok_or("caminho inválido")?;
    git(repo, &["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"])?;
    git(repo, &["fetch", "-q", "origin"])?;
    let branch = git(repo, &["symbolic-ref", "--short", "HEAD"])?;
    let path = dest.join(&branch);
    git(repo, &["worktree", "add", path.to_str().ok_or("caminho inválido")?, &branch])?;
    Ok(())
}

/// Clona `dono/repo` em `<parent>/<repo>` (bare + worktree da branch padrão) e devolve a pasta, pronta para o campo Repositório.
#[tauri::command]
pub async fn clone_github_repo(full_name: String, parent: String) -> Result<String, String> {
    let full = full_name.trim();
    if !valid_full_name(full) {
        return Err("Escolha um repositório da lista, no formato dono/repositório.".into());
    }
    let parent = expand(parent.trim());
    if !Path::new(&parent).is_absolute() {
        return Err(format!("A pasta de destino precisa ser um caminho absoluto: {parent}"));
    }
    let name = full.split_once('/').map(|(_, n)| n).unwrap_or(full);
    let dest = Path::new(&parent).join(name);
    if dest.exists() {
        return Err(format!("Já existe {}; escolha outra pasta ou use Escolher… para apontar para ela.", dest.display()));
    }
    let bare = dest.join(".bare");
    let result = gh(&["repo", "clone", full, bare.to_str().ok_or("caminho inválido")?, "--", "--bare", "-q"]).and_then(|_| bare_layout(&dest));
    if let Err(e) = result {
        // A pasta não existia antes deste clone: apaga o que ficou pela metade, para poder tentar de novo.
        let _ = std::fs::remove_dir_all(&dest);
        return Err(e);
    }
    Ok(dest.to_string_lossy().into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_editor_by_category() {
        assert!(is_editor("TextEditor;Development;IDE;", false));
        assert!(is_editor("Development;IDE", false));
        assert!(!is_editor("TextEditor;", true));
        assert!(!is_editor("Development;Database;", false));
        assert!(!is_editor("", false));
    }

    #[test]
    fn editor_argv_splits_program_and_args() {
        assert_eq!(editor_argv("code", "/w/x"), Some(("code".into(), vec!["/w/x".into()])));
        assert_eq!(editor_argv("  code   -n ", "/w/x"), Some(("code".into(), vec!["-n".into(), "/w/x".into()])));
        assert_eq!(editor_argv("~/bin/ed", "/w"), Some((format!("{}/bin/ed", home()), vec!["/w".into()])));
        assert_eq!(editor_argv("", "/w"), None);
        assert_eq!(editor_argv("   ", "/w"), None);
    }

    fn wt(b: &str) -> Wt {
        Wt { branch: b.into(), path: format!("/r/{b}") }
    }

    #[test]
    fn install_only_when_node_modules_is_missing() {
        let dir = std::env::temp_dir().join(format!("hotswap-deps-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();

        let install = |start: &str| missing_deps_install(path.clone(), start.into());
        assert_eq!(install("npm run dev"), None, "sem package.json não é Node");
        std::fs::write(dir.join("package.json"), "{}").unwrap();
        assert_eq!(install("make dev").as_deref(), Some("npm install"));
        assert_eq!(lockfile_pm(vec![path.clone()]), None);
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(install("make dev").as_deref(), Some("pnpm install"), "start sem package manager: vale o lockfile");
        assert_eq!(install("yarn dev").as_deref(), Some("yarn install"), "o start escolhido vence o lockfile");
        assert_eq!(lockfile_pm(vec!["/nao/existe".into(), path.clone()]), Some("pnpm"));
        std::fs::create_dir(dir.join("node_modules")).unwrap();
        assert_eq!(install("pnpm dev"), None);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_porcelain() {
        let out = "worktree /r/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/feat\nHEAD def\nbranch refs/heads/feat/x\n\nworktree /r/det\nHEAD 123\ndetached\n\nworktree /r/bare\nbare\n\nworktree /tmp/gone\nHEAD 456\ndetached\nprunable gitdir file points to non-existent location\n";
        assert_eq!(
            parse_porcelain(out),
            vec![
                Wt { branch: "main".into(), path: "/r/main".into() },
                Wt { branch: "feat/x".into(), path: "/r/feat".into() },
                Wt { branch: "det".into(), path: "/r/det".into() },
            ]
        );
    }

    #[test]
    fn parses_status() {
        let out = "# branch.oid abc\n# branch.head feat/x\n# branch.upstream origin/feat/x\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/a.ts\n2 R. N... 100644 100644 100644 a b R100 novo.ts\tvelho.ts\nu UU N... 1 2 3 4 a b c conflito.ts\n? solto.txt\n? pasta/\n! ignorado\n";
        assert_eq!(parse_status(out), GitStatus { changed: 3, untracked: 2, ahead: 2, behind: 1 });
        // Sem upstream: nada de # branch.ab, e limpa.
        assert_eq!(parse_status("# branch.oid abc\n# branch.head main"), GitStatus::default());
    }

    #[test]
    fn pairs_manual_then_by_name_then_solos() {
        let manual = vec![Pair { api: "feat/x".into(), front: "feature/x".into() }];
        let got = pair(
            vec![wt("main"), wt("feat/x"), wt("fix")],
            vec![wt("main"), wt("feature/x"), wt("only-front")],
            &manual,
        );
        assert_eq!(
            got,
            vec![
                (Some(wt("main")), Some(wt("main"))),
                (Some(wt("feat/x")), Some(wt("feature/x"))),
                (Some(wt("fix")), None),
                (None, Some(wt("only-front"))),
            ]
        );
    }

    #[test]
    fn creates_worktrees_and_lists_branches() {
        let tmp = std::env::temp_dir().join(format!("hotswap-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let sh = |cmd: &str| assert!(Command::new("sh").arg("-c").arg(cmd).current_dir(&tmp).status().unwrap().success(), "{cmd}");
        std::fs::create_dir_all(&tmp).unwrap();
        let git_id = "-c user.name=t -c user.email=t@t";
        sh(&format!("git init -q -b main normal && git -C normal {git_id} commit -q --allow-empty -m init && git -C normal branch old"));
        sh("mkdir bare && git clone -q --bare normal bare/.bare && echo 'gitdir: ./.bare' > bare/.git");
        let path = |d: &str| tmp.join(d).to_str().unwrap().to_string();

        // Pasta padrão: bare → dentro do repo; normal → <repo>.worktrees.
        assert_eq!(default_dir(&path("bare")).unwrap(), tmp.join("bare"));
        assert_eq!(default_dir(&path("normal")).unwrap(), tmp.join("normal.worktrees"));

        let (mut local, remote) = branches(&path("bare")).unwrap();
        local.sort();
        assert_eq!((local, remote), (vec!["main".to_string(), "old".to_string()], vec![]));

        // Branch nova (com barra) a partir de outra; branch existente ignora a base.
        add_one(&path("bare"), &path("bare"), "feat/x", "old").unwrap();
        add_one(&path("bare"), &path("bare"), "old", "").unwrap();
        // Diretório escolhido pelo usuário.
        add_one(&path("normal"), &path("custom"), "feat/y", "main").unwrap();
        assert!(tmp.join("bare/feat/x/.git").exists());
        assert!(tmp.join("bare/old/.git").exists());
        assert!(tmp.join("custom/feat/y/.git").exists());
        let branches_of = |r: &str| list_worktrees(path(r)).unwrap().into_iter().map(|w| w.branch).collect::<Vec<_>>();
        assert_eq!(branches_of("bare"), vec!["feat/x", "old"]);
        assert!(list_worktrees(tmp.to_str().unwrap().into()).is_err(), "pasta que não é repo");
        std::fs::write(tmp.join("normal/solto.txt"), "").unwrap();
        assert_eq!(
            tauri::async_runtime::block_on(git_status(vec![path("normal"), path("nao-existe")])),
            vec![Some(GitStatus { untracked: 1, ..Default::default() }), None]
        );

        // Branch de PR: só no origin; o bare clonado fora do app não rastreia as remotas. Buscada, é reaproveitada.
        sh(&format!("git -C normal {git_id} commit -q --allow-empty -m pr && git -C normal branch pr/z && git -C normal reset -q --hard HEAD~1"));
        fetch_branch(&path("bare"), "pr/z").unwrap();
        add_one(&path("bare"), &path("bare"), "pr/z", "").unwrap();
        assert_eq!(git(&path("bare/pr/z"), &["log", "-1", "--format=%s"]).unwrap(), "pr");
        assert!(fetch_branch(&path("bare"), "nao-existe").is_err());

        assert!(add_one(&path("bare"), &path("bare"), "../fora", "main").is_err());
        assert!(add_one(&path("bare"), "relativo", "feat/z", "main").is_err());
        assert!(add_one(&path("bare"), &path("bare"), "feat/sem-base", "").is_err());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn edits_worktree_all_or_nothing() {
        let tmp = std::env::temp_dir().join(format!("hotswap-edit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let sh = |cmd: &str| assert!(Command::new("sh").arg("-c").arg(cmd).current_dir(&tmp).status().unwrap().success(), "{cmd}");
        std::fs::create_dir_all(&tmp).unwrap();
        for r in ["api", "web"] {
            sh(&format!("git init -q -b main src-{r} && git -C src-{r} -c user.name=t -c user.email=t@t commit -q --allow-empty -m init"));
            sh(&format!("mkdir {r} && git clone -q --bare src-{r} {r}/.bare && echo 'gitdir: ./.bare' > {r}/.git"));
        }
        let path = |d: &str| tmp.join(d).to_str().unwrap().to_string();
        add_one(&path("api"), &path("api"), "feat/x", "main").unwrap();
        add_one(&path("web"), &path("web"), "feat/x", "main").unwrap();
        add_one(&path("api"), &path("api"), "solo-api", "main").unwrap();
        add_one(&path("web"), &path("web"), "solo-web", "main").unwrap();
        let config = path("config.json");
        let raw = format!(r#"{{"projects":[{{"name":"p","api":{{"repo":"{}","startCommand":"npm run dev"}},"front":{{"repo":"{}"}}}}]}}"#, path("api"), path("web"));
        std::fs::write(&config, &raw).unwrap();
        let branch_of = |r: &str, wt: &str| git(&path(&format!("{r}/{wt}")), &["branch", "--show-current"]).unwrap();
        let side = |r: &str, from: &str, to: &str, move_to: Option<String>, cmd: &str| EditSide { path: path(&format!("{r}/{from}")), branch: from.into(), new_branch: to.into(), move_to, command: cmd.into() };

        // Renomeia e move os dois lados; o comando próprio vai para a branch nova, o igual ao do projeto não é gravado.
        let req = EditRequest {
            project: "p".into(),
            api: Some(side("api", "feat/x", "feat/y", Some(path("api")), "npm run dev:mock")),
            front: Some(side("web", "feat/x", "feat/y", Some(path("web")), "")),
            pair: PairChange::Keep,
        };
        edit_worktree_in(&config, &req).unwrap();
        assert_eq!(branch_of("api", "feat/y"), "feat/y");
        assert_eq!(branch_of("web", "feat/y"), "feat/y");
        assert!(!tmp.join("api/feat/x").exists());
        let cfg: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        assert_eq!(cfg["projects"][0]["api"]["branchCommands"], serde_json::json!({ "feat/y": "npm run dev:mock" }));
        assert!(cfg["projects"][0]["front"].get("branchCommands").is_none());

        // O front falha no meio (a pasta-mãe é um arquivo): a API, já renomeada e movida, volta ao que era.
        std::fs::write(tmp.join("blocker"), "").unwrap();
        let before = std::fs::read_to_string(&config).unwrap();
        let req = EditRequest {
            project: "p".into(),
            api: Some(side("api", "feat/y", "fix/z", Some(path("api")), "")),
            front: Some(side("web", "feat/y", "fix/z", Some(path("blocker")), "")),
            pair: PairChange::Keep,
        };
        let err = edit_worktree_in(&config, &req).unwrap_err();
        assert_eq!(err.side, Some("front"));
        assert_eq!(branch_of("api", "feat/y"), "feat/y", "API desfeita");
        assert_eq!(branch_of("web", "feat/y"), "feat/y", "front desfeito");
        assert!(!tmp.join("api/fix").exists());
        assert_eq!(std::fs::read_to_string(&config).unwrap(), before, "config intocado");

        // Validação barra antes de mexer: branch que já existe.
        let req = EditRequest { project: "p".into(), api: Some(side("api", "feat/y", "solo-api", None, "")), front: None, pair: PairChange::Keep };
        assert_eq!(edit_worktree_in(&config, &req).unwrap_err().side, Some("api"));

        // Pareia duas solos (grava manualPairs) e desfaz o par.
        let req = EditRequest { project: "p".into(), api: Some(side("api", "solo-api", "solo-api", None, "")), front: None, pair: PairChange::With { branch: "solo-web".into() } };
        edit_worktree_in(&config, &req).unwrap();
        let cfg = read_config_json(&config).unwrap();
        assert_eq!(cfg["projects"][0]["manualPairs"], serde_json::json!([{ "api": "solo-api", "front": "solo-web" }]));
        let req = EditRequest {
            project: "p".into(),
            api: Some(side("api", "solo-api", "solo-api", None, "")),
            front: Some(side("web", "solo-web", "solo-web", None, "")),
            pair: PairChange::Unpair,
        };
        edit_worktree_in(&config, &req).unwrap();
        assert!(read_config_json(&config).unwrap()["projects"][0].get("manualPairs").is_none());

        // Completa o par: cria o front com o nome da API.
        let req = EditRequest { project: "p".into(), api: Some(side("api", "solo-api", "solo-api", None, "")), front: None, pair: PairChange::Create { dir: path("web"), base: "main".into() } };
        edit_worktree_in(&config, &req).unwrap();
        assert_eq!(branch_of("web", "solo-api"), "solo-api");
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn removes_worktree_without_force() {
        let tmp = std::env::temp_dir().join(format!("hotswap-rm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let sh = |cmd: &str| assert!(Command::new("sh").arg("-c").arg(cmd).current_dir(&tmp).status().unwrap().success(), "{cmd}");
        std::fs::create_dir_all(&tmp).unwrap();
        for r in ["api", "web"] {
            sh(&format!("git init -q -b main src-{r} && git -C src-{r} -c user.name=t -c user.email=t@t commit -q --allow-empty -m init"));
            sh(&format!("mkdir {r} && git clone -q --bare src-{r} {r}/.bare && echo 'gitdir: ./.bare' > {r}/.git"));
        }
        let path = |d: &str| tmp.join(d).to_str().unwrap().to_string();
        add_one(&path("api"), &path("api"), "feat/x", "main").unwrap();
        add_one(&path("web"), &path("web"), "feat/x", "main").unwrap();
        let config = path("config.json");
        let raw = format!(
            r#"{{"projects":[{{"name":"p","api":{{"repo":"{}","branchCommands":{{"feat/x":"npm run dev:mock","outra":"make"}}}},"front":{{"repo":"{}","branchCommands":{{"feat/x":"x"}}}},"manualPairs":[{{"api":"feat/x","front":"feat/x"}},{{"api":"a","front":"b"}}]}}]}}"#,
            path("api"),
            path("web")
        );
        std::fs::write(&config, &raw).unwrap();
        let side = |r: &str| Some(RemoveSide { path: path(&format!("{r}/feat/x")), branch: "feat/x".into() });
        let req = RemoveRequest { project: "p".into(), api: side("api"), front: side("web"), delete_branch: true };

        // Arquivo não rastreado no Front: recusa antes de mexer na API.
        std::fs::write(tmp.join("web/feat/x/novo.txt"), "").unwrap();
        let err = remove_worktree_in(&config, &req).unwrap_err();
        assert_eq!((err.side, err.created.len()), (Some("front"), 0));
        assert!(tmp.join("api/feat/x").exists(), "API intocada");
        assert_eq!(std::fs::read_to_string(&config).unwrap(), raw, "config intocado");
        std::fs::remove_file(tmp.join("web/feat/x/novo.txt")).unwrap();

        // Remove os dois; a branch do Front tem commit fora da main: fica, com aviso, e o resto segue.
        sh("git -C web/feat/x -c user.name=t -c user.email=t@t commit -q --allow-empty -m wip");
        let notes = remove_worktree_in(&config, &req).unwrap();
        assert_eq!(notes.len(), 1);
        assert!(notes[0].starts_with("Front: a branch feat/x não está mergeada"), "{}", notes[0]);
        assert!(!tmp.join("api/feat").exists() && !tmp.join("web/feat").exists(), "pasta-mãe vazia apagada");
        assert!(git(&path("api"), &["rev-parse", "--verify", "--quiet", "refs/heads/feat/x"]).is_err(), "branch mergeada apagada");
        assert!(git(&path("web"), &["rev-parse", "--verify", "--quiet", "refs/heads/feat/x"]).is_ok(), "branch não mergeada fica");
        let cfg = read_config_json(&config).unwrap();
        let p = &cfg["projects"][0];
        assert_eq!(p["api"]["branchCommands"], serde_json::json!({ "outra": "make" }));
        assert!(p["front"].get("branchCommands").is_none());
        assert_eq!(p["manualPairs"], serde_json::json!([{ "api": "a", "front": "b" }]));

        // A pasta principal de um repo não-bare não sai.
        assert!(check_remove(&path("src-api"), &path("src-api")).unwrap_err().contains("principal"));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn pulls_fast_forward_only() {
        let tmp = std::env::temp_dir().join(format!("hotswap-pull-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let sh = |cmd: &str| assert!(Command::new("sh").arg("-c").arg(cmd).current_dir(&tmp).status().unwrap().success(), "{cmd}");
        std::fs::create_dir_all(&tmp).unwrap();
        let git_id = "-c user.name=t -c user.email=t@t";
        sh(&format!("git init -q -b main up && git -C up {git_id} commit -q --allow-empty -m init && git clone -q up down"));
        let path = |d: &str| tmp.join(d).to_str().unwrap().to_string();
        let pull = |d: &str| tauri::async_runtime::block_on(pull_worktree(vec![path(d)])).remove(0);

        assert_eq!(pull("down"), Ok(false), "já estava em dia");
        sh(&format!("git -C up {git_id} commit -q --allow-empty -m novo"));
        assert_eq!(pull("down"), Ok(true), "avançou");
        assert_eq!(git(&path("down"), &["log", "-1", "--format=%s"]).unwrap(), "novo");

        // Divergiu: commit dos dois lados. Não faz merge; o erro cru volta para o front resumir.
        sh(&format!("git -C up {git_id} commit -q --allow-empty -m remoto && git -C down {git_id} commit -q --allow-empty -m local"));
        let err = pull("down").unwrap_err();
        assert!(err.contains("Not possible to fast-forward"), "{err}");
        assert_eq!(git(&path("down"), &["log", "-1", "--format=%s"]).unwrap(), "local", "nada mudou");

        // Branch sem upstream.
        sh("git -C down checkout -q -b solta");
        assert!(pull("down").unwrap_err().contains("no tracking information"));
        assert!(pulled("Updating abc..def\nFast-forward\n a.ts | 2 +-\n"));
        assert!(!pulled("Already up to date.\n"));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn bare_layout_from_clone() {
        let tmp = std::env::temp_dir().join(format!("hotswap-gh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let sh = |cmd: &str| assert!(Command::new("sh").arg("-c").arg(cmd).current_dir(&tmp).status().unwrap().success(), "{cmd}");
        std::fs::create_dir_all(&tmp).unwrap();
        sh("git init -q -b main origin && git -C origin -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git -C origin branch dev");
        sh("git clone -q --bare origin dest/.bare");

        bare_layout(&tmp.join("dest")).unwrap();
        let dest = tmp.join("dest").to_str().unwrap().to_string();
        assert!(tmp.join("dest/main/.git").exists(), "worktree da branch padrão");
        assert_eq!(default_dir(&dest).unwrap(), tmp.join("dest"), "o app lê como bare");
        let (_, remote) = branches(&dest).unwrap();
        assert!(remote.contains(&"origin/dev".to_string()), "branches remotas rastreadas");

        for url in ["git@github.com:dono/repo.git", "https://github.com/dono/repo", "ssh://git@github.com/dono/repo.git", "https://github.com/dono/repo.git/"] {
            assert_eq!(gh_repo_of(url).as_deref(), Some("github.com/dono/repo"), "{url}");
        }
        assert_eq!(gh_repo_of("/tmp/origem"), None, "remoto local");
        // "Ver PR": o repo do origin vai no --repo; origin local nem chega no gh.
        assert_eq!(pr_view_args("github.com/dono/repo", "feat/x"), ["pr", "view", "feat/x", "--web", "--repo", "github.com/dono/repo"]);
        assert!(no_pr("No pull requests found for branch \"feat/x\""));
        assert!(!no_pr("To get started with GitHub CLI, please run:  gh auth login"));
        let err = tauri::async_runtime::block_on(open_pr(tmp.join("dest/main").to_str().unwrap().into(), "main".into())).unwrap_err();
        assert!(err.contains("não é um repositório do GitHub"), "{err}");

        assert!(valid_full_name("goldtech-dev/gtech-api"));
        assert!(valid_full_name("me/repo.js"));
        for bad in ["sem-barra", "a/../b", "../x", "a/", "/b", "a/b c", "a/.."] {
            assert!(!valid_full_name(bad), "{bad}");
        }
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn adds_project_keeping_existing_config() {
        let tmp = std::env::temp_dir().join(format!("hotswap-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        assert!(Command::new("git").args(["init", "-q"]).arg(tmp.join("repo")).status().unwrap().success());
        let repo = tmp.join("repo").to_str().unwrap().to_string();
        let side = |start: &str| NewSide { repo: repo.clone(), start_command: start.into(), setup_command: "".into() };
        let proj = |name: &str| NewProject { name: name.into(), api: side("npm run dev"), front: side("") };
        let cfg = tmp.join("cfg/config.json");
        let cfg_s = cfg.to_str().unwrap();

        // Sem arquivo: cria do zero.
        add_project_to(cfg_s, &proj("a")).unwrap();
        // Com arquivo: mantém campos e ordem que já existiam.
        let raw = std::fs::read_to_string(&cfg).unwrap().replacen('{', "{\n  \"stopTimeoutMs\": 9000,", 1);
        std::fs::write(&cfg, raw).unwrap();
        add_project_to(cfg_s, &proj("b")).unwrap();

        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(v.as_object().unwrap().keys().next().unwrap(), "stopTimeoutMs");
        assert_eq!(v["stopTimeoutMs"], 9000);
        assert_eq!(v["projects"][1]["name"], "b");
        assert_eq!(v["projects"][1]["api"]["startCommand"], "npm run dev");
        assert!(v["projects"][1]["front"].get("startCommand").is_none());

        assert!(add_project_to(cfg_s, &proj("a")).is_err(), "nome repetido");
        let e = add_project_to(cfg_s, &NewProject { name: "c".into(), api: NewSide { repo: tmp.to_str().unwrap().into(), start_command: "".into(), setup_command: "".into() }, front: side("") }).unwrap_err();
        assert_eq!(e.side, Some("api"), "pasta que não é repo aponta o lado");
        std::fs::write(&cfg, "{ quebrado").unwrap();
        assert!(add_project_to(cfg_s, &proj("d")).is_err(), "não sobrescreve JSON inválido");
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), "{ quebrado");
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
