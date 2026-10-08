use crate::app_settings;
use crate::agents;
use crate::agent_system;
use crate::ai_types::ChatMessage;
use crate::chat_history;
use crate::secrets;
use crate::skills::{Skill, SkillManager};
use crate::state::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::services::bookshelf::{ProjectItem, ProjectPickerState};
use crate::services::fs::{
  ComposerDirectiveParseResult, FsEntry, NovelTaskQualityRequest, NovelTaskQualityResult,
  ResolveInlineReferencesRequest, ResolveInlineReferencesResult,
};
use crate::services::settings::ProjectWritingSettings;
pub(crate) use crate::services::settings::{
  ProviderConnectivityResult, resolve_chat_provider, resolve_current_provider,
};
pub(crate) use crate::services::fs::write_text_internal;
pub(crate) use crate::services::workspace::validate_relative_path;
use crate::services::workspace::{HistoryEntry, WorkspaceInfo, get_workspace_root};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use futures_util::StreamExt;

#[tauri::command]
pub fn ping() -> &'static str {
  "pong"
}

#[tauri::command]
pub fn set_workspace(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<WorkspaceInfo, String> {
  crate::services::workspace::set_workspace(&app, &state, &path)
}

#[tauri::command]
pub fn get_last_workspace(app: AppHandle) -> Result<Option<String>, String> {
  crate::services::bookshelf::get_last_workspace(&app)
}

#[tauri::command]
pub fn get_project_picker_state(app: AppHandle) -> Result<ProjectPickerState, String> {
  crate::services::bookshelf::get_project_picker_state(&app)
}

#[tauri::command]
pub fn create_novel_project(name: String, description: Option<String>) -> Result<ProjectItem, String> {
  crate::services::bookshelf::create_novel_project(&name, description)
}

#[tauri::command]
pub fn remember_external_project(app: AppHandle, path: String) -> Result<(), String> {
  crate::services::bookshelf::remember_external_project(&app, &path)
}

#[tauri::command]
pub fn remember_imported_work(app: AppHandle, path: String) -> Result<(), String> {
  crate::services::bookshelf::remember_external_project(&app, &path)
}

#[tauri::command]
pub fn forget_external_project(app: AppHandle, path: String) -> Result<(), String> {
  crate::services::bookshelf::forget_external_project(&app, &path)
}

#[tauri::command]
pub fn forget_imported_work(app: AppHandle, path: String) -> Result<(), String> {
  crate::services::bookshelf::forget_external_project(&app, &path)
}

#[tauri::command]
pub fn set_launch_mode(app: AppHandle, mode: String) -> Result<(), String> {
  crate::services::bookshelf::set_launch_mode(&app, &mode)
}

#[tauri::command]
pub fn init_novel(state: State<'_, AppState>) -> Result<(), String> {
  crate::services::workspace::init_novel(&state)
}

#[tauri::command]
pub fn parse_composer_directive(input: String) -> ComposerDirectiveParseResult {
  crate::services::fs::parse_composer_directive(input)
}

#[tauri::command]
pub fn resolve_inline_references(
  state: State<'_, AppState>,
  payload: ResolveInlineReferencesRequest,
) -> Result<ResolveInlineReferencesResult, String> {
  crate::services::fs::resolve_inline_references(&state, payload)
}

#[tauri::command]
pub fn validate_novel_task_quality(
  state: State<'_, AppState>,
  payload: NovelTaskQualityRequest,
) -> Result<NovelTaskQualityResult, String> {
  crate::services::fs::validate_novel_task_quality(&state, payload)
}

#[tauri::command]
pub fn get_project_writing_settings(state: State<'_, AppState>) -> Result<ProjectWritingSettings, String> {
  crate::services::settings::get_project_writing_settings(&state)
}

#[tauri::command]
pub fn set_project_writing_settings(
  state: State<'_, AppState>,
  settings: ProjectWritingSettings,
) -> Result<ProjectWritingSettings, String> {
  crate::services::settings::set_project_writing_settings(&state, settings)
}

#[tauri::command]
pub fn list_workspace_tree(state: State<'_, AppState>, max_depth: usize) -> Result<FsEntry, String> {
  crate::services::fs::list_workspace_tree(&state, max_depth)
}

#[tauri::command]
pub fn read_text(state: State<'_, AppState>, relative_path: String) -> Result<String, String> {
  crate::services::fs::read_text(&state, &relative_path)
}

#[tauri::command]
pub fn write_text(
  state: State<'_, AppState>,
  relative_path: String,
  content: String,
) -> Result<(), String> {
  crate::services::fs::write_text(&state, &relative_path, &content)
}

#[tauri::command]
pub fn create_novel_work(name: String, description: Option<String>) -> Result<ProjectItem, String> {
  crate::services::bookshelf::create_novel_project(&name, description)
}

#[tauri::command]
pub fn update_work_description(path: String, description: Option<String>) -> Result<(), String> {
  crate::services::bookshelf::update_work_description(&path, description)
}

#[tauri::command]
pub fn get_bookshelf_state(app: AppHandle) -> Result<ProjectPickerState, String> {
  crate::services::bookshelf::get_project_picker_state(&app)
}

#[tauri::command]
pub fn list_history_entries(state: State<'_, AppState>, max: Option<usize>) -> Result<Vec<HistoryEntry>, String> {
  let root = get_workspace_root(&state)?;
  crate::services::workspace::list_history_entries(&root, max)
}

#[tauri::command]
pub fn create_history_snapshot(
  state: State<'_, AppState>,
  relative_path: String,
  reason: Option<String>,
) -> Result<HistoryEntry, String> {
  let root = get_workspace_root(&state)?;
  crate::services::workspace::create_history_snapshot(&root, &relative_path, reason)
}

#[tauri::command]
pub fn read_history_snapshot(state: State<'_, AppState>, id: String) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  crate::services::workspace::read_history_snapshot(&root, &id)
}

#[tauri::command]
pub fn restore_history_snapshot(state: State<'_, AppState>, id: String) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  crate::services::workspace::restore_history_snapshot(&root, &id)
}

#[tauri::command]
pub fn create_file(state: State<'_, AppState>, relative_path: String) -> Result<(), String> {
  crate::services::fs::create_file(&state, &relative_path)
}

#[tauri::command]
pub fn create_dir(state: State<'_, AppState>, relative_path: String) -> Result<(), String> {
  crate::services::fs::create_dir(&state, &relative_path)
}

#[tauri::command]
pub fn delete_entry(state: State<'_, AppState>, relative_path: String) -> Result<(), String> {
  crate::services::fs::delete_entry(&state, &relative_path)
}

#[tauri::command]
pub fn rename_entry(state: State<'_, AppState>, from_relative_path: String, to_relative_path: String) -> Result<(), String> {
  crate::services::fs::rename_entry(&state, &from_relative_path, &to_relative_path)
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<app_settings::AppSettings, String> {
  crate::services::settings::get_app_settings(&app)
}

#[tauri::command]
pub fn set_app_settings(app: AppHandle, settings: app_settings::AppSettings) -> Result<(), String> {
  crate::services::settings::set_app_settings(&app, settings)
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn get_api_key_status(app: AppHandle, providerId: Option<String>, provider_id: Option<String>) -> Result<bool, String> {
  crate::services::settings::get_api_key_status(&app, providerId, provider_id)
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn set_api_key(
  app: AppHandle,
  providerId: Option<String>,
  provider_id: Option<String>,
  apiKey: Option<String>,
  api_key: Option<String>,
) -> Result<(), String> {
  crate::services::settings::set_api_key(&app, providerId, provider_id, apiKey, api_key)
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn test_provider_connectivity(
  app: AppHandle,
  provider: app_settings::ModelProvider,
  apiKey: Option<String>,
  api_key: Option<String>,
) -> Result<ProviderConnectivityResult, String> {
  crate::services::settings::test_provider_connectivity(&app, provider, apiKey, api_key).await
}

#[tauri::command]
pub fn get_agents(app: AppHandle) -> Result<Vec<agents::Agent>, String> {
  crate::services::settings::get_agents(&app)
}

#[tauri::command]
pub fn get_writing_assistants(app: AppHandle) -> Result<Vec<agents::Agent>, String> {
  crate::services::settings::get_agents(&app)
}

#[tauri::command]
pub fn set_agents(app: AppHandle, agents_list: Vec<agents::Agent>) -> Result<(), String> {
  crate::services::settings::set_agents(&app, agents_list)
}

#[tauri::command]
pub fn set_writing_assistants(app: AppHandle, assistants: Vec<agents::Agent>) -> Result<(), String> {
  crate::services::settings::set_agents(&app, assistants)
}

#[tauri::command]
pub fn export_agents(app: AppHandle) -> Result<String, String> {
  crate::services::settings::export_agents(&app)
}

#[tauri::command]
pub fn export_writing_assistants(app: AppHandle) -> Result<String, String> {
  crate::services::settings::export_agents(&app)
}

#[tauri::command]
pub fn import_agents(app: AppHandle, json: String) -> Result<(), String> {
  crate::services::settings::import_agents(&app, json)
}

#[tauri::command]
pub fn import_writing_assistants(app: AppHandle, json: String) -> Result<(), String> {
  crate::services::settings::import_agents(&app, json)
}

#[tauri::command]
pub fn save_chat_session(app: AppHandle, session: chat_history::ChatSession) -> Result<(), String> {
  crate::services::chat::save_chat_session(&app, session)
}

#[tauri::command]
pub fn list_chat_sessions(app: AppHandle, workspace_root: Option<String>) -> Result<Vec<chat_history::ChatSessionSummary>, String> {
  crate::services::chat::list_chat_sessions(&app, workspace_root)
}

#[tauri::command]
pub fn get_chat_session(app: AppHandle, id: String) -> Result<chat_history::ChatSession, String> {
  crate::services::chat::get_chat_session(&app, &id)
}

fn emit_stream_status(window: &tauri::Window, stream_id: &str, phase: &str) {
  let _ = window.emit(
    "ai_stream_status",
    serde_json::json!({
      "streamId": stream_id,
      "phase": phase
    }),
  );
}

fn emit_stream_done(window: &tauri::Window, stream_id: &str, cancelled: bool) {
  let _ = window.emit(
    "ai_stream_done",
    serde_json::json!({
      "streamId": stream_id,
      "cancelled": cancelled
    }),
  );
}

fn clear_stream_task(app: &AppHandle, stream_id: &str) {
  let app_state = app.state::<AppState>();
  let mut tasks = match app_state.ai_stream_tasks.lock() {
    Ok(v) => v,
    Err(_) => return,
  };
  tasks.remove(stream_id);
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn chat_cancel_stream(
  window: tauri::Window,
  state: State<'_, AppState>,
  streamId: Option<String>,
  stream_id: Option<String>,
) -> Result<(), String> {
  let stream_id = streamId.or(stream_id).unwrap_or_default();
  let stream_id = stream_id.trim().to_string();
  if stream_id.is_empty() {
    return Err("stream_id is required".to_string());
  }
  let handle = {
    let mut tasks = state
      .ai_stream_tasks
      .lock()
      .map_err(|_| "stream tasks lock poisoned".to_string())?;
    tasks.remove(&stream_id)
  };
  if let Some(task) = handle {
    task.abort();
  }
  emit_stream_done(&window, &stream_id, true);
  Ok(())
}

#[derive(Clone)]
struct LiveStreamSession {
  window: tauri::Window,
  stream_id: String,
  emitted_any: Arc<AtomicBool>,
}

impl LiveStreamSession {
  fn new(window: tauri::Window, stream_id: String) -> Self {
    Self {
      window,
      stream_id,
      emitted_any: Arc::new(AtomicBool::new(false)),
    }
  }

  fn emit_token(&self, token: &str) {
    if token.is_empty() {
      return;
    }
    self.emitted_any.store(true, Ordering::Relaxed);
    let _ = self.window.emit(
      "ai_stream_token",
      serde_json::json!({
        "streamId": self.stream_id,
        "token": token
      }),
    );
  }

  fn has_emitted(&self) -> bool {
    self.emitted_any.load(Ordering::Relaxed)
  }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LiveEmitMode {
  Unknown,
  Emit,
  Suppress,
}

struct LiveEmitGate {
  mode: LiveEmitMode,
  probe: String,
}

fn action_prefix_state(text: &str) -> (bool, bool) {
  let trimmed = text.trim_start();
  if trimmed.is_empty() {
    return (false, false);
  }
  let mut head = String::new();
  for ch in trimmed.chars().take(7) {
    head.push(ch.to_ascii_uppercase());
  }
  let action = "ACTION:";
  let is_possible_prefix = action.starts_with(head.as_str());
  let is_full = head == action;
  (is_possible_prefix, is_full)
}

fn compact_preview(text: &str, max_chars: usize) -> String {
  if text.is_empty() {
    return String::new();
  }
  let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
  let mut out = String::new();
  for (idx, ch) in collapsed.chars().enumerate() {
    if idx >= max_chars {
      out.push_str("...");
      break;
    }
    out.push(ch);
  }
  out
}

fn compact_multiline_preview(text: &str, max_lines: usize, max_chars: usize) -> String {
  if text.is_empty() {
    return String::new();
  }
  let mut lines: Vec<&str> = text.lines().collect();
  if lines.is_empty() {
    lines.push(text);
  }
  let mut snippet = lines
    .iter()
    .take(max_lines)
    .copied()
    .collect::<Vec<_>>()
    .join("\n");

  let char_len = snippet.chars().count();
  if char_len > max_chars {
    snippet = snippet.chars().take(max_chars).collect::<String>();
  }

  let truncated = lines.len() > max_lines || text.chars().count() > max_chars;
  if truncated {
    if !snippet.ends_with("...") {
      snippet.push_str("\n...");
    }
  }
  snippet
}

fn compact_value_preview(value: &serde_json::Value, max_chars: usize) -> String {
  let raw = if let Some(s) = value.as_str() {
    s.to_string()
  } else {
    serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
  };
  compact_preview(raw.as_str(), max_chars)
}

impl LiveEmitGate {
  fn new() -> Self {
    Self {
      mode: LiveEmitMode::Unknown,
      probe: String::new(),
    }
  }

  fn push(&mut self, session: Option<&LiveStreamSession>, text: &str) {
    if text.is_empty() {
      return;
    }
    match self.mode {
      LiveEmitMode::Emit => {
        if let Some(s) = session {
          s.emit_token(text);
        }
      }
      LiveEmitMode::Suppress => {}
      LiveEmitMode::Unknown => {
        self.probe.push_str(text);
        let (action_prefix_possible, action_prefix_full) = action_prefix_state(&self.probe);
        if action_prefix_full {
          self.mode = LiveEmitMode::Suppress;
          self.probe.clear();
          return;
        }
        if action_prefix_possible {
          return;
        }
        self.mode = LiveEmitMode::Emit;
        if let Some(s) = session {
          s.emit_token(&self.probe);
        }
        self.probe.clear();
      }
    }
  }

  fn finalize(&mut self, session: Option<&LiveStreamSession>) {
    if self.probe.is_empty() {
      return;
    }
    let (_, action_prefix_full) = action_prefix_state(&self.probe);
    if self.mode != LiveEmitMode::Suppress && !action_prefix_full {
      if let Some(s) = session {
        s.emit_token(&self.probe);
      }
    }
    self.probe.clear();
  }
}

fn sse_take_line(buffer: &mut String) -> Option<String> {
  let pos = buffer.find('\n')?;
  let mut line = buffer[..pos].to_string();
  if line.ends_with('\r') {
    line.pop();
  }
  buffer.drain(..=pos);
  Some(line)
}


#[allow(non_snake_case)]
#[tauri::command]
pub fn chat_generate_stream(
  app: AppHandle,
  window: tauri::Window,
  state: State<'_, AppState>,
  streamId: Option<String>,
  stream_id: Option<String>,
  messages: Vec<ChatMessage>,
  useMarkdown: Option<bool>,
  use_markdown: Option<bool>,
  assistantId: Option<String>,
  assistant_id: Option<String>,
  agentId: Option<String>,
  agent_id: Option<String>,
  providerId: Option<String>,
  provider_id: Option<String>,
) -> Result<(), String> {
  let stream_id = streamId.or(stream_id).unwrap_or_default();
  let stream_id = stream_id.trim().to_string();
  if stream_id.is_empty() {
    return Err("stream_id is required".to_string());
  }
  let use_markdown = useMarkdown.or(use_markdown).unwrap_or(false);
  let agent_id = assistantId.or(assistant_id).or(agentId).or(agent_id);
  let provider_id = providerId
    .or(provider_id)
    .map(|v| v.trim().to_string())
    .filter(|v| !v.is_empty());

  let app = app.clone();
  let workspace_root = get_workspace_root(&state)?;
  let stream_id_for_task = stream_id.clone();
  let window_for_task = window.clone();
  let app_for_task = app.clone();
  let requested_provider_id = provider_id.clone();
  let live_session = LiveStreamSession::new(window_for_task.clone(), stream_id_for_task.clone());

  let task = tauri::async_runtime::spawn(async move {
    let payload_start = serde_json::json!({ "streamId": stream_id_for_task });
    let _ = window_for_task.emit("ai_stream_start", payload_start);
    emit_stream_status(&window_for_task, &stream_id_for_task, "initializing");

    let settings = match app_settings::load(&app) {
      Ok(v) => v,
      Err(e) => {
        let _ = window_for_task.emit(
          "ai_error",
          serde_json::json!({
            "streamId": stream_id_for_task,
            "stage": "settings",
            "message": e
          }),
        );
        clear_stream_task(&app_for_task, &stream_id_for_task);
        emit_stream_done(&window_for_task, &stream_id_for_task, false);
        return;
      }
    };
    let effective_use_markdown = use_markdown || settings.output.use_markdown;
    let agents_list = agents::load(&app).unwrap_or_else(|_| agents::default_agents());
    let effective_agent_id = agent_id.unwrap_or_else(|| {
      if settings.active_writing_assistant_id.trim().is_empty() {
        settings.active_agent_id.clone()
      } else {
        settings.active_writing_assistant_id.clone()
      }
    });
    let agent = agents_list
      .iter()
      .find(|a| a.id == effective_agent_id)
      .or_else(|| agents_list.iter().find(|a| a.id == "general"))
      .or_else(|| agents_list.first());
    let agent_system = agent.map(|a| a.system_prompt.clone()).unwrap_or_default();
    let agent_temp = agent.map(|a| a.temperature);
    let ai_edit_apply_mode = settings.ai_edit_apply_mode.clone();
    let client = match crate::services::build_http_client() {
      Ok(v) => v,
      Err(e) => {
        let payload = serde_json::json!({
          "streamId": stream_id_for_task,
          "stage": "provider",
          "message": e
        });
        let _ = window_for_task.emit("ai_error", payload);
        clear_stream_task(&app_for_task, &stream_id_for_task);
        emit_stream_done(&window_for_task, &stream_id_for_task, false);
        return;
      }
    };

    let current_provider = match resolve_chat_provider(&app, &settings, requested_provider_id.as_deref()) {
      Ok(p) => p,
      Err(e) => {
        eprintln!("ai_error: {}", e);
        let _ = window_for_task.emit(
          "ai_error",
          serde_json::json!({
            "streamId": stream_id_for_task,
            "provider": requested_provider_id,
            "stage": "provider",
            "message": e
          }),
        );
        clear_stream_task(&app_for_task, &stream_id_for_task);
        emit_stream_done(&window_for_task, &stream_id_for_task, false);
        return;
      }
    };

    let workspace_root_clone = workspace_root.clone();
    let mut runtime = agent_system::AgentRuntime::new(workspace_root);
    let start = Instant::now();
    emit_stream_status(&window_for_task, &stream_id_for_task, "thinking");
    let react_timeout = Duration::from_secs(240);
    let live_session_for_react = live_session.clone();
    let run_result = tokio::time::timeout(
      react_timeout,
      runtime.run_react(messages, agent_system.clone(), ai_edit_apply_mode.clone(), |msgs| {
        let provider_cfg = current_provider.clone();
        let client = client.clone();
        let app = app.clone();
        let agent_temp = agent_temp;
        let live_session_clone = live_session_for_react.clone();
        async move {
          let mut system = String::new();
          for m in msgs.iter().filter(|m| m.role == "system") {
            if !system.is_empty() {
              system.push('\n');
            }
            system.push_str(m.content.as_str());
          }
          let filtered = msgs.into_iter().filter(|m| m.role != "system").collect::<Vec<_>>();

          match provider_cfg.kind {
            app_settings::ProviderKind::OpenAI | app_settings::ProviderKind::OpenAICompatible => {
              call_openai_unbounded(
                &app,
                &client,
                &provider_cfg, // pass full provider config
                &filtered,
                system.as_str(),
                agent_temp,
                Some(&live_session_clone),
              ).await
            },
            app_settings::ProviderKind::Anthropic => {
              call_anthropic_unbounded(
                &app,
                &client,
                &provider_cfg,
                &filtered,
                system.as_str(),
                Some(&live_session_clone),
              ).await
            },
          }
        }
      }, |tool_event| {
        let input_preview = compact_value_preview(&tool_event.args, 180);
        let observation_preview = tool_event
          .observation
          .as_ref()
          .map(|value| compact_value_preview(value, 220))
          .unwrap_or_default();
        let mut payload = serde_json::json!({
          "streamId": stream_id_for_task,
          "actionId": tool_event.action_id,
          "step": tool_event.step,
          "tool": tool_event.tool,
          "phase": tool_event.phase,
          "ok": tool_event.ok,
          "durationMs": tool_event.duration_ms,
          "inputPreview": input_preview,
          "observationPreview": observation_preview,
          "timestamp": Utc::now().timestamp_millis(),
        });
        if let Some(observation) = tool_event.observation.as_ref() {
          if let Some(obj) = payload.as_object_mut() {
            match tool_event.tool.as_str() {
              "fs_list_dir" => {
                if let Some(items) = observation.get("items").and_then(|v| v.as_array()) {
                  const MAX_ITEMS: usize = 28;
                  let compact_items = items
                    .iter()
                    .take(MAX_ITEMS)
                    .filter_map(|item| {
                      let name = item.get("name").and_then(|v| v.as_str())?;
                      let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("file");
                      if name.trim().is_empty() {
                        return None;
                      }
                      if kind != "dir" && kind != "file" {
                        return None;
                      }
                      Some(serde_json::json!({
                        "name": name,
                        "kind": kind,
                      }))
                    })
                    .collect::<Vec<_>>();
                  obj.insert("listItems".to_string(), serde_json::json!(compact_items));
                  obj.insert("listTruncated".to_string(), serde_json::json!(items.len() > MAX_ITEMS));
                }
              }
              "fs_exists" => {
                if let Some(exists) = observation.get("exists").and_then(|v| v.as_bool()) {
                  obj.insert("exists".to_string(), serde_json::json!(exists));
                }
                if let Some(kind) = observation.get("kind").and_then(|v| v.as_str()) {
                  if kind == "dir" || kind == "file" {
                    obj.insert("existsKind".to_string(), serde_json::json!(kind));
                  }
                }
              }
              "fs_read_text" => {
                if let Some(path) = tool_event.args.get("path").and_then(|v| v.as_str()) {
                  obj.insert("readPath".to_string(), serde_json::json!(path));
                }
                if let Some(text) = observation.get("text").and_then(|v| v.as_str()) {
                  let lines = if text.is_empty() { 0usize } else { text.lines().count() };
                  let chars = text.chars().count();
                  let preview = compact_multiline_preview(text, 8, 420);
                  obj.insert("readLines".to_string(), serde_json::json!(lines));
                  obj.insert("readChars".to_string(), serde_json::json!(chars));
                  obj.insert("readPreview".to_string(), serde_json::json!(preview));
                }
              }
              "fs_write_text" => {
                if let Some(path) = tool_event.args.get("path").and_then(|v| v.as_str()) {
                  obj.insert("writePath".to_string(), serde_json::json!(path));
                }
                if let Some(text) = tool_event
                  .args
                  .get("text")
                  .and_then(|v| v.as_str())
                  .or_else(|| tool_event.args.get("content").and_then(|v| v.as_str()))
                {
                  let lines = if text.is_empty() { 0usize } else { text.lines().count() };
                  let chars = text.chars().count();
                  let preview = compact_multiline_preview(text, 8, 420);
                  obj.insert("writeLines".to_string(), serde_json::json!(lines));
                  obj.insert("writeChars".to_string(), serde_json::json!(chars));
                  obj.insert("writePreview".to_string(), serde_json::json!(preview));
                }
              }
              _ => {}
            }
          }
        }
        let _ = window_for_task.emit("ai_agent_step", payload);
      }),
    )
    .await;
    let (mut response, perf) = match run_result {
      Ok(v) => match v {
        Ok(v) => v,
        Err(e) => {
          eprintln!("ai_error provider={} err={}", current_provider.id, e);
          let stage = if e.contains("api key")
            || e.contains("keyring")
            || e.contains("request failed")
            || e.contains("decode failed")
            || e.contains("http ")
          {
            "provider"
          } else {
            "agent"
          };
          let payload = serde_json::json!({
            "streamId": stream_id_for_task,
            "provider": current_provider.id,
            "stage": stage,
            "message": e
          });
          let _ = window_for_task.emit("ai_error", payload);
          clear_stream_task(&app_for_task, &stream_id_for_task);
          emit_stream_done(&window_for_task, &stream_id_for_task, false);
          return;
        }
      },
      Err(_) => {
        let payload = serde_json::json!({
          "streamId": stream_id_for_task,
          "provider": current_provider.id,
          "stage": "timeout",
          "message": format!("AI runtime timed out after {} seconds", react_timeout.as_secs())
        });
        let _ = window_for_task.emit("ai_error", payload);
        clear_stream_task(&app_for_task, &stream_id_for_task);
        emit_stream_done(&window_for_task, &stream_id_for_task, false);
        return;
      }
    };
    let _ = window_for_task.emit(
      "ai_perf",
      serde_json::json!({
        "streamId": stream_id_for_task,
        "elapsed_ms": start.elapsed().as_millis(),
        "steps": perf.steps,
        "model_ms": perf.model_ms,
        "tool_ms": perf.tool_ms
      }),
    );

    if !effective_use_markdown {
      response = normalize_plaintext(&response);
    }

    if ai_edit_apply_mode == app_settings::AiEditApplyMode::Review {
      match crate::ai_response_parser::parse_ai_response(&response, &workspace_root_clone) {
        Ok(Some(cs)) => {
          let payload = serde_json::json!({
            "streamId": stream_id_for_task,
            "changeSet": cs
          });
          let _ = window_for_task.emit("ai_change_set", payload);
        }
        Ok(None) => {}
        Err(e) => {
          eprintln!("Failed to parse AI response for modifications: {}", e);
        }
      };
    }

    if !live_session.has_emitted() {
      emit_stream_status(&window_for_task, &stream_id_for_task, "responding");
      let step_chars = 48usize;
      let mut buf = String::new();
      let mut count = 0usize;
      for ch in response.chars() {
        buf.push(ch);
        count += 1;
        if count >= step_chars {
          let payload = serde_json::json!({ "streamId": stream_id_for_task, "token": buf });
          let _ = window_for_task.emit("ai_stream_token", payload);
          buf = String::new();
          count = 0;
          tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        }
      }
      if !buf.is_empty() {
        let payload = serde_json::json!({ "streamId": stream_id_for_task, "token": buf });
        let _ = window_for_task.emit("ai_stream_token", payload);
      }
    }

    clear_stream_task(&app_for_task, &stream_id_for_task);
    emit_stream_done(&window_for_task, &stream_id_for_task, false);
  });

  {
    let mut tasks = state
      .ai_stream_tasks
      .lock()
      .map_err(|_| "stream tasks lock poisoned".to_string())?;
    if let Some(prev) = tasks.insert(stream_id, task) {
      prev.abort();
    }
  }

  Ok(())
}

fn append_chunk_with_overlap(full_text: &mut String, chunk: &str) -> (usize, String) {
  const MAX_OVERLAP_CHARS: usize = 4096;
  if chunk.is_empty() {
    return (0, String::new());
  }
  if full_text.is_empty() {
    full_text.push_str(chunk);
    return (0, chunk.to_string());
  }

  let mut tail = full_text
    .chars()
    .rev()
    .take(MAX_OVERLAP_CHARS)
    .collect::<Vec<char>>();
  tail.reverse();
  let head = chunk.chars().take(MAX_OVERLAP_CHARS).collect::<Vec<char>>();
  let max_overlap = tail.len().min(head.len());

  let mut overlap = 0usize;
  for len in (1..=max_overlap).rev() {
    if tail[tail.len() - len..] == head[..len] {
      overlap = len;
      break;
    }
  }

  if overlap == 0 {
    full_text.push_str(chunk);
    return (0, chunk.to_string());
  }

  let suffix = chunk.chars().skip(overlap).collect::<String>();
  full_text.push_str(&suffix);
  (overlap, suffix)
}

async fn call_openai_unbounded(
  app: &AppHandle,
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  temperature_override: Option<f32>,
  live_stream: Option<&LiveStreamSession>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(app, &cfg.id) {
    Ok(Some(v)) => v,
    Ok(None) => cfg.api_key.trim().to_string(),
    Err(e) => return Err(format!("keyring read failed: {e}")),
  };
  if api_key.trim().is_empty() {
    return Err(format!("api key not found for provider={}", cfg.id));
  }

  let base = cfg.base_url.trim_end_matches('/');
  let url = format!("{base}/chat/completions");
  let temperature = temperature_override.unwrap_or(0.7);
  let mut out_messages: Vec<serde_json::Value> = Vec::new();
  if !system_prompt.trim().is_empty() {
    out_messages.push(serde_json::json!({
      "role": "system",
      "content": system_prompt
    }));
  }
  out_messages.extend(
    messages
      .iter()
      .map(|m| serde_json::json!({"role": m.role, "content": m.content})),
  );

  const MAX_CONTINUATIONS: usize = 64;
  const FALLBACK_CHUNK_MAX_TOKENS: u32 = 32000;
  const CONTINUE_PROMPT: &str =
    "Continue from exactly where you stopped. Do not repeat prior text.";

  let mut full_text = String::new();
  let mut gate = LiveEmitGate::new();
  let mut stream_supported = true;
  for round in 0..=MAX_CONTINUATIONS {
    let mut use_fallback_chunk_limit = false;
    let (chunk, finish_reason, stream_applied): (String, Option<String>, bool) = loop {
      if stream_supported {
        let mut body = serde_json::json!({
          "model": cfg.model_name,
          "messages": out_messages,
          "temperature": temperature,
          "stream": true
        });
        if use_fallback_chunk_limit {
          body["max_tokens"] = serde_json::json!(FALLBACK_CHUNK_MAX_TOKENS);
        }
        let resp = client
          .post(url.as_str())
          .bearer_auth(api_key.trim())
          .json(&body)
          .send()
          .await
          .map_err(|e| format!("request failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
          let raw = resp.text().await.map_err(|e| format!("decode failed: {e}"))?;
          let lowered = raw.to_lowercase();
          let looks_like_missing_max_tokens = status.is_client_error()
            && !use_fallback_chunk_limit
            && lowered.contains("max_tokens");
          if looks_like_missing_max_tokens {
            use_fallback_chunk_limit = true;
            continue;
          }
          let stream_unsupported = lowered.contains("stream")
            && (lowered.contains("not support")
              || lowered.contains("unsupported")
              || lowered.contains("invalid")
              || lowered.contains("unknown"));
          if stream_unsupported {
            stream_supported = false;
            continue;
          }
          return Err(format!("http {status}: {raw}"));
        }

        let mut sse_buf = String::new();
        let mut round_unique = String::new();
        let mut finish_reason: Option<String> = None;
        let mut body_stream = resp.bytes_stream();
        while let Some(item) = body_stream.next().await {
          let bytes = item.map_err(|e| format!("stream read failed: {e}"))?;
          sse_buf.push_str(&String::from_utf8_lossy(&bytes));
          while let Some(line) = sse_take_line(&mut sse_buf) {
            if let Some(data) = line.strip_prefix("data:") {
              let data = data.trim();
              if data.is_empty() || data == "[DONE]" {
                continue;
              }
              let value: serde_json::Value =
                serde_json::from_str(data).map_err(|e| format!("stream parse failed: {e}; data={data}"))?;
              if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                finish_reason = Some(reason.to_string());
              }
              if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
                let (_, unique_piece) = append_chunk_with_overlap(&mut full_text, content);
                if !unique_piece.is_empty() {
                  round_unique.push_str(unique_piece.as_str());
                  gate.push(live_stream, unique_piece.as_str());
                }
              }
            }
          }
        }
        if !sse_buf.trim().is_empty() {
          let line = sse_buf.trim();
          if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if !data.is_empty() && data != "[DONE]" {
              let value: serde_json::Value =
                serde_json::from_str(data).map_err(|e| format!("stream parse failed: {e}; data={data}"))?;
              if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                finish_reason = Some(reason.to_string());
              }
              if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
                let (_, unique_piece) = append_chunk_with_overlap(&mut full_text, content);
                if !unique_piece.is_empty() {
                  round_unique.push_str(unique_piece.as_str());
                  gate.push(live_stream, unique_piece.as_str());
                }
              }
            }
          }
        }
        if round_unique.is_empty() && finish_reason.is_none() {
          stream_supported = false;
          continue;
        }
        break (round_unique, finish_reason, true);
      } else {
        let mut body = serde_json::json!({
          "model": cfg.model_name,
          "messages": out_messages,
          "temperature": temperature,
          "stream": false
        });
        if use_fallback_chunk_limit {
          body["max_tokens"] = serde_json::json!(FALLBACK_CHUNK_MAX_TOKENS);
        }

        let resp = client
          .post(url.as_str())
          .bearer_auth(api_key.trim())
          .json(&body)
          .send()
          .await
          .map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        let value: serde_json::Value = resp.json().await.map_err(|e| format!("decode failed: {e}"))?;
        if status.is_success() {
          let chunk = value["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "missing choices[0].message.content".to_string())?;
          let finish_reason = value["choices"][0]["finish_reason"].as_str().map(|s| s.to_string());
          break (chunk, finish_reason, false);
        }

        let looks_like_missing_max_tokens = status.is_client_error()
          && !use_fallback_chunk_limit
          && value.to_string().to_lowercase().contains("max_tokens");
        if looks_like_missing_max_tokens {
          use_fallback_chunk_limit = true;
          continue;
        }
        return Err(format!("http {status}: {value}"));
      }
    };

    if stream_applied && chunk.is_empty() && finish_reason.is_none() {
      stream_supported = false;
      continue;
    }

    let unique_chunk = if stream_applied {
      chunk
    } else {
      let (overlap, unique_chunk) = append_chunk_with_overlap(&mut full_text, chunk.as_str());
      if overlap > 0 {
        eprintln!(
          "continuation overlap dedup provider={} round={} overlap_chars={}",
          cfg.id, round, overlap
        );
      }
      gate.push(live_stream, unique_chunk.as_str());
      unique_chunk
    };

    if finish_reason.as_deref() != Some("length") {
      gate.finalize(live_stream);
      return Ok(full_text);
    }
    if round == MAX_CONTINUATIONS {
      full_text.push_str("\n\n[output may be truncated after repeated continuations]");
      gate.push(live_stream, "\n\n[output may be truncated after repeated continuations]");
      gate.finalize(live_stream);
      return Ok(full_text);
    }

    out_messages.push(serde_json::json!({
      "role": "assistant",
      "content": unique_chunk
    }));
    out_messages.push(serde_json::json!({
      "role": "user",
      "content": CONTINUE_PROMPT
    }));
  }

  gate.finalize(live_stream);
  Ok(full_text)
}

async fn call_anthropic_unbounded(
  app: &AppHandle,
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  live_stream: Option<&LiveStreamSession>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(app, &cfg.id) {
    Ok(Some(v)) => v,
    Ok(None) => cfg.api_key.trim().to_string(),
    Err(e) => return Err(format!("keyring read failed: {e}")),
  };
  if api_key.trim().is_empty() {
    return Err(format!("api key not found for provider={}", cfg.id));
  }

  let mut out_messages: Vec<serde_json::Value> = messages
    .iter()
    .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
    .collect();
  let base = cfg.base_url.trim_end_matches('/');
  let endpoint = if base.is_empty() {
    "https://api.anthropic.com/v1/messages".to_string()
  } else if base.ends_with("/messages") {
    base.to_string()
  } else {
    format!("{base}/messages")
  };

  const MAX_CONTINUATIONS: usize = 64;
  const CHUNK_MAX_TOKENS: u32 = 32000;
  const CONTINUE_PROMPT: &str =
    "Continue from exactly where you stopped. Do not repeat prior text.";

  let mut full_text = String::new();
  let mut gate = LiveEmitGate::new();
  let mut stream_supported = true;
  for round in 0..=MAX_CONTINUATIONS {
    let (chunk, stop_reason, stream_applied): (String, Option<String>, bool) = if stream_supported {
      let body = serde_json::json!({
        "model": cfg.model_name,
        "max_tokens": CHUNK_MAX_TOKENS,
        "system": system_prompt,
        "messages": out_messages,
        "stream": true
      });

      let resp = client
        .post(endpoint.as_str())
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

      let status = resp.status();
      if !status.is_success() {
        let raw = resp.text().await.map_err(|e| format!("decode failed: {e}"))?;
        let lowered = raw.to_lowercase();
        let stream_unsupported = lowered.contains("stream")
          && (lowered.contains("not support")
            || lowered.contains("unsupported")
            || lowered.contains("invalid")
            || lowered.contains("unknown"));
        if stream_unsupported {
          stream_supported = false;
          continue;
        }
        return Err(format!("http {status}: {raw}"));
      }

      let mut sse_buf = String::new();
      let mut round_unique = String::new();
      let mut stop_reason: Option<String> = None;
      let mut body_stream = resp.bytes_stream();
      while let Some(item) = body_stream.next().await {
        let bytes = item.map_err(|e| format!("stream read failed: {e}"))?;
        sse_buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(line) = sse_take_line(&mut sse_buf) {
          if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
              continue;
            }
            let value: serde_json::Value =
              serde_json::from_str(data).map_err(|e| format!("stream parse failed: {e}; data={data}"))?;
            match value["type"].as_str().unwrap_or_default() {
              "content_block_delta" => {
                if let Some(text) = value["delta"]["text"].as_str() {
                  let (_, unique_piece) = append_chunk_with_overlap(&mut full_text, text);
                  if !unique_piece.is_empty() {
                    round_unique.push_str(unique_piece.as_str());
                    gate.push(live_stream, unique_piece.as_str());
                  }
                }
              }
              "message_delta" => {
                if let Some(reason) = value["delta"]["stop_reason"].as_str() {
                  stop_reason = Some(reason.to_string());
                }
              }
              _ => {}
            }
          }
        }
      }
      if round_unique.is_empty() && stop_reason.is_none() {
        stream_supported = false;
        continue;
      }
      (round_unique, stop_reason, true)
    } else {
      let body = serde_json::json!({
        "model": cfg.model_name,
        "max_tokens": CHUNK_MAX_TOKENS,
        "system": system_prompt,
        "messages": out_messages
      });

      let resp = client
        .post(endpoint.as_str())
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

      let status = resp.status();
      let value: serde_json::Value = resp.json().await.map_err(|e| format!("decode failed: {e}"))?;
      if !status.is_success() {
        return Err(format!("http {status}: {value}"));
      }

      let chunk = value["content"]
        .as_array()
        .map(|arr| {
          arr
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("")
        })
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing content[].text".to_string())?;
      let stop_reason = value["stop_reason"].as_str().map(|s| s.to_string());
      (chunk, stop_reason, false)
    };

    if stream_applied && chunk.is_empty() && stop_reason.is_none() {
      stream_supported = false;
      continue;
    }

    let unique_chunk = if stream_applied {
      chunk
    } else {
      let (overlap, unique_chunk) = append_chunk_with_overlap(&mut full_text, chunk.as_str());
      if overlap > 0 {
        eprintln!(
          "continuation overlap dedup provider={} round={} overlap_chars={}",
          cfg.id, round, overlap
        );
      }
      gate.push(live_stream, unique_chunk.as_str());
      unique_chunk
    };
    if stop_reason.as_deref() != Some("max_tokens") {
      gate.finalize(live_stream);
      return Ok(full_text);
    }
    if round == MAX_CONTINUATIONS {
      full_text.push_str("\n\n[output may be truncated after repeated continuations]");
      gate.push(live_stream, "\n\n[output may be truncated after repeated continuations]");
      gate.finalize(live_stream);
      return Ok(full_text);
    }

    out_messages.push(serde_json::json!({
      "role": "assistant",
      "content": unique_chunk
    }));
    out_messages.push(serde_json::json!({
      "role": "user",
      "content": CONTINUE_PROMPT
    }));
  }

  gate.finalize(live_stream);
  Ok(full_text)
}

#[tauri::command]
pub async fn ai_assistance_generate(
  app: AppHandle,
  _state: State<'_, AppState>,
  prompt: String,
) -> Result<String, String> {
  let settings = app_settings::load(&app)?;
  let client = crate::services::build_http_client()?;

  let current_provider = resolve_current_provider(&app, &settings)?;
  
  // Create a simple message for AI assistance
  let messages = vec![ChatMessage {
    role: "user".to_string(),
    content: prompt,
  }];
  
  // Call the appropriate AI provider
  match current_provider.kind {
    app_settings::ProviderKind::OpenAI | app_settings::ProviderKind::OpenAICompatible => {
      call_openai_unbounded(
        &app,
        &client,
        &current_provider,
        &messages,
        "",
        None,
        None,
      ).await
    },
    app_settings::ProviderKind::Anthropic => {
      call_anthropic_unbounded(
        &app,
        &client,
        &current_provider,
        &messages,
        "",
        None,
      ).await
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RiskFinding {
  pub level: String,
  pub category: String,
  pub excerpt: String,
  pub reason: String,
  pub suggestion: String,
  pub line_start: Option<usize>,
  pub line_end: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RiskScanResult {
  pub summary: String,
  pub overall_level: String,
  pub findings: Vec<RiskFinding>,
  pub scanned_chars: usize,
}

#[derive(Deserialize, Default)]
struct RiskFindingRaw {
  #[serde(default)]
  level: String,
  #[serde(default)]
  category: String,
  #[serde(default)]
  excerpt: String,
  #[serde(default)]
  reason: String,
  #[serde(default)]
  suggestion: String,
  #[serde(default)]
  line_start: Option<usize>,
  #[serde(default)]
  line_end: Option<usize>,
}

#[derive(Deserialize, Default)]
struct RiskScanResultRaw {
  #[serde(default)]
  summary: String,
  #[serde(default)]
  overall_level: String,
  #[serde(default)]
  findings: Vec<RiskFindingRaw>,
}

fn normalize_risk_level(level: &str) -> String {
  match level.trim().to_ascii_lowercase().as_str() {
    "high" | "critical" | "严重" | "高" => "high".to_string(),
    "medium" | "moderate" | "中" | "中等" => "medium".to_string(),
    _ => "low".to_string(),
  }
}

fn risk_level_rank(level: &str) -> u8 {
  match level {
    "high" => 3,
    "medium" => 2,
    _ => 1,
  }
}

fn clamp_text(text: &str, max_chars: usize) -> String {
  if max_chars == 0 {
    return String::new();
  }
  let mut out = String::new();
  for (idx, ch) in text.chars().enumerate() {
    if idx >= max_chars {
      out.push_str("...");
      break;
    }
    out.push(ch);
  }
  out
}

fn extract_json_block(raw: &str) -> Option<&str> {
  let start = raw.find('{')?;
  let end = raw.rfind('}')?;
  if end <= start {
    return None;
  }
  Some(&raw[start..=end])
}

fn trim_for_risk_scan(content: &str, max_chars: usize) -> String {
  let total = content.chars().count();
  if total <= max_chars {
    return content.to_string();
  }
  let half = max_chars / 2;
  let head = content.chars().take(half).collect::<String>();
  let tail = content
    .chars()
    .rev()
    .take(max_chars.saturating_sub(half))
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect::<String>();
  format!(
    "{head}\n\n...[涓棿鍐呭宸茬渷鐣ワ紝绾?{} 瀛楃]...\n\n{tail}",
    total.saturating_sub(max_chars)
  )
}

fn collect_related_chapter_snippets(root: &Path, current_file: Option<&str>) -> Vec<(String, String)> {
  let stories_dir = root.join("stories");
  if !stories_dir.is_dir() {
    return Vec::new();
  }

  let current_norm = current_file.map(|p| p.replace('\\', "/"));
  let mut files: Vec<(String, PathBuf)> = Vec::new();

  if let Ok(entries) = fs::read_dir(&stories_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if !path.is_file() {
        continue;
      }
      let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
      if ext != "md" && ext != "txt" {
        continue;
      }
      let rel = path
        .strip_prefix(root)
        .unwrap_or(&path)
        .to_string_lossy()
        .to_string()
        .replace('\\', "/");
      if current_norm.as_deref() == Some(rel.as_str()) {
        continue;
      }
      files.push((rel, path));
    }
  }

  files.sort_by(|a, b| a.0.cmp(&b.0));
  files
    .into_iter()
    .take(3)
    .filter_map(|(rel, path)| {
      fs::read_to_string(path)
        .ok()
        .map(|raw| (rel, trim_for_risk_scan(raw.trim(), 1200)))
    })
    .collect()
}

fn parse_risk_scan_result(raw: &str, scanned_chars: usize) -> RiskScanResult {
  let parsed = extract_json_block(raw)
    .and_then(|json| serde_json::from_str::<RiskScanResultRaw>(json).ok())
    .or_else(|| serde_json::from_str::<RiskScanResultRaw>(raw).ok());

  if let Some(parsed) = parsed {
    let findings = parsed
      .findings
      .into_iter()
      .map(|it| RiskFinding {
        level: normalize_risk_level(it.level.as_str()),
        category: {
          let v = it.category.trim();
          if v.is_empty() {
            "other".to_string()
          } else {
            clamp_text(v, 48)
          }
        },
        excerpt: clamp_text(it.excerpt.trim(), 200),
        reason: clamp_text(it.reason.trim(), 240),
        suggestion: clamp_text(it.suggestion.trim(), 240),
        line_start: it.line_start.filter(|v| *v > 0),
        line_end: it.line_end.filter(|v| *v > 0),
      })
      .filter(|it| !(it.excerpt.is_empty() && it.reason.is_empty()))
      .take(24)
      .collect::<Vec<_>>();

    let overall_level = {
      let explicit = normalize_risk_level(parsed.overall_level.as_str());
      if parsed.overall_level.trim().is_empty() {
        findings
          .iter()
          .map(|it| it.level.as_str())
          .max_by_key(|lvl| risk_level_rank(lvl))
          .unwrap_or("low")
          .to_string()
      } else {
        explicit
      }
    };

    let summary = {
      let value = parsed.summary.trim();
      if !value.is_empty() {
        clamp_text(value, 280)
      } else if findings.is_empty() {
        "未发现明显高风险片段，建议人工复核。".to_string()
      } else {
        format!("检测到 {} 条潜在风险，请优先处理高风险项。", findings.len())
      }
    };

    return RiskScanResult {
      summary,
      overall_level,
      findings,
      scanned_chars,
    };
  }

  RiskScanResult {
    summary: clamp_text(raw.trim(), 280),
    overall_level: "medium".to_string(),
    findings: Vec::new(),
    scanned_chars,
  }
}

fn append_risk_scan_log(root: &Path, entry: serde_json::Value) -> Result<(), String> {
  let log_dir = root.join(".novel").join(".logs");
  fs::create_dir_all(&log_dir).map_err(|e| format!("create log dir failed: {e}"))?;
  let path = log_dir.join("risk_scan.jsonl");
  let mut line = entry.to_string();
  line.push('\n');
  fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
    .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()))
    .map_err(|e| format!("append risk log failed: {e}"))
}

#[tauri::command]
pub async fn risk_scan_content(
  app: AppHandle,
  state: State<'_, AppState>,
  file_path: Option<String>,
  content: String,
) -> Result<RiskScanResult, String> {
  let root = get_workspace_root(&state)?;
  let trimmed = content.trim();
  if trimmed.is_empty() {
    return Err("content is empty".to_string());
  }

  let settings = app_settings::load(&app)?;
  let current_provider = resolve_current_provider(&app, &settings)?;
  let client = crate::services::build_http_client()?;
  let scanned_chars = content.chars().count();
  let payload_text = trim_for_risk_scan(trimmed, 30_000);
  let snippets = collect_related_chapter_snippets(&root, file_path.as_deref());

  let mut prompt = String::new();
  prompt.push_str("璇峰浠ヤ笅灏忚鍐呭鍋氬悎瑙勯闄╂娴嬶紝閲嶇偣璇嗗埆杩濇硶杩濊銆佽繃搴︽毚鍔涜鑵ャ€佹湭鎴愬勾浜轰笉褰撳唴瀹广€佷粐鎭ㄦ瑙嗐€佽壊鎯呴湶楠ㄣ€佺幇瀹炴晱鎰熼闄╃瓑闂銆俓n");
  prompt.push_str("璇疯繑鍥?JSON锛屽瓧娈靛繀椤诲畬鏁达細\n");
  prompt.push_str("{\"summary\":\"...\",\"overall_level\":\"low|medium|high\",\"findings\":[{\"level\":\"low|medium|high\",\"category\":\"...\",\"excerpt\":\"...\",\"reason\":\"...\",\"suggestion\":\"...\",\"line_start\":1,\"line_end\":1}]}\n");
  prompt.push_str("瑕佹眰锛歕n");
  prompt.push_str("- 浠呰繑鍥?JSON锛屼笉瑕?Markdown銆俓n");
  prompt.push_str("- 鑻ユ病鏈夋槑鏄鹃棶棰橈紝findings 杩斿洖绌烘暟缁勶紝overall_level=low銆俓n");
  prompt.push_str("- excerpt 蹇呴』寮曠敤鍘熸枃涓殑鐭墖娈碉紝閬垮厤杩囬暱銆俓n");
  prompt.push_str("- suggestion 缁欏嚭鍙墽琛屾敼鍐欏缓璁€俓n\n");
  if let Some(path) = file_path.as_ref().filter(|p| !p.trim().is_empty()) {
    prompt.push_str(format!("褰撳墠鏂囦欢: {}\n\n", path.trim()).as_str());
  }
  if !snippets.is_empty() {
    prompt.push_str("鐩稿叧绔犺妭涓婁笅鏂囷紙鐢ㄤ簬閬垮厤璇垽锛岄潪蹇呴』閫愭潯鐐硅瘎锛夛細\n");
    for (idx, (path, text)) in snippets.iter().enumerate() {
      prompt.push_str(format!("[Context {}] {}\n{}\n\n", idx + 1, path, text).as_str());
    }
  }
  prompt.push_str("寰呮娴嬫鏂囷細\n");
  prompt.push_str(payload_text.as_str());

  let system_prompt = "你是严格的中文小说合规审校助手，输出务必是可解析 JSON，不得包含解释文字。";
  let messages = vec![ChatMessage {
    role: "user".to_string(),
    content: prompt,
  }];

  let raw = match current_provider.kind {
    app_settings::ProviderKind::OpenAI | app_settings::ProviderKind::OpenAICompatible => {
      call_openai_unbounded(
        &app,
        &client,
        &current_provider,
        &messages,
        system_prompt,
        Some(0.2),
        None,
      )
      .await?
    }
    app_settings::ProviderKind::Anthropic => {
      call_anthropic_unbounded(
        &app,
        &client,
        &current_provider,
        &messages,
        system_prompt,
        None,
      )
      .await?
    }
  };

  let result = parse_risk_scan_result(raw.as_str(), scanned_chars);
  let _ = append_risk_scan_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "provider": current_provider.id,
      "model": current_provider.model_name,
      "file_path": file_path,
      "scanned_chars": result.scanned_chars,
      "overall_level": result.overall_level,
      "findings": result.findings.len(),
    }),
  );
  Ok(result)
}

