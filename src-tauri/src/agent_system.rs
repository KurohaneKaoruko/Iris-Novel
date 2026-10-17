use crate::ai_types::ChatMessage;
use crate::app_settings::AiEditApplyMode;
use crate::commands;
use crate::prompt_config;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Instant;

fn ensure_default_ext(path: &str) -> String {
  let rel_norm = path.trim().replace('\\', "/");
  let last = rel_norm.rsplit('/').next().unwrap_or("");
  let has_ext = last.contains('.');
  if has_ext {
    return rel_norm;
  }
  if rel_norm.starts_with("stories/") {
    format!("{rel_norm}.md")
  } else if rel_norm.starts_with("concept/") || rel_norm.starts_with("outline/") {
    format!("{rel_norm}.md")
  } else {
    format!("{rel_norm}.txt")
  }
}

fn count_body_words(text: &str) -> usize {
  text.chars().filter(|c| !c.is_whitespace()).count()
}

fn collect_chapter_files(dir: &Path, prefix: &str, out: &mut Vec<Value>) -> Result<(), String> {
  for entry in fs::read_dir(dir).map_err(|e| format!("read dir failed: {e}"))? {
    let entry = entry.map_err(|e| format!("read entry failed: {e}"))?;
    let path = entry.path();
    let name = path
      .file_name()
      .map(|s| s.to_string_lossy().to_string())
      .unwrap_or_default();
    if name.is_empty() || name.starts_with('.') {
      continue;
    }
    let rel = format!("{prefix}/{name}");
    if path.is_dir() {
      collect_chapter_files(&path, &rel, out)?;
    } else if name.to_lowercase().ends_with(".md") {
      let raw = fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))?;
      out.push(serde_json::json!({
        "name": name,
        "path": rel,
        "words": count_body_words(&raw),
      }));
    }
  }
  Ok(())
}

#[derive(Clone)]
pub struct ToolContext {
  pub workspace_root: PathBuf,
}

pub type ToolFn = Box<dyn Fn(&ToolContext, Value) -> Result<Value, String> + Send + Sync>;

pub struct ToolRegistry {
  tools: HashMap<String, ToolFn>,
}

impl ToolRegistry {
  pub fn new() -> Self {
    Self { tools: HashMap::new() }
  }

  pub fn register<F>(&mut self, name: &str, f: F)
  where
    F: Fn(&ToolContext, Value) -> Result<Value, String> + Send + Sync + 'static,
  {
    self.tools.insert(name.to_string(), Box::new(f));
  }

  pub fn call(&self, ctx: &ToolContext, name: &str, args: Value) -> Result<Value, String> {
    let f = self.tools.get(name).ok_or_else(|| format!("unknown tool: {name}"))?;
    f(ctx, args)
  }

