//! AI 流式域：流式生成任务与取消控制（与 Tauri / Web 通道无关）。
//!
//! 事件经 `EventSink` 抽象输出：桌面端为 Tauri emit，Web 端为 broadcast → WS。
//! 本模块由 Tauri 命令与本地 HTTP/WS 服务共同调用。

use crate::agent_system::{self};
use crate::agents;
use crate::app_settings::{self};
use crate::ai_types::ChatMessage;
use crate::secrets;
use crate::services::settings::resolve_chat_provider;
use crate::commands::normalize_plaintext;
use crate::services::workspace::get_workspace_root;
use std::collections::HashMap;
use chrono::Utc;
use futures_util::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub(crate) fn emit_stream_status(sink: &dyn crate::event_sink::EventSink, stream_id: &str, phase: &str) {
  sink.emit(
    "ai_stream_status",
    serde_json::json!({
      "streamId": stream_id,
      "phase": phase
    }),
  );
}

pub(crate) fn emit_stream_done(sink: &dyn crate::event_sink::EventSink, stream_id: &str, cancelled: bool) {
  sink.emit(
    "ai_stream_done",
    serde_json::json!({
      "streamId": stream_id,
      "cancelled": cancelled
    }),
  );
}

/// 全局流任务注册表：stream_id -> join handle。
/// 桌面端与 Web 端共用（同一进程内）；替代原先挂在 Tauri AppState 上的注册表。
static STREAM_TASKS: std::sync::OnceLock<std::sync::Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> =
  std::sync::OnceLock::new();

fn stream_tasks() -> &'static std::sync::Mutex<HashMap<String, tokio::task::JoinHandle<()>>> {
  STREAM_TASKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn register_stream_task(stream_id: &str, task: tokio::task::JoinHandle<()>) {
  if let Ok(mut tasks) = stream_tasks().lock() {
    if let Some(prev) = tasks.insert(stream_id.to_string(), task) {
      prev.abort();
    }
  }
}

pub(crate) fn clear_stream_task_by_id(stream_id: &str) {
  if let Ok(mut tasks) = stream_tasks().lock() {
    tasks.remove(stream_id);
  }
}

/// 取消一个流任务（桌面与 Web 共用）。
pub fn cancel_stream(stream_id: &str) -> Result<bool, String> {
  let stream_id = stream_id.trim();
  if stream_id.is_empty() {
    return Err("stream_id is required".to_string());
  }
  let handle = {
    let mut tasks = stream_tasks()
      .lock()
      .map_err(|_| "stream tasks lock poisoned".to_string())?;
    tasks.remove(stream_id)
  };
  let cancelled = handle.is_some();
  if let Some(task) = handle {
    task.abort();
  }
  Ok(cancelled)
}
#[derive(Clone)]
pub(crate) struct LiveStreamSession {
  sink: crate::event_sink::SharedEventSink,
  stream_id: String,
  emitted_any: Arc<AtomicBool>,
}

impl LiveStreamSession {
  fn new(sink: crate::event_sink::SharedEventSink, stream_id: String) -> Self {
    Self {
      sink,
      stream_id,
      emitted_any: Arc::new(AtomicBool::new(false)),
    }
  }