fn normalize_plaintext(s: &str) -> String {
  let mut out: Vec<&str> = Vec::new();
  for line in s.lines() {
    let trimmed = line.trim_start_matches(|c: char| c == ' ' || c == '\t');
    if trimmed.is_empty() {
      continue;
    }
    out.push(trimmed);
  }
  out.join("\n").trim().to_string()
}


// ============ Skill Commands ============

#[tauri::command]
pub fn get_skills() -> Vec<Skill> {
    let manager = SkillManager::new();
    manager.get_all().into_iter().cloned().collect()
}

#[tauri::command]
pub fn get_skill_categories() -> Vec<String> {
    let manager = SkillManager::new();
    manager.categories()
}

#[tauri::command]
pub fn get_skills_by_category(category: String) -> Vec<Skill> {
    let manager = SkillManager::new();
    manager.get_by_category(&category).into_iter().cloned().collect()
}

#[tauri::command]
pub fn apply_skill(skill_id: String, content: String) -> String {
    let manager = SkillManager::new();
    manager.apply_skill(&skill_id, &content)
}

// ============ Book Split Commands ============

use crate::book_split::{BookAnalysis, BookSplitConfig, BookSplitResult, ChapterInfo, SplitChapter};

fn looks_like_chapter_title(line: &str) -> bool {
  let trimmed = line.trim();
  if trimmed.is_empty() || trimmed.len() > 80 {
    return false;
  }
  let lower = trimmed.to_lowercase();
  lower.starts_with("chapter ")
    || lower.starts_with("ch ")
    || (trimmed.starts_with('第') && (trimmed.contains('章') || trimmed.contains('节') || trimmed.contains('卷')))
}