  pub fn list(&self) -> Vec<String> {
    let mut out = self.tools.keys().cloned().collect::<Vec<_>>();
    out.sort();
    out
  }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct MemoryItem {
  pub key: String,
  pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct MemoryStoreData {
  pub long_term: Vec<MemoryItem>,
}

pub struct MemoryStore {
  path: PathBuf,
  data: MemoryStoreData,
}

impl MemoryStore {
  pub fn load(workspace_root: &Path) -> Self {
    let path = workspace_root.join(".novel").join(".cache").join("agent_memory.json");
    let data = fs::read_to_string(&path)
      .ok()
      .and_then(|raw| serde_json::from_str::<MemoryStoreData>(&raw).ok())
      .unwrap_or_default();
    Self { path, data }
  }

  pub fn save(&self) -> Result<(), String> {
    if let Some(parent) = self.path.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("create memory dir failed: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(&self.data).map_err(|e| format!("serialize memory failed: {e}"))?;
    fs::write(&self.path, raw).map_err(|e| format!("write memory failed: {e}"))
  }

  pub fn upsert(&mut self, key: &str, value: &str) {
    if let Some(it) = self.data.long_term.iter_mut().find(|x| x.key == key) {
      it.value = value.to_string();
      return;
    }
    self.data.long_term.push(MemoryItem {
      key: key.to_string(),
      value: value.to_string(),
    });
  }

  pub fn search(&self, query: &str, limit: usize) -> Vec<MemoryItem> {
    let q = query.to_lowercase();
    self.data
      .long_term
      .iter()
      .filter(|it| it.key.to_lowercase().contains(&q) || it.value.to_lowercase().contains(&q))
      .take(limit)
      .cloned()
      .collect()
  }

  pub fn render(&self, limit: usize) -> String {
    let mut out = String::new();
    for it in self.data.long_term.iter().take(limit) {
      out.push_str("- ");
      out.push_str(it.key.trim());
      out.push_str(": ");
      out.push_str(it.value.trim());
      out.push('\n');
    }
    out.trim().to_string()
  }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AgentPerf {
  pub steps: u32,
  pub model_ms: u128,
  pub tool_ms: u128,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentToolEvent {
  pub action_id: String,
  pub step: u32,
  pub tool: String,
  pub args: Value,
  pub phase: String,
  pub ok: Option<bool>,
  pub observation: Option<Value>,
  pub duration_ms: Option<u128>,
}

pub struct AgentRuntime {
  ctx: ToolContext,
  tools: ToolRegistry,
  memory: MemoryStore,
}

impl ToolRegistry {
  /// 内置 AI 的小说特化白名单工具集：仅工作区受限文件工具与小说专用工具，
  /// 不包含命令执行、shell、任意进程、网络访问类工具。
  pub fn default_tools() -> Self {
    let mut tools = ToolRegistry::new();
    tools.register("fs_read_text", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      let raw = fs::read_to_string(target).map_err(|e| format!("read failed: {e}"))?;
      Ok(serde_json::json!({ "text": raw }))
    });
    tools.register("fs_list_dir", |ctx, args| {
      let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
      let rel = if path.trim().is_empty() {
        PathBuf::from("")
      } else {
        commands::validate_relative_path(path)?
      };
      let target = ctx.workspace_root.join(rel);
      let mut items: Vec<Value> = Vec::new();
      for e in fs::read_dir(target).map_err(|e| format!("read dir failed: {e}"))? {
        let e = e.map_err(|e| format!("read entry failed: {e}"))?;
        let p = e.path();
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let kind = if p.is_dir() { "dir" } else { "file" };
        items.push(serde_json::json!({ "name": name, "kind": kind }));
      }
      Ok(serde_json::json!({ "items": items }))
    });
    tools.register("fs_exists", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      let md = match fs::metadata(&target) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
          return Ok(serde_json::json!({ "exists": false }))
        }
        Err(e) => return Err(format!("stat failed: {e}")),
      };
      let kind = if md.is_dir() { "dir" } else { "file" };
      Ok(serde_json::json!({ "exists": true, "kind": kind }))
    });
    tools.register("fs_create_dir", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      fs::create_dir_all(&target).map_err(|e| format!("create dir failed: {e}"))?;
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_create_file", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let fixed = ensure_default_ext(path);
      let rel = commands::validate_relative_path(fixed.as_str())?;
      let target = ctx.workspace_root.join(rel);
      if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent dir failed: {e}"))?;
      }
      if !target.exists() {
        fs::write(&target, "").map_err(|e| format!("create file failed: {e}"))?;
      }
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_delete_entry", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      if !target.exists() {
        return Ok(serde_json::json!({ "ok": true }));
      }
      let md = fs::metadata(&target).map_err(|e| format!("stat failed: {e}"))?;
      if md.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("remove dir failed: {e}"))?;
      } else {
        fs::remove_file(&target).map_err(|e| format!("remove file failed: {e}"))?;
      }
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_rename_entry", |ctx, args| {
      let from = args
        .get("from")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.from".to_string())?;
      let to = args
        .get("to")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.to".to_string())?;
      if from.trim().is_empty() || to.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let to_fixed = ensure_default_ext(to);
      let from_rel = commands::validate_relative_path(from)?;
      let to_rel = commands::validate_relative_path(to_fixed.as_str())?;
      let from_abs = ctx.workspace_root.join(from_rel);
      let to_abs = ctx.workspace_root.join(to_rel);
      if let Some(parent) = to_abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent dir failed: {e}"))?;
      }
      fs::rename(from_abs, to_abs).map_err(|e| format!("rename failed: {e}"))?;
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_write_text", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      let text = args
        .get("text")
        .or_else(|| args.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let fixed = ensure_default_ext(path);
      commands::write_text_internal(&ctx.workspace_root, fixed.as_str(), text, true, "ai-write")?;
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("novel_list_chapters", |ctx, _args| {
      let stories = ctx.workspace_root.join("stories");
      if !stories.is_dir() {
        return Ok(serde_json::json!([]));
      }
      let mut chapters: Vec<Value> = Vec::new();
      collect_chapter_files(&stories, "stories", &mut chapters)?;
      chapters.sort_by(|a, b| {
        let pa = a.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let pb = b.get("path").and_then(|v| v.as_str()).unwrap_or("");
        pa.cmp(pb)
      });
      Ok(serde_json::json!(chapters))
    });
    tools.register("novel_read_index", |ctx, _args| {
      let read = |rel: &str| -> String {
        fs::read_to_string(ctx.workspace_root.join(rel)).unwrap_or_default()
      };
      Ok(serde_json::json!({
        "characterState": read(".novel/state/character-state-index.md"),
        "foreshadow": read(".novel/state/foreshadow-index.md"),
      }))
    });
    tools.register("novel_write_chapter", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      let text = args
        .get("text")
        .or_else(|| args.get("content"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.text".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      // 裸文件名（不含目录分隔符）视为 stories/ 下的章节；其余路径必须显式位于 stories/ 下。
      let trimmed = path.trim().replace('\\', "/");
      let with_dir = if !trimmed.contains('/') {
        format!("stories/{trimmed}")
      } else {
        trimmed
      };
      let fixed = ensure_default_ext(with_dir.as_str());
      let rel_norm = fixed.trim().replace('\\', "/");
      if rel_norm != "stories" && !rel_norm.starts_with("stories/") {
        return Err("novel_write_chapter only allows paths under stories/".to_string());
      }
      commands::validate_relative_path(rel_norm.as_str())?;
      commands::write_text_internal(
        &ctx.workspace_root,
        rel_norm.as_str(),
        text,
        true,
        "ai-write",
      )?;
      Ok(serde_json::json!({ "ok": true, "words": count_body_words(text) }))
    });
    tools
  }
}

