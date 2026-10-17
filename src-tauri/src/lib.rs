mod pty;
mod worktrees;

use std::path::Path;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// O app se chamava switch-terminal. Na primeira abertura como Hotswap, o config e os dados do webview
/// (última worktree por projeto, recentes, barra lateral) mudam para as pastas do nome novo.
fn migrate_from_switch_terminal() {
    let home = std::env::var("HOME").unwrap_or_default();
    let data = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| format!("{home}/.local/share"));
    move_if_new(
        Path::new(&format!("{home}/.config/switch-terminal")),
        Path::new(&format!("{home}/.config/hotswap")),
    );
    move_if_new(
        Path::new(&format!("{data}/dev.gabriel.switch-terminal")),
        Path::new(&format!("{data}/dev.gabriel.hotswap")),
    );
}

/// Move `old` para `new` só quando `new` ainda não existe: depois da primeira vez, não mexe em nada.
fn move_if_new(old: &Path, new: &Path) {
    if new.exists() || !old.exists() {
        return;
    }
    if let Err(e) = std::fs::rename(old, new) {
        eprintln!("não deu para mover {} para {}: {e}", old.display(), new.display());
    }
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Sair de verdade encerra os dev servers, então pergunta antes se houver algo rodando.
fn quit(app: &AppHandle) {
    if !app.state::<pty::Ptys>().any_busy() {
        app.exit(0);
        return;
    }
    show_window(app);
    let handle = app.clone();
    app.dialog()
        .message("Há processos rodando nos terminais. Sair encerra todos eles.")
        .title("Sair do Hotswap")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Sair".into(), "Cancelar".into()))
        .show(move |ok| {
            if ok {
                handle.exit(0);
            }
        });
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", "Mostrar janela", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?,
        ],
    )?;
    // No Linux o id vira o arquivo do ícone ($XDG_RUNTIME_DIR/tray-icon/tray-icon-<id>-0.png) e o id do
    // AppIndicator: com "main", outro app Tauri com o mesmo id sobrescreve o arquivo e as duas bandejas
    // mostram o ícone de quem abriu por último.
    let mut tray = TrayIconBuilder::with_id("hotswap")
        .tooltip("Hotswap")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "quit" => quit(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Antes do Builder: o webview abre já lendo a pasta de dados do identifier novo.
    migrate_from_switch_terminal();
    tauri::Builder::default()
        // Abrir o app de novo só traz a janela existente: duas instâncias subiriam os dev servers em dobro.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::Ptys::default())
        .setup(|app| Ok(setup_tray(app.handle())?))
        // O X só esconde na bandeja; os dev servers continuam rodando. Sair é pelo menu da bandeja.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_stop,
            pty::pty_kill_all,
            pty::pty_force,
            pty::pty_status,
            pty::ports_open,
            pty::open_url,
            pty::notify,
            worktrees::load_config,
            worktrees::add_worktree,
            worktrees::worktree_defaults,
            worktrees::add_project,
            worktrees::open_config,
            worktrees::open_in_editor,
            worktrees::list_editors,
            worktrees::set_editor,
            worktrees::set_screen_reader,
            worktrees::missing_deps_install,
            worktrees::lockfile_pm,
            worktrees::worktree_info,
            worktrees::edit_worktree,
            worktrees::remove_worktree,
            worktrees::list_worktrees,
            worktrees::git_status,
            worktrees::pull_worktree,
            worktrees::github_repos,
            worktrees::pull_requests,
            worktrees::open_pr,
            worktrees::clone_github_repo,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<pty::Ptys>().kill_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn move_if_new_moves_once_and_never_overwrites() {
        let tmp = std::env::temp_dir().join(format!("hotswap-migrate-{}", std::process::id()));
        let old = tmp.join("old");
        let new = tmp.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("config.json"), "antigo").unwrap();

        move_if_new(&old, &new);
        assert!(!old.exists());
        assert_eq!(std::fs::read_to_string(new.join("config.json")).unwrap(), "antigo");

        // O antigo reaparece (app velho ainda aberto): o novo continua valendo.
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("config.json"), "recriado").unwrap();
        move_if_new(&old, &new);
        assert_eq!(std::fs::read_to_string(new.join("config.json")).unwrap(), "antigo");
        assert!(old.exists());

        // Sem nada para mover, nada acontece.
        move_if_new(&tmp.join("nada"), &tmp.join("outro"));
        assert!(!tmp.join("outro").exists());

        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