#[allow(dead_code)]
#[tauri::command]
pub async fn analyze_book(content: String, title: String) -> Result<BookAnalysis, String> {
  let mut analysis = BookAnalysis::new(&title);
  analysis.total_words = content.chars().filter(|c| !c.is_whitespace()).count();

  let chapters = extract_chapters(content.clone()).await?;
  if chapters.is_empty() {
    let words = content.chars().filter(|c| !c.is_whitespace()).count();
    analysis.chapters.push(ChapterInfo {
      id: 1,
      title: "Chapter 1".to_string(),
      start_line: 0,
      end_line: content.lines().count().saturating_sub(1),
      word_count: words,
      summary: format!("Single chapter, around {} chars", words),
      key_events: vec![],
      characters_appearing: vec![],
    });
  } else {
    analysis.chapters = chapters;
  }

  analysis.outline.structure = if analysis.chapters.len() > 10 {
    "Multi-line complex structure".to_string()
  } else {
    "Linear structure".to_string()
  };
  analysis.themes = vec!["To be analyzed".to_string()];
  analysis.style = "To be analyzed".to_string();
  Ok(analysis)
}

#[allow(dead_code)]
#[tauri::command]
pub async fn split_book(content: String, title: String, config: BookSplitConfig) -> Result<BookSplitResult, String> {
  let lines: Vec<&str> = content.lines().collect();
  let target_words = config.target_chapter_words.max(500);

  let mut chapters: Vec<SplitChapter> = vec![];
  let mut current_content = String::new();
  let mut chapter_id = 1usize;
  let mut current_words = 0usize;

  for line in lines {
    current_content.push_str(line);
    current_content.push('\n');
    current_words += line.chars().filter(|c| !c.is_whitespace()).count();

    if current_words >= target_words {
      let chapter_words = current_content.chars().filter(|c| !c.is_whitespace()).count();
      chapters.push(SplitChapter {
        id: chapter_id,
        title: format!("Chapter {}", chapter_id),
        content: current_content.clone(),
        word_count: chapter_words,
        start_index: 0,
        end_index: 0,
        summary: None,
      });
      chapter_id += 1;
      current_content.clear();
      current_words = 0;
    }
  }

  if !current_content.trim().is_empty() {
    let chapter_words = current_content.chars().filter(|c| !c.is_whitespace()).count();
    chapters.push(SplitChapter {
      id: chapter_id,
      title: format!("Chapter {}", chapter_id),
      content: current_content,
      word_count: chapter_words,
      start_index: 0,
      end_index: 0,
      summary: None,
    });
  }

  let total_words: usize = chapters.iter().map(|c| c.word_count).sum();
  let mut metadata = HashMap::new();
  metadata.insert("total_chapters".to_string(), chapters.len().to_string());
  metadata.insert("target_words_per_chapter".to_string(), target_words.to_string());

  Ok(BookSplitResult {
    title: title.clone(),
    original_title: title,
    chapters,
    total_words,
    metadata,
  })
}