impl AgentRuntime {
  pub fn new(workspace_root: PathBuf) -> Self {
    let ctx = ToolContext {
      workspace_root: workspace_root.clone(),
    };
    let memory = MemoryStore::load(&workspace_root);
    let tools = ToolRegistry::default_tools();
    Self { ctx, tools, memory }
  }

  pub fn tools(&self) -> Vec<String> {
    let mut out = self.tools.list();
    out.push("memory_upsert".to_string());
    out.push("memory_search".to_string());
    out.sort();
    out
  }

  pub async fn run_react<F, Fut, OnToolEvent>(
    &mut self,
    base_messages: Vec<ChatMessage>,
    agent_system_prompt: String,
    edit_apply_mode: AiEditApplyMode,
    call_model: F,
    mut on_tool_event: OnToolEvent,
  ) -> Result<(String, AgentPerf), String>
  where
    F: Fn(Vec<ChatMessage>) -> Fut,
    Fut: Future<Output = Result<String, String>>,
    OnToolEvent: FnMut(AgentToolEvent),
  {
    let mut perf = AgentPerf::default();
    let tool_list = self.tools();
    let memory_text = self.memory.render(50);
    let prompts = prompt_config::agent_prompts();
    let mode_instruction = match edit_apply_mode {
      AiEditApplyMode::AutoApply => prompts.mode_auto_apply.trim(),
      AiEditApplyMode::Review => prompts.mode_review.trim(),
    };
    let mut messages: Vec<ChatMessage> = Vec::new();
    let tool_list_text = tool_list.join(", ");
    let react_prompt = prompts
      .runtime_prompt_template
      .replace("{{SYS}}", agent_system_prompt.trim())
      .replace("{{TOOLS}}", tool_list_text.as_str());
    let react_prompt = format!("{react_prompt}\n\n{mode_instruction}");
    messages.push(ChatMessage {
      role: "system".to_string(),
      content: if memory_text.is_empty() {
        react_prompt
      } else {
        format!("{react_prompt}\n\nLong-term memory:\n{memory_text}")
      },
    });
    messages.extend(base_messages);
    let mut step = 0u32;
    let max_steps = 10u32;
    loop {
      if step >= max_steps {
        let last = messages
          .iter()
          .rev()
          .find(|m| m.role == "assistant")
          .map(|m| m.content.clone())
          .unwrap_or_default();
        if parse_tool_call(&last).is_some() {
          return Ok((
            "Model repeatedly called tools but did not produce a final answer. Ask it to summarize changes in one sentence, or inspect the file tree to verify results.".to_string(),
            perf,
          ));
        }
        return Ok((last, perf));
      }
      step += 1;
      perf.steps = step;
      let t0 = Instant::now();
      let out = call_model(messages.clone()).await?;
      perf.model_ms += t0.elapsed().as_millis();
      if let Some(call) = parse_tool_call(&out) {
        let tool_name = call.tool.clone();
        let tool_args = call.args.clone();
        let action_id = format!("step-{}", step);
        on_tool_event(AgentToolEvent {
          action_id: action_id.clone(),
          step,
          tool: tool_name.clone(),
          args: tool_args.clone(),
          phase: "start".to_string(),
          ok: None,
          observation: None,
          duration_ms: None,
        });
        let t1 = Instant::now();
        let result = if call.tool == "memory_upsert" {
          let key = call
            .args
            .get("key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing args.key".to_string())
            .and_then(|s| if s.trim().is_empty() { Err("empty args.key".to_string()) } else { Ok(s) });
          let value = call
            .args
            .get("value")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing args.value".to_string());
          match (key, value) {
            (Ok(k), Ok(v)) => {
              self.memory.upsert(k, v);
              let _ = self.memory.save();
              Ok(serde_json::json!({ "ok": true }))
            }
            (Err(e), _) | (_, Err(e)) => Err(e),
          }
        } else if call.tool == "memory_search" {
          let query = call
            .args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing args.query".to_string())?;
          let limit = call.args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
          let hits = self.memory.search(query, limit);
          Ok(serde_json::to_value(hits).unwrap_or_else(|_| serde_json::json!([])))
        } else {
          self.tools.call(&self.ctx, &call.tool, call.args.clone())
        };
        let duration_ms = t1.elapsed().as_millis();
        perf.tool_ms += duration_ms;
        let (obs, ok) = match result {
          Ok(v) => (v, true),
          Err(e) => (serde_json::json!({ "error": e }), false),
        };
        on_tool_event(AgentToolEvent {
          action_id,
          step,
          tool: tool_name,
          args: tool_args,
          phase: "finish".to_string(),
          ok: Some(ok),
          observation: Some(obs.clone()),
          duration_ms: Some(duration_ms),
        });
        let obs_text = serde_json::to_string_pretty(&obs).unwrap_or_else(|_| obs.to_string());
        messages.push(ChatMessage {
          role: "assistant".to_string(),
          content: out,
        });
        messages.push(ChatMessage {
          role: "user".to_string(),
          content: format!("OBSERVATION:\n{obs_text}"),
        });
        continue;
      }
      return Ok((out, perf));
    }
  }
}

