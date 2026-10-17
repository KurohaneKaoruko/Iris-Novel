//! HTTP RPC 分发：把 `/api/rpc/{command}` 映射到与服务层（Tauri 命令同源）的调用。
//!
//! 命令名与 Tauri 命令一致；参数为 JSON 对象（camelCase/snake_case 均按命令约定）。
//! 返回值包进 `{"ok": ...}` 或 `{"err": "..."}`（见 server::rpc）。

use crate::server::ServerContext;
use crate::state::AppState;
use serde_json::{Value, json};
use std::sync::Arc;

fn arg_str(args: &Value, keys: &[&str]) -> Result<String, String> {
  for k in keys {
    if let Some(v) = args.get(*k).and_then(|v| v.as_str()) {
      return Ok(v.to_string());
    }
  }
  Err(format!("missing argument: {}", keys[0]))
}

fn arg_opt_str(args: &Value, keys: &[&str]) -> Option<String> {
  for k in keys {
    if let Some(v) = args.get(*k).and_then(|v| v.as_str()) {
      return Some(v.to_string());
    }
  }
  None
}

fn arg_usize(args: &Value, keys: &[&str]) -> Result<usize, String> {
  for k in keys {
    if let Some(v) = args.get(*k).and_then(|v| v.as_u64()) {
      return Ok(v as usize);
    }
  }
  Err(format!("missing argument: {}", keys[0]))
}

fn arg_opt_usize(args: &Value, keys: &[&str]) -> Option<usize> {
  for k in keys {
    if let Some(v) = args.get(*k).and_then(|v| v.as_u64()) {
      return Some(v as usize);
    }
  }
  None
}

fn arg_t<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
  let v = args
    .get(key)
    .ok_or_else(|| format!("missing argument: {key}"))?;
  serde_json::from_value(v.clone()).map_err(|e| format!("invalid argument {key}: {e}"))
}

fn state_of(ctx: &ServerContext) -> &AppState {
  ctx.app_state.as_ref()
}

/// 取第一个 key（用于替代版）。
fn first_key(args: &Value, keys: &[&str]) -> String {
  for k in keys {
    if args.get(*k).is_some() {
      return k.to_string();
    }
  }
  keys[0].to_string()
}

