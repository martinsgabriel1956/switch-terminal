mod pty;
mod worktrees;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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
        .title("Sair do switch-terminal")
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
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("switch-terminal")
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
            worktrees::load_config,
            worktrees::add_worktree,
            worktrees::worktree_defaults,
            worktrees::add_project,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<pty::Ptys>().kill_all();
            }
        });
}