#[derive(Clone)]
pub struct ParsedToolCall {
  pub tool: String,
  pub args: Value,
}

fn extract_json_value(input: &str) -> Option<String> {
  let s = input.trim();
  let start = s.find('{').or_else(|| s.find('['))?;
  let bytes = s.as_bytes();
  let mut i = start;
  let mut depth_brace = 0i32;
  let mut depth_bracket = 0i32;
  let mut in_string = false;
  let mut escape = false;
  while i < bytes.len() {
    let ch = bytes[i] as char;
    if in_string {
      if escape {
        escape = false;
      } else if ch == '\\' {
        escape = true;
      } else if ch == '"' {
        in_string = false;
      }
      i += 1;
      continue;
    }
    match ch {
      '"' => in_string = true,
      '{' => depth_brace += 1,
      '}' => {
        depth_brace -= 1;
        if depth_brace == 0 && depth_bracket == 0 {
          return Some(s[start..=i].to_string());
        }
      }
      '[' => depth_bracket += 1,
      ']' => {
        depth_bracket -= 1;
        if depth_brace == 0 && depth_bracket == 0 {
          return Some(s[start..=i].to_string());
        }
      }
      _ => {}
    }
    i += 1;
  }
  None
}

pub fn parse_tool_call(text: &str) -> Option<ParsedToolCall> {
  let mut tool: Option<String> = None;
  let mut input_joined: Option<String> = None;
  let mut collecting_input = false;
  for line in text.lines() {
    let t = line.trim_end();
    if t.trim_start().to_ascii_uppercase().starts_with("ACTION:") {
      tool = Some(t.splitn(2, ':').nth(1)?.trim().to_string());
      continue;
    }
    if t.trim_start().to_ascii_uppercase().starts_with("INPUT:") {
      collecting_input = true;
      let rest = t.splitn(2, ':').nth(1)?.trim().to_string();
      input_joined = Some(rest);
      continue;
    }
    if collecting_input {
      input_joined = Some(match input_joined {
        Some(mut v) => {
          v.push('\n');
          v.push_str(t);
          v
        }
        None => t.to_string(),
      });
    }
  }
  let tool = tool?;
  let input = input_joined?;
  let json_text = extract_json_value(&input).unwrap_or_else(|| input.trim().to_string());
  let args: Value = serde_json::from_str(&json_text)
    .ok()
    .or_else(|| Some(serde_json::json!({ "raw": input.trim() })))?;
  Some(ParsedToolCall { tool, args })
}

