#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use iris_novel::commands;

fn main() {
  let late_sink = std::sync::Arc::new(iris_novel::event_sink::LateTauriEventSink::default());
  iris_novel::event_sink::global::init(late_sink.clone());
  let late_for_setup = late_sink.clone();
  tauri::Builder::default()
    .setup(move |app| {
      late_for_setup.bind(app.handle().clone());
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    .manage(iris_novel::state::AppState::default())
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
      commands::book_extract_techniques
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