  fn emit_token(&self, token: &str) {
    if token.is_empty() {
      return;
    }
    self.emitted_any.store(true, Ordering::Relaxed);
    self.sink.emit(
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
pub(crate) fn chat_generate_stream_service(
  sink: crate::event_sink::SharedEventSink,
  state: &crate::state::AppState,
  stream_id: String,
  messages: Vec<ChatMessage>,
  use_markdown: bool,
  agent_id: Option<String>,
  provider_id: Option<String>,
) -> Result<(), String> {
  let workspace_root = get_workspace_root(state)?;
  let stream_id_for_task = stream_id.clone();
  let sink_for_task = sink.clone();
  let requested_provider_id = provider_id.clone();
  let live_session = LiveStreamSession::new(sink_for_task.clone(), stream_id_for_task.clone());

  let task = tokio::spawn(async move {
    let payload_start = serde_json::json!({ "streamId": stream_id_for_task });
    sink_for_task.emit("ai_stream_start", payload_start);
    emit_stream_status(sink_for_task.as_ref(), &stream_id_for_task, "initializing");

    let settings = match app_settings::load() {
      Ok(v) => v,
      Err(e) => {
        sink_for_task.emit(
          "ai_error",
          serde_json::json!({
            "streamId": stream_id_for_task,
            "stage": "settings",
            "message": e
          }),
        );
        clear_stream_task_by_id(&stream_id_for_task);
        emit_stream_done(sink_for_task.as_ref(), &stream_id_for_task, false);
        return;
      }
    };
    let effective_use_markdown = use_markdown || settings.output.use_markdown;
    let agents_list = agents::load().unwrap_or_else(|_| agents::default_agents());
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
        sink_for_task.emit("ai_error", payload);
        clear_stream_task_by_id(&stream_id_for_task);
        emit_stream_done(sink_for_task.as_ref(), &stream_id_for_task, false);
        return;
      }
    };

    let current_provider = match resolve_chat_provider(&settings, requested_provider_id.as_deref()) {
      Ok(p) => p,
      Err(e) => {
        eprintln!("ai_error: {}", e);
        sink_for_task.emit(
          "ai_error",
          serde_json::json!({
            "streamId": stream_id_for_task,
            "provider": requested_provider_id,
            "stage": "provider",
            "message": e
          }),
        );
        clear_stream_task_by_id(&stream_id_for_task);
        emit_stream_done(sink_for_task.as_ref(), &stream_id_for_task, false);
        return;
      }
    };

    let workspace_root_clone = workspace_root.clone();
    let mut runtime = agent_system::AgentRuntime::new(workspace_root);
    let start = Instant::now();
    emit_stream_status(sink_for_task.as_ref(), &stream_id_for_task, "thinking");
    let react_timeout = Duration::from_secs(240);
    let live_session_for_react = live_session.clone();
    let run_result = tokio::time::timeout(
      react_timeout,
      runtime.run_react(messages, agent_system.clone(), ai_edit_apply_mode.clone(), |msgs| {
        let provider_cfg = current_provider.clone();
        let client = client.clone();
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
        sink_for_task.emit("ai_agent_step", payload);
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
          sink_for_task.emit("ai_error", payload);
          clear_stream_task_by_id(&stream_id_for_task);
          emit_stream_done(sink_for_task.as_ref(), &stream_id_for_task, false);
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
        sink_for_task.emit("ai_error", payload);
        clear_stream_task_by_id(&stream_id_for_task);
        emit_stream_done(sink_for_task.as_ref(), &stream_id_for_task, false);
        return;
      }
    };
    sink_for_task.emit(
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
          sink_for_task.emit("ai_change_set", payload);
        }
        Ok(None) => {}
        Err(e) => {
          eprintln!("Failed to parse AI response for modifications: {}", e);
        }
      };
    }

    if !live_session.has_emitted() {
      emit_stream_status(sink_for_task.as_ref(), &stream_id_for_task, "responding");
      let step_chars = 48usize;
      let mut buf = String::new();
      let mut count = 0usize;
      for ch in response.chars() {
        buf.push(ch);
        count += 1;
        if count >= step_chars {
          let payload = serde_json::json!({ "streamId": stream_id_for_task, "token": buf });
          sink_for_task.emit("ai_stream_token", payload);
          buf = String::new();
          count = 0;
          tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        }
      }
      if !buf.is_empty() {
        let payload = serde_json::json!({ "streamId": stream_id_for_task, "token": buf });
        sink_for_task.emit("ai_stream_token", payload);
      }
    }

    clear_stream_task_by_id(&stream_id_for_task);
    emit_stream_done(sink_for_task.as_ref(), &stream_id_for_task, false);
  });

  register_stream_task(&stream_id, task);

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

pub(crate) async fn call_openai_unbounded(
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  temperature_override: Option<f32>,
  live_stream: Option<&LiveStreamSession>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(&cfg.id) {
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

pub(crate) async fn call_anthropic_unbounded(
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  live_stream: Option<&LiveStreamSession>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(&cfg.id) {
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
