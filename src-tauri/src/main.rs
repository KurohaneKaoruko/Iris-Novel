#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 桌面壳：内嵌 iris-creation-server（HTTP RPC + WS + webui 静态资源），
//! 窗口直接加载 http://127.0.0.1:8765。前端与后端同源通信，
//! 与 iris-creation-server 独立部署形态行为完全一致。

use iris_creation::commands;

fn main() {
  tauri::Builder::default()
    .setup(|_app| {
      // 内嵌本地 Web 服务：托管 webui 静态资源 + RPC + WS。
      // static_dir 相对当前工作目录解析；也可用 IRIS_CREATION_STATIC_DIR /
      // IRIS_CREATION_DATA_DIR 环境变量覆盖。
      tauri::async_runtime::spawn(async move {
        let static_dir = std::env::var("IRIS_CREATION_STATIC_DIR")
          .ok()
          .map(std::path::PathBuf::from)
          .unwrap_or_else(|| std::path::PathBuf::from("webui/dist"));
        let config = iris_creation::server::ServerConfig {
          host: "127.0.0.1".to_string(),
          port: 8765,
          static_dir: Some(static_dir),
          data_dir: std::env::var("IRIS_CREATION_DATA_DIR")
            .ok()
            .map(std::path::PathBuf::from),
        };
        if let Err(e) = iris_creation::server::run(config).await {
          eprintln!("[iris] embedded server failed: {e}");
        }
      });
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    .manage(iris_creation::state::AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::ping,
      commands::agent_cli_detect,
      commands::agent_cli_run_task,
      commands::agent_cli_list_tasks,
      commands::agent_cli_get_task,
      commands::agent_cli_cancel_task,
      commands::agent_cli_decide_change,
      commands::set_workspace,
      commands::get_last_workspace,
      commands::get_project_picker_state,
      commands::get_bookshelf_state,
      commands::create_novel_project,
      commands::create_novel_work,
      commands::update_work_description,
      commands::remember_external_project,
      commands::remember_imported_work,
      commands::forget_external_project,
      commands::forget_imported_work,
      commands::set_launch_mode,
      commands::init_novel,
      commands::list_workspace_tree,
      commands::get_project_writing_settings,
      commands::set_project_writing_settings,
      commands::parse_composer_directive,
      commands::resolve_inline_references,
      commands::validate_novel_task_quality,
      commands::read_text,
      commands::write_text,
      commands::create_file,
      commands::create_dir,
      commands::delete_entry,
      commands::rename_entry,
      commands::get_app_settings,
      commands::set_app_settings,
      commands::get_api_key_status,
      commands::set_api_key,
      commands::test_provider_connectivity,
      commands::get_agents,
      commands::get_writing_assistants,
      commands::set_agents,
      commands::set_writing_assistants,
      commands::export_agents,
      commands::export_writing_assistants,
      commands::import_agents,
      commands::import_writing_assistants,
      commands::save_chat_session,
      commands::list_chat_sessions,
      commands::get_chat_session,
      commands::list_history_entries,
      commands::create_history_snapshot,
      commands::read_history_snapshot,
      commands::restore_history_snapshot,
      commands::chat_generate_stream,
      commands::chat_cancel_stream,
      commands::ai_assistance_generate,
      commands::risk_scan_content,
      commands::get_skills,
      commands::get_skill_categories,
      commands::get_skills_by_category,
      commands::apply_skill,
      commands::book_analyze,
      commands::book_extract_techniques,
      commands::analyze_book,
      commands::split_book,
      commands::extract_chapters,
      commands::ai_analyze_book_deep,
      commands::ai_split_by_ai
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