#[allow(dead_code)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct SkillDefinition {
  pub id: String,
  pub name: String,
  pub system_prompt: String,
}

#[allow(dead_code)]
pub fn default_skills() -> Vec<SkillDefinition> {
  vec![
    SkillDefinition {
      id: "writing.outline".to_string(),
      name: "生成章节大纲".to_string(),
      system_prompt: "你是写作教练，产出结构清晰的章节大纲，并给出关键冲突与转折。".to_string(),
    },
    SkillDefinition {
      id: "writing.polish".to_string(),
      name: "润色改写".to_string(),
      system_prompt: "你是文字编辑，在不改变含义的前提下优化表达、节奏与语气。".to_string(),
    },
  ]
}

#[allow(dead_code)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct McpKnowledgeItem {
  pub id: String,
  pub kind: String,
  pub content: String,
}

#[allow(dead_code)]
#[derive(Default)]
pub struct McpBroker {
  items: HashMap<String, McpKnowledgeItem>,
}

#[allow(dead_code)]
impl McpBroker {
  pub fn upsert(&mut self, item: McpKnowledgeItem) {
    self.items.insert(item.id.clone(), item);
  }

  pub fn list(&self, limit: usize) -> Vec<McpKnowledgeItem> {
    self.items.values().take(limit).cloned().collect()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn workspace_with_layout() -> tempdir::TempDirGuard {
    let guard = tempdir::create_temp_dir("novel-agent-tools-test");
    let root = guard.path();
    fs::create_dir_all(root.join("stories").join("卷一")).expect("create stories dir");
    fs::create_dir_all(root.join("concept")).expect("create concept dir");
    fs::create_dir_all(root.join(".novel").join("state")).expect("create state dir");
    fs::write(
      root.join("stories").join("第01章.md"),
      "少年推门而入，风雪灌进屋里。",
    )
    .expect("write chapter 1");
    fs::write(
      root.join("stories").join("卷一").join("第02章.md"),
      "第二 章\n正文 两个字",
    )
    .expect("write chapter 2");
    fs::write(root.join("stories").join("notes.txt"), "ignored").expect("write txt");
    fs::write(
      root.join(".novel").join("state").join("character-state-index.md"),
      "- 林照：左手旧伤未愈",
    )
    .expect("write character index");
    fs::write(
      root.join(".novel").join("state").join("foreshadow-index.md"),
      "- 断剑：未回收",
    )
    .expect("write foreshadow index");
    guard
  }

  mod tempdir {
    use std::path::{Path, PathBuf};

    pub struct TempDirGuard {
      path: PathBuf,
    }

    impl TempDirGuard {
      pub fn path(&self) -> &Path {
        &self.path
      }
    }

    impl Drop for TempDirGuard {
      fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
      }
    }

    pub fn create_temp_dir(prefix: &str) -> TempDirGuard {
      let base = std::env::temp_dir();
      for i in 0..1000u32 {
        let candidate = base.join(format!(
          "{prefix}-{}-{}-{}",
          std::process::id(),
          std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
            .wrapping_add(i.wrapping_mul(7919)),
          i
        ));
        if std::fs::create_dir(&candidate).is_ok() {
          return TempDirGuard { path: candidate };
        }
      }
      panic!("failed to create temp dir for tests");
    }
  }

