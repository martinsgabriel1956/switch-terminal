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
    start_command: Option<String>,
    setup_command: Option<String>,
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
    format!("{}/.config/switch-terminal/config.json", home())
}

/// "Abrir o config.json" no projeto com erro: abre no editor padrão do sistema.
#[tauri::command]
pub fn open_config() -> Result<(), String> {
    let mut child = std::process::Command::new("xdg-open").arg(config_path()).spawn().map_err(|e| e.to_string())?;
    // Recolhe o xdg-open quando ele sair, senão fica um zumbi por clique.
    std::thread::spawn(move || child.wait());
    Ok(())
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

fn side(w: &Option<Wt>, cfg: &SideCfg) -> Option<SideView> {
    w.as_ref().map(|w| SideView {
        path: w.path.clone(),
        start_command: cfg.start_command.clone(),
        setup_command: cfg.setup_command.clone(),
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
fn add_one(repo: &str, dir: &str, branch: &str, base: &str) -> Result<(), String> {
    // Também barra "..", espaços etc.: o nome vira caminho no disco.
    git(repo, &["check-ref-format", "--branch", branch])?;
    let dir = expand(dir.trim());
    if !Path::new(&dir).is_absolute() {
        return Err(format!("diretório precisa ser um caminho absoluto: {dir}"));
    }
    let path = Path::new(&dir).join(branch);
    let path = path.to_str().ok_or("caminho inválido")?;
    let has = |r: &str| git(repo, &["rev-parse", "--verify", "--quiet", r]).is_ok();
    if has(&format!("refs/heads/{branch}")) || has(&format!("refs/remotes/origin/{branch}")) {
        git(repo, &["worktree", "add", path, branch])?;
    } else {
        if base.is_empty() {
            return Err("escolha a branch de origem".into());
        }
        git(repo, &["worktree", "add", "-b", branch, path, base])?;
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct SideRequest {
    dir: String,
    base: String,
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
        if let Err(message) = add_one(&expand(&side.repo), &req.dir, branch, req.base.trim()) {
            return Err(FormError { side: Some(key), message, created });
        }
        created.push(key);
    }
    Ok(())
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

/// Lado Node sem dependências instaladas (tem package.json, falta node_modules): o comando de instalação, escolhido
/// pelo lockfile (sem lockfile, npm), para rodar antes do startCommand. Worktree criada fora do app nasce assim,
/// e o `npm run dev` falharia por falta do binário do dev server.
#[tauri::command]
pub fn missing_deps_install(path: String) -> Option<&'static str> {
    let dir = Path::new(&path);
    if !dir.join("package.json").is_file() || dir.join("node_modules").exists() {
        return None;
    }
    let by_lock = [("pnpm-lock.yaml", "pnpm install"), ("yarn.lock", "yarn install"), ("bun.lock", "bun install"), ("bun.lockb", "bun install")];
    Some(by_lock.iter().find(|(lock, _)| dir.join(lock).is_file()).map_or("npm install", |(_, cmd)| *cmd))
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
fn gh(args: &[&str]) -> Result<String, String> {
    let out = Command::new("gh").args(args).output().map_err(|e| match e.kind() {
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

    fn wt(b: &str) -> Wt {
        Wt { branch: b.into(), path: format!("/r/{b}") }
    }

    #[test]
    fn install_only_when_node_modules_is_missing() {
        let dir = std::env::temp_dir().join(format!("switch-terminal-deps-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();

        assert_eq!(missing_deps_install(path.clone()), None, "sem package.json não é Node");
        std::fs::write(dir.join("package.json"), "{}").unwrap();
        assert_eq!(missing_deps_install(path.clone()), Some("npm install"));
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(missing_deps_install(path.clone()), Some("pnpm install"));
        std::fs::create_dir(dir.join("node_modules")).unwrap();
        assert_eq!(missing_deps_install(path), None);

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
        let tmp = std::env::temp_dir().join(format!("switch-terminal-test-{}", std::process::id()));
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

        assert!(add_one(&path("bare"), &path("bare"), "../fora", "main").is_err());
        assert!(add_one(&path("bare"), "relativo", "feat/z", "main").is_err());
        assert!(add_one(&path("bare"), &path("bare"), "feat/sem-base", "").is_err());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn bare_layout_from_clone() {
        let tmp = std::env::temp_dir().join(format!("switch-terminal-gh-{}", std::process::id()));
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

        assert!(valid_full_name("goldtech-dev/gtech-api"));
        assert!(valid_full_name("me/repo.js"));
        for bad in ["sem-barra", "a/../b", "../x", "a/", "/b", "a/b c", "a/.."] {
            assert!(!valid_full_name(bad), "{bad}");
        }
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn adds_project_keeping_existing_config() {
        let tmp = std::env::temp_dir().join(format!("switch-terminal-cfg-{}", std::process::id()));
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