pub async fn dispatch(ctx: &ServerContext, command: &str, args: Value) -> Result<Value, String> {
  let state = state_of(ctx);
  match command {
    "ping" => Ok(json!("pong")),

    // ---- workspace / bookshelf ----
    "set_workspace" => {
      let path = arg_str(&args, &["path"])?;
      let info = crate::services::workspace::set_workspace(state, &path)?;
      serde_json::to_value(info).map_err(|e| e.to_string())
    }
    "get_last_workspace" => {
      let v = crate::services::bookshelf::get_last_workspace()?;
      Ok(json!(v))
    }
    "get_project_picker_state" => {
      let v = crate::services::bookshelf::get_project_picker_state()?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "get_bookshelf_state" => {
      let v = crate::services::bookshelf::get_project_picker_state()?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "create_novel_project" | "create_novel_work" => {
      let name = arg_str(&args, &["name"])?;
      let desc = arg_opt_str(&args, &["description"]);
      let v = crate::services::bookshelf::create_novel_project(&name, desc)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "update_work_description" => {
      let path = arg_str(&args, &["path"])?;
      let desc = arg_opt_str(&args, &["description"]);
      crate::services::bookshelf::update_work_description(&path, desc)?;
      Ok(json!(null))
    }
    "remember_external_project" => {
      let path = arg_str(&args, &["path"])?;
      crate::services::bookshelf::remember_external_project(&path)?;
      Ok(json!(null))
    }
    "remember_imported_work" => {
      let path = arg_str(&args, &["path"])?;
      crate::services::bookshelf::remember_external_project(&path)?;
      Ok(json!(null))
    }
    "forget_external_project" => {
      let path = arg_str(&args, &["path"])?;
      crate::services::bookshelf::forget_external_project(&path)?;
      Ok(json!(null))
    }
    "forget_imported_work" => {
      let path = arg_str(&args, &["path"])?;
      crate::services::bookshelf::forget_external_project(&path)?;
      Ok(json!(null))
    }
    "set_launch_mode" => {
      let mode = arg_str(&args, &["mode"])?;
      crate::services::bookshelf::set_launch_mode(&mode)?;
      Ok(json!(null))
    }
    "init_novel" => {
      crate::services::workspace::init_novel(state)?;
      Ok(json!(null))
    }

    // ---- fs ----
    "list_workspace_tree" => {
      let depth = arg_usize(&args, &["max_depth", "maxDepth"])?;
      let v = crate::services::fs::list_workspace_tree(state, depth)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "read_text" => {
      let path = arg_str(&args, &["relative_path", "relativePath", "path"])?;
      crate::services::fs::read_text(state, &path).map(|v| json!(v))
    }
    "write_text" => {
      let path = arg_str(&args, &["relative_path", "relativePath", "path"])?;
      let content = arg_str(&args, &["content"])?;
      crate::services::fs::write_text(state, &path, &content).map(|_| json!(null))
    }
    "create_file" => {
      let path = arg_str(&args, &["relative_path", "relativePath", "path"])?;
      crate::services::fs::create_file(state, &path).map(|_| json!(null))
    }
    "create_dir" => {
      let path = arg_str(&args, &["relative_path", "relativePath", "path"])?;
      crate::services::fs::create_dir(state, &path).map(|_| json!(null))
    }
    "delete_entry" => {
      let path = arg_str(&args, &["relative_path", "relativePath", "path"])?;
      crate::services::fs::delete_entry(state, &path).map(|_| json!(null))
    }
    "rename_entry" => {
      let from = arg_str(&args, &["from_relative_path", "fromRelativePath", "from"])?;
      let to = arg_str(&args, &["to_relative_path", "toRelativePath", "to"])?;
      crate::services::fs::rename_entry(state, &from, &to).map(|_| json!(null))
    }
    "parse_composer_directive" => {
      let input = arg_str(&args, &["input"])?;
      let v = crate::services::fs::parse_composer_directive(input);
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "resolve_inline_references" => {
      let payload = arg_t::<crate::services::fs::ResolveInlineReferencesRequest>(&args, "payload")?;
      let v = crate::services::fs::resolve_inline_references(state, payload)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "validate_novel_task_quality" => {
      let payload = arg_t::<crate::services::fs::NovelTaskQualityRequest>(&args, "payload")?;
      let v = crate::services::fs::validate_novel_task_quality(state, payload)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }

    // ---- settings ----
    "get_project_writing_settings" => {
      let v = crate::services::settings::get_project_writing_settings(state)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "set_project_writing_settings" => {
      let settings = arg_t::<crate::services::settings::ProjectWritingSettings>(&args, "settings")?;
      let v = crate::services::settings::set_project_writing_settings(state, settings)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "get_app_settings" => {
      let v = crate::services::settings::get_app_settings()?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "set_app_settings" => {
      let settings = arg_t::<crate::app_settings::AppSettings>(&args, "settings")?;
      crate::services::settings::set_app_settings(settings)?;
      Ok(json!(null))
    }
    "get_api_key_status" => {
      let pid = arg_opt_str(&args, &["providerId", "provider_id", "provider"]);
      let v = crate::services::settings::get_api_key_status(pid.clone(), pid)?;
      Ok(json!(v))
    }
    "set_api_key" => {
      let _pid = first_key(&args, &["providerId", "provider_id", "provider"]);
      let _key = first_key(&args, &["apiKey", "api_key"]);
      let provider_id = arg_opt_str(&args, &["providerId", "provider_id", "provider"]);
      let api_key = arg_opt_str(&args, &["apiKey", "api_key"]);
      crate::services::settings::set_api_key(
        arg_opt_str(&args, &["providerId"]),
        provider_id,
        arg_opt_str(&args, &["apiKey"]),
        api_key,
      )?;
      Ok(json!(null))
    }
    "test_provider_connectivity" => {
      let provider = arg_t::<crate::app_settings::ModelProvider>(&args, "provider")?;
      let v = crate::services::settings::test_provider_connectivity(
        provider,
        arg_opt_str(&args, &["apiKey"]),
        arg_opt_str(&args, &["api_key"]),
      ).await?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "get_agents" | "get_writing_assistants" => {
      let v = crate::services::settings::get_agents()?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "set_agents" | "set_writing_assistants" => {
      let key = first_key(&args, &["agents_list", "agentsList", "agents", "assistants"]);
      let list = arg_t::<Vec<crate::agents::Agent>>(&args, &key)?;
      crate::services::settings::set_agents(list)?;
      Ok(json!(null))
    }
    "export_agents" | "export_writing_assistants" => {
      let v = crate::services::settings::export_agents()?;
      Ok(json!(v))
    }
    "import_agents" | "import_writing_assistants" => {
      let text = arg_str(&args, &["json"])?;
      crate::services::settings::import_agents(text)?;
      Ok(json!(null))
    }

    // ---- history ----
    "list_history_entries" => {
      let max = arg_opt_usize(&args, &["max"]);
      let root = crate::services::workspace::get_workspace_root(state)?;
      let v = crate::services::workspace::list_history_entries(&root, max)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "create_history_snapshot" => {
      let path = arg_str(&args, &["relative_path", "relativePath", "path"])?;
      let label = arg_opt_str(&args, &["label", "reason"]);
      let root = crate::services::workspace::get_workspace_root(state)?;
      let v = crate::services::workspace::create_history_snapshot(&root, &path, label)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "read_history_snapshot" => {
      let id = arg_str(&args, &["id"])?;
      let root = crate::services::workspace::get_workspace_root(state)?;
      crate::services::workspace::read_history_snapshot(&root, &id).map(|v| json!(v))
    }
    "restore_history_snapshot" => {
      let id = arg_str(&args, &["id"])?;
      let root = crate::services::workspace::get_workspace_root(state)?;
      crate::services::workspace::restore_history_snapshot(&root, &id).map(|v| json!(v))
    }

    // ---- chat ----
    "save_chat_session" => {
      let session = arg_t::<crate::chat_history::ChatSession>(&args, "session")?;
      crate::services::chat::save_chat_session(session)?;
      Ok(json!(null))
    }
    "list_chat_sessions" => {
      let root = arg_opt_str(&args, &["workspace_root", "workspaceRoot"]);
      let v = crate::services::chat::list_chat_sessions(root)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }
    "get_chat_session" => {
      let id = arg_str(&args, &["id"])?;
      let v = crate::services::chat::get_chat_session(&id)?;
      serde_json::to_value(v).map_err(|e| e.to_string())
    }

    // ---- ai stream ----
    "chat_generate_stream" => {
      let stream_id = arg_str(&args, &["streamId", "stream_id"])?;
      let messages = arg_t::<Vec<crate::ai_types::ChatMessage>>(&args, "messages")?;
      let use_markdown = args
        .get("use_markdown")
        .or_else(|| args.get("useMarkdown"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let agent_id = arg_opt_str(&args, &["agentId", "agent_id", "assistantId", "assistant_id"]);
      let provider_id = arg_opt_str(&args, &["providerId", "provider_id"]);
      crate::services::ai_stream::chat_generate_stream_service(
        ctx.event_sink.clone(),
        state,
        stream_id,
        messages,
        use_markdown,
        agent_id,
        provider_id,
      )?;
      Ok(json!(null))
    }
    "chat_cancel_stream" => {
      let stream_id = arg_str(&args, &["streamId", "stream_id"])?;
      crate::services::ai_stream::cancel_stream(&stream_id)?;
      crate::event_sink::EventSink::emit(
        &*ctx.event_sink,
        "ai_stream_done",
        json!({ "streamId": stream_id, "cancelled": true }),
      );
      Ok(json!(null))
    }

    // ---- skills ----
    "get_skills" => {
      use crate::skills::SkillManager;
      let manager = SkillManager::new();
      serde_json::to_value(manager.get_all()).map_err(|e| e.to_string())
    }
    "get_skill_categories" => {
      use crate::skills::SkillManager;
      let manager = SkillManager::new();
      Ok(json!(manager.categories()))
    }
    "get_skills_by_category" => {
      use crate::skills::SkillManager;
      let category = arg_str(&args, &["category"])?;
      let manager = SkillManager::new();
      serde_json::to_value(manager.get_by_category(&category)).map_err(|e| e.to_string())
    }
    "apply_skill" => {
      use crate::skills::SkillManager;
      let skill_id = arg_str(&args, &["skill_id", "skillId"])?;
      let content = arg_str(&args, &["content"])?;
      let manager = SkillManager::new();
      Ok(json!(manager.apply_skill(&skill_id, &content)))
    }

    _ => Err(format!("unknown command: {command}")),
  }
}

/// 允许 dispatch 在测试中构造裸 ServerContext。
pub fn test_context() -> ServerContext {
  let broadcast = crate::event_sink::BroadcastEventSink::new(16);
  ServerContext {
    app_state: Arc::new(AppState::default()),
    event_sink: Arc::new(broadcast.clone()),
    broadcast,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn dispatch_ping() {
    let ctx = test_context();
    let v = dispatch(&ctx, "ping", json!({})).await.unwrap();
    assert_eq!(v, json!("pong"));
  }

  #[tokio::test]
  async fn dispatch_unknown_command() {
    let ctx = test_context();
    let err = dispatch(&ctx, "no_such_command", json!({})).await.unwrap_err();
    assert!(err.contains("unknown command"));
  }

  #[tokio::test]
  async fn dispatch_missing_arg() {
    let ctx = test_context();
    let err = dispatch(&ctx, "read_text", json!({})).await.unwrap_err();
    assert!(err.contains("missing argument"));
  }
}