  #[test]
  fn tool_whitelist_is_exact() {
    let runtime = AgentRuntime::new(PathBuf::from("/nonexistent-workspace"));
    let mut tools = runtime.tools();
    tools.sort();
    let expected = vec![
      "fs_create_dir",
      "fs_create_file",
      "fs_delete_entry",
      "fs_exists",
      "fs_list_dir",
      "fs_read_text",
      "fs_rename_entry",
      "fs_write_text",
      "memory_search",
      "memory_upsert",
      "novel_list_chapters",
      "novel_read_index",
      "novel_write_chapter",
    ];
    assert_eq!(tools, expected);
  }

  #[test]
  fn no_exec_shell_network_tools() {
    let runtime = AgentRuntime::new(PathBuf::from("/nonexistent-workspace"));
    for name in runtime.tools() {
      let lower = name.to_lowercase();
      for banned in ["exec", "shell", "bash", "network", "http", "sh"] {
        assert!(
          !lower.contains(banned),
          "banned tool name pattern '{banned}' found in '{name}'"
        );
      }
    }
  }

  #[test]
  fn fs_read_text_rejects_path_escape() {
    let guard = workspace_with_layout();
    let ctx = ToolContext {
      workspace_root: guard.path().to_path_buf(),
    };
    let tools = ToolRegistry::default_tools();
    let res = tools.call(
      &ctx,
      "fs_read_text",
      serde_json::json!({ "path": "../outside.md" }),
    );
    assert!(res.is_err(), "fs_read_text must reject ../ escape, got {:?}", res);
  }