#[allow(dead_code)]
#[tauri::command]
pub async fn extract_chapters(content: String) -> Result<Vec<ChapterInfo>, String> {
  let lines: Vec<&str> = content.lines().collect();
  let mut chapters: Vec<ChapterInfo> = Vec::new();

  let mut current_title: Option<String> = None;
  let mut start_line: usize = 0;
  let mut current_body = String::new();

  let push_chapter = |title: String, start: usize, end: usize, body: &str, out: &mut Vec<ChapterInfo>| {
    let word_count = body.chars().filter(|c| !c.is_whitespace()).count();
    if word_count == 0 {
      return;
    }
    let id = out.len() + 1;
    out.push(ChapterInfo {
      id,
      title,
      start_line: start,
      end_line: end,
      word_count,
      summary: format!("Around {} chars", word_count),
      key_events: vec![],
      characters_appearing: vec![],
    });
  };

  for (idx, line) in lines.iter().enumerate() {
    if looks_like_chapter_title(line) {
      if let Some(title) = current_title.take() {
        push_chapter(title, start_line, idx.saturating_sub(1), current_body.as_str(), &mut chapters);
      }
      current_title = Some(line.trim().to_string());
      start_line = idx;
      current_body.clear();
      continue;
    }

    if current_title.is_some() {
      current_body.push_str(line);
      current_body.push('\n');
    }
  }

  if let Some(title) = current_title.take() {
    push_chapter(
      title,
      start_line,
      lines.len().saturating_sub(1),
      current_body.as_str(),
      &mut chapters,
    );
  }

  Ok(chapters)
}

// ============ AI Book Analysis Commands ============

#[allow(dead_code)]
#[tauri::command]
pub async fn ai_analyze_book_deep(
  _content: String,
  _title: String,
  _openai_key: String,
) -> Result<String, String> {
  Ok("AI deep analysis requires a configured provider and key.".to_string())
}

#[allow(dead_code)]
#[tauri::command]
pub async fn ai_split_by_ai(
  _content: String,
  _title: String,
  _target_words: u32,
  _openai_key: String,
) -> Result<String, String> {
  Ok("AI split-by-AI requires a configured provider and key.".to_string())
}

// ============ Book Analysis Commands ============

use crate::book_split::{
  Act,
  BookAnalysisResult,
  CharacterAnalysis,
  PowerMoment,
  TurningPoint,
  WritingTechnique,
};

#[tauri::command]
pub async fn book_analyze(content: String, title: String) -> Result<BookAnalysisResult, String> {
  let mut result = BookAnalysisResult::new(&title);
  let word_count = content.chars().filter(|c| !c.is_whitespace()).count();
  let lines: Vec<&str> = content.lines().collect();

  let detected_chapters = lines.iter().filter(|line| looks_like_chapter_title(line)).count();
  let estimated_chapters = (word_count / 3000).max(1);
  let actual_chapters = if detected_chapters > 0 { detected_chapters } else { estimated_chapters };

  result.source = "book_text".to_string();
  result.structure.r#type = if actual_chapters > 100 {
    "long multi-thread structure".to_string()
  } else if actual_chapters > 50 {
    "mid-long structure".to_string()
  } else {
    "short-mid structure".to_string()
  };
  result.structure.pacing = if word_count > 500_000 { "slow" } else { "medium" }.to_string();
  result.structure.audience = "general".to_string();

  let chapters_per_act = ((actual_chapters as f32) / 4.0).ceil() as usize;
  result.structure.acts = vec![
    Act {
      id: 1,
      name: "opening".to_string(),
      chapters: (1..=chapters_per_act.max(1)).collect(),
      description: "setup and introduction".to_string(),
    },
    Act {
      id: 2,
      name: "development".to_string(),
      chapters: (chapters_per_act + 1..=chapters_per_act * 2).collect(),
      description: "conflict development".to_string(),
    },
    Act {
      id: 3,
      name: "climax".to_string(),
      chapters: (chapters_per_act * 2 + 1..=chapters_per_act * 3).collect(),
      description: "turning point and climax".to_string(),
    },
    Act {
      id: 4,
      name: "ending".to_string(),
      chapters: (chapters_per_act * 3 + 1..=actual_chapters).collect(),
      description: "resolution".to_string(),
    },
  ];

  result.rhythm.average_chapter_length = (word_count / actual_chapters.max(1)).max(1);
  result.rhythm.conflict_density = if result.rhythm.average_chapter_length > 4500 {
    "high".to_string()
  } else if result.rhythm.average_chapter_length > 2200 {
    "medium".to_string()
  } else {
    "low".to_string()
  };
  result.rhythm.turning_points = vec![
    TurningPoint {
      chapter: actual_chapters.max(4) / 4,
      r#type: "minor_climax".to_string(),
      description: "first major conflict solved".to_string(),
    },
    TurningPoint {
      chapter: actual_chapters.max(2) / 2,
      r#type: "major_turn".to_string(),
      description: "core conflict escalates".to_string(),
    },
    TurningPoint {
      chapter: ((actual_chapters as f32) * 0.75_f32).ceil() as usize,
      r#type: "climax".to_string(),
      description: "final decisive event".to_string(),
    },
  ];
  result.rhythm.chapter_hooks = vec![
    "suspense".to_string(),
    "reversal".to_string(),
    "foreshadow payoff".to_string(),
  ];

  result.power_moments = vec![
    PowerMoment {
      chapter: actual_chapters.max(5) / 5,
      r#type: "face_slap".to_string(),
      description: "protagonist wins first public conflict".to_string(),
      frequency: "high".to_string(),
    },
    PowerMoment {
      chapter: actual_chapters.max(3) / 3,
      r#type: "reversal".to_string(),
      description: "weak-to-strong breakthrough".to_string(),
      frequency: "medium".to_string(),
    },
  ];

  result.characters = vec![CharacterAnalysis {
    name: "Protagonist".to_string(),
    role: "protagonist".to_string(),
    archetype: "growth".to_string(),
    growth: "from weak to strong".to_string(),
    main_moments: vec!["first victory".to_string(), "core breakthrough".to_string()],
    relationships: vec!["ally".to_string(), "rival".to_string()],
  }];

  result.techniques = vec![
    WritingTechnique {
      category: "narrative".to_string(),
      technique: "clear perspective".to_string(),
      example: "stable POV in each scene".to_string(),
      application: "reduce confusion".to_string(),
    },
    WritingTechnique {
      category: "pacing".to_string(),
      technique: "periodic mini climax".to_string(),
      example: "one major event every 3-5 chapters".to_string(),
      application: "keep momentum".to_string(),
    },
  ];

  result.learnable_points = vec![
    format!("Pacing: around {} chars per chapter", result.rhythm.average_chapter_length),
    "Use a four-act backbone".to_string(),
    "Keep chapter-end hooks consistent".to_string(),
  ];

  result.summary = format!(
    "\"{}\" has around {} chars and {} chapters. Structure: {}. Conflict density: {}.",
    title,
    word_count,
    actual_chapters,
    result.structure.r#type,
    result.rhythm.conflict_density,
  );

  Ok(result)
}