  #[test]
  fn novel_write_chapter_rejects_non_stories_path() {
    let guard = workspace_with_layout();
    let ctx = ToolContext {
      workspace_root: guard.path().to_path_buf(),
    };
    let tools = ToolRegistry::default_tools();
    for bad in ["concept/x.md", "../evil.md", "outline/y.md"] {
      let res = tools.call(
        &ctx,
        "novel_write_chapter",
        serde_json::json!({ "path": bad, "text": "hello" }),
      );
      assert!(
        res.is_err(),
        "novel_write_chapter must reject '{bad}', got {:?}",
        res
      );
    }
    assert!(
      !guard.path().join("concept").join("x.md").exists(),
      "no file should be created outside stories/"
    );
  }

  #[test]
  fn novel_list_chapters_returns_chapters_with_words() {
    let guard = workspace_with_layout();
    let ctx = ToolContext {
      workspace_root: guard.path().to_path_buf(),
    };
    let tools = ToolRegistry::default_tools();
    let out = tools
      .call(&ctx, "novel_list_chapters", serde_json::json!({}))
      .expect("novel_list_chapters should succeed");
    let arr = out.as_array().expect("should return array");
    assert_eq!(arr.len(), 2, "only .md files under stories/ count: {arr:?}");
    let first = arr
      .iter()
      .find(|it| it.get("path").and_then(|v| v.as_str()) == Some("stories/第01章.md"))
      .expect("chapter 1 present");
    assert_eq!(first.get("name").and_then(|v| v.as_str()), Some("第01章.md"));
    // "少年推门而入，风雪灌进屋里。" -> 14 non-whitespace chars
    assert_eq!(first.get("words").and_then(|v| v.as_u64()), Some(14));
    let second = arr
      .iter()
      .find(|it| it.get("path").and_then(|v| v.as_str()) == Some("stories/卷一/第02章.md"))
      .expect("nested chapter present");
    // "第二 章\n正文 两个字" -> 8 non-whitespace chars (第二章正文两个字)
    assert_eq!(second.get("words").and_then(|v| v.as_u64()), Some(8));
  }

  #[test]
  fn novel_write_chapter_writes_into_stories() {
    let guard = workspace_with_layout();
    let ctx = ToolContext {
      workspace_root: guard.path().to_path_buf(),
    };
    let tools = ToolRegistry::default_tools();
    let text = "第三章\n新的开始";
    let out = tools
      .call(
        &ctx,
        "novel_write_chapter",
        serde_json::json!({ "path": "第03章", "text": text }),
      )
      .expect("write should succeed");
    assert_eq!(out.get("ok").and_then(|v| v.as_bool()), Some(true));
    // "第三章\n新的开始" -> 7 non-whitespace chars (第三章新的开始)
    assert_eq!(out.get("words").and_then(|v| v.as_u64()), Some(7));
    let written = fs::read_to_string(guard.path().join("stories").join("第03章.md"))
      .expect("chapter file should exist with .md ext");
    assert_eq!(written, text);
  }

  #[test]
  fn novel_read_index_returns_indexes_and_empty_when_missing() {
    let guard = workspace_with_layout();
    let ctx = ToolContext {
      workspace_root: guard.path().to_path_buf(),
    };
    let tools = ToolRegistry::default_tools();
    let out = tools
      .call(&ctx, "novel_read_index", serde_json::json!({}))
      .expect("read index should succeed");
    assert_eq!(
      out.get("characterState").and_then(|v| v.as_str()),
      Some("- 林照：左手旧伤未愈")
    );
    assert_eq!(
      out.get("foreshadow").and_then(|v| v.as_str()),
      Some("- 断剑：未回收")
    );

    let empty_root = tempdir::create_temp_dir("novel-agent-tools-empty");
    let empty_ctx = ToolContext {
      workspace_root: empty_root.path().to_path_buf(),
    };
    let out2 = tools
      .call(&empty_ctx, "novel_read_index", serde_json::json!({}))
      .expect("read index should succeed even when files missing");
    assert_eq!(out2.get("characterState").and_then(|v| v.as_str()), Some(""));
    assert_eq!(out2.get("foreshadow").and_then(|v| v.as_str()), Some(""));
  }
}