#[tauri::command]
pub async fn book_extract_techniques(content: String) -> Result<Vec<WritingTechnique>, String> {
  let mut techniques = vec![];

  if content.contains("突然") || content.contains("只见") || content.contains("那道") {
    techniques.push(WritingTechnique {
      category: "description".to_string(),
      technique: "visual reveal".to_string(),
      example: "sudden appearance in key scene".to_string(),
      application: "enhance scene impact".to_string(),
    });
  }

  if content.contains("系统") || content.contains("任务") || content.contains("奖励") {
    techniques.push(WritingTechnique {
      category: "plot device".to_string(),
      technique: "system trigger".to_string(),
      example: "system gives mission and reward".to_string(),
      application: "accelerate progression".to_string(),
    });
  }

  if content.contains("冷笑") || content.contains("不屑") || content.contains("嘲讽") {
    techniques.push(WritingTechnique {
      category: "dialogue".to_string(),
      technique: "provocation dialogue".to_string(),
      example: "taunting lines before conflict".to_string(),
      application: "build tension".to_string(),
    });
  }

  if techniques.is_empty() {
    techniques.push(WritingTechnique {
      category: "narrative".to_string(),
      technique: "progressive storytelling".to_string(),
      example: "clear objective -> obstacle -> payoff".to_string(),
      application: "keep story readable".to_string(),
    });
  }

  Ok(techniques)
}

