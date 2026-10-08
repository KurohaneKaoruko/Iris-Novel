//! 文件系统域：工作区文件树、文件操作与正文辅助分析的请求/结果类型。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct FsEntry {
  pub name: String,
  pub path: String,
  pub kind: String,
  pub children: Vec<FsEntry>,
}

#[derive(Deserialize)]
pub struct NovelTaskQualityTask {
  pub id: String,
  pub target_words: u32,
  pub scope: String,
  #[serde(default)]
  pub depends_on: Vec<String>,
  #[serde(default)]
  pub acceptance_checks: Vec<String>,
}

#[derive(Deserialize)]
pub struct NovelTaskQualityRequest {
  pub task: NovelTaskQualityTask,
  pub assistant_text: String,
  #[serde(default)]
  pub task_pool: Vec<NovelTaskQualityTask>,
}

#[derive(Serialize)]
pub struct NovelTaskQualityResult {
  pub ok: bool,
  pub reason: Option<String>,
}

#[derive(Serialize)]
pub struct ComposerDirectiveParseResult {
  pub requested_mode: Option<String>,
  pub auto_action: Option<String>,
  pub content: String,
  pub matched: bool,
}

#[derive(Deserialize)]
pub struct ResolveInlineReferencesRequest {
  pub input: String,
  pub selection_text: Option<String>,
  pub active_file_path: Option<String>,
  pub active_file_content: Option<String>,
}

#[derive(Serialize)]
pub struct ResolveInlineReferencesResult {
  pub resolved_input: String,
  pub blocks_added: usize,
}

// ---- 以下由 commands.rs 等价搬移（概念索引与大纲校验）----

pub(crate) fn update_concept_index(root: &Path, rel_path: &str, content: &str) -> Result<(), String> {
  #[derive(Serialize, Deserialize, Default)]
  struct ConceptIndex {
    revision: u64,
    updated_at: String,
    files: std::collections::BTreeMap<String, ConceptFileInfo>,
  }

  #[derive(Serialize, Deserialize, Default)]
  struct ConceptFileInfo {
    hash: String,
    revision: u64,
    updated_at: String,
  }

  let index_path = root.join(".novel").join(".cache").join("concept_index.json");
  let mut index: ConceptIndex = if index_path.exists() {
    let raw = fs::read_to_string(&index_path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
  } else {
    ConceptIndex::default()
  };

  let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
    .to_string();

  let changed = index.files.get(rel_path).map(|f| f.hash.as_str() != hash).unwrap_or(true);
  if changed {
    index.revision = index.revision.saturating_add(1);
    index.updated_at = now.clone();
    index.files.insert(
      rel_path.to_string(),
      ConceptFileInfo {
        hash,
        revision: index.revision,
        updated_at: now,
      },
    );
  }

  if let Some(parent) = index_path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create concept index dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(&index).map_err(|e| format!("serialize concept index failed: {e}"))?;
  fs::write(index_path, raw).map_err(|e| format!("write concept index failed: {e}"))
}

pub(crate) fn validate_outline(existing_json: &str, new_json: &str) -> Result<(), String> {
  #[derive(Deserialize, Default)]
  struct Outline {
    #[serde(default)]
    events: Vec<Event>,
  }

  #[derive(Deserialize, Default)]
  struct Event {
    #[serde(default)]
    id: String,
    #[serde(default)]
    time: String,
    #[serde(default)]
    location: String,
    #[serde(default)]
    characters: Vec<String>,
    #[serde(default)]
    #[allow(dead_code)]
    description: String,
  }

  let existing: Outline = if existing_json.trim().is_empty() {
    Outline::default()
  } else {
    serde_json::from_str(existing_json).unwrap_or_default()
  };
  let incoming: Outline = serde_json::from_str(new_json).map_err(|e| format!("outline json invalid: {e}"))?;

  let mut combined = Vec::new();
  combined.extend(existing.events.into_iter());
  combined.extend(incoming.events.into_iter());

  let mut id_set = std::collections::BTreeMap::<String, usize>::new();
  let mut conflicts: Vec<String> = Vec::new();

  for (idx, ev) in combined.iter().enumerate() {
    if !ev.id.trim().is_empty() {
      if let Some(prev) = id_set.insert(ev.id.clone(), idx) {
        conflicts.push(format!("事件 id 重复：{}（第{}条 与 第{}条）", ev.id, prev + 1, idx + 1));
      }
    }
  }

  let mut per_character: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>> =
    std::collections::BTreeMap::new();

  for ev in combined {
    if ev.time.trim().is_empty() {
      continue;
    }
    if ev.characters.is_empty() {
      continue;
    }
    for ch in ev.characters {
      let by_time = per_character.entry(ch.clone()).or_default();
      if let Some(prev_loc) = by_time.get(&ev.time) {
        if !ev.location.trim().is_empty() && prev_loc != &ev.location {
          conflicts.push(format!("鏃堕棿绾垮啿绐侊細{} 鍦?{} 鍚屾椂鍑虹幇鍦?{} 涓?{}", ch, ev.time, prev_loc, ev.location));
        }
      } else if !ev.location.trim().is_empty() {
        by_time.insert(ev.time.clone(), ev.location.clone());
      }
    }
  }

  if conflicts.is_empty() {
    Ok(())
  } else {
    Err(conflicts.join("\n"))
  }
}
use super::workspace::{
  create_history_snapshot_internal, get_workspace_root, should_track_history_path,
  validate_relative_path,
};
use crate::state::AppState;
use std::collections::HashSet;
use regex::Regex;

// ---- 由 commands.rs 等价搬移（正文辅助分析）----
fn normalize_no_whitespace(input: &str) -> String {
  input.chars().filter(|ch| !ch.is_whitespace()).collect()
}

fn normalize_rel_path_for_read(path: &str) -> Result<PathBuf, String> {
  validate_relative_path(path)
}

fn parse_writer_mode_alias(token: &str) -> Option<&'static str> {
  let lower = token.trim().to_lowercase();
  match lower.as_str() {
    "normal" | "普通" => Some("normal"),
    "plan" | "大纲" => Some("plan"),
    "spec" | "细纲" => Some("spec"),
    _ => None,
  }
}

pub fn parse_composer_directive(input: String) -> ComposerDirectiveParseResult {
  let trimmed = input.trim();
  if !trimmed.starts_with('/') {
    return ComposerDirectiveParseResult {
      requested_mode: None,
      auto_action: None,
      content: trimmed.to_string(),
      matched: false,
    };
  }

  let mut chars = trimmed.chars();
  let _slash = chars.next();
  let after_slash = chars.as_str();
  let mut parts = after_slash.splitn(2, char::is_whitespace);
  let command = parts.next().unwrap_or("").trim();
  let rest = parts.next().unwrap_or("").trim();

  if command.eq_ignore_ascii_case("auto") {
    let arg = rest
      .split_whitespace()
      .next()
      .unwrap_or("")
      .trim()
      .to_lowercase();
    let auto_action = match arg.as_str() {
      "on" => Some("on".to_string()),
      "off" => Some("off".to_string()),
      _ => Some("toggle".to_string()),
    };
    return ComposerDirectiveParseResult {
      requested_mode: None,
      auto_action,
      content: String::new(),
      matched: true,
    };
  }

  if let Some(mode) = parse_writer_mode_alias(command) {
    return ComposerDirectiveParseResult {
      requested_mode: Some(mode.to_string()),
      auto_action: None,
      content: rest.to_string(),
      matched: true,
    };
  }

  ComposerDirectiveParseResult {
    requested_mode: None,
    auto_action: None,
    content: trimmed.to_string(),
    matched: false,
  }
}

pub fn resolve_inline_references(
  state: &AppState,
  payload: ResolveInlineReferencesRequest,
) -> Result<ResolveInlineReferencesResult, String> {
  let source = payload.input.trim().to_string();
  if !source.contains('#') {
    return Ok(ResolveInlineReferencesResult {
      resolved_input: source,
      blocks_added: 0,
    });
  }

  let selection_regex = Regex::new(r"#(?:閫夊尯|selection)\b").map_err(|e| format!("selection regex invalid: {e}"))?;
  let current_file_regex =
    Regex::new(r"#(?:褰撳墠鏂囦欢|current_file|current)\b").map_err(|e| format!("current file regex invalid: {e}"))?;
  let file_prefix_regex = Regex::new(r"#(?:鏂囦欢|file):([^\s#]+)").map_err(|e| format!("file prefix regex invalid: {e}"))?;
  let file_path_regex =
    Regex::new(r"#([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,16})").map_err(|e| format!("file path regex invalid: {e}"))?;

  let mut blocks: Vec<String> = Vec::new();
  let mut file_refs: Vec<String> = Vec::new();
  let mut seen_file_refs: HashSet<String> = HashSet::new();
  let mut cleaned = source.clone();

  let mut push_block = |title: String, body: String| {
    let normalized = body.trim().to_string();
    let final_body = if normalized.is_empty() { "(empty)".to_string() } else { normalized };
    blocks.push(format!("[{title}]\n{final_body}"));
  };

  if selection_regex.is_match(source.as_str()) {
    let selected = payload.selection_text.unwrap_or_default().trim().to_string();
    let body = if selected.is_empty() {
      "(no selection detected; select text in editor first)".to_string()
    } else {
      selected
    };
    push_block("selection".to_string(), body);
    cleaned = selection_regex.replace_all(cleaned.as_str(), "").to_string();
  }

  if current_file_regex.is_match(source.as_str()) {
    if let Some(path) = payload.active_file_path.as_ref() {
      let content = payload.active_file_content.unwrap_or_default();
      push_block(format!("current file {path}"), content);
    } else {
      push_block("current file".to_string(), "(no active file)".to_string());
    }
    cleaned = current_file_regex.replace_all(cleaned.as_str(), "").to_string();
  }

  for captures in file_prefix_regex.captures_iter(source.as_str()) {
    let Some(value) = captures.get(1) else {
      continue;
    };
    let reference = value.as_str().trim().replace('\\', "/");
    if reference.is_empty() {
      continue;
    }
    let key = reference.to_lowercase();
    if seen_file_refs.insert(key) {
      file_refs.push(reference);
    }
  }

  for captures in file_path_regex.captures_iter(source.as_str()) {
    let Some(value) = captures.get(1) else {
      continue;
    };
    let reference = value.as_str().trim().replace('\\', "/");
    if reference.is_empty() {
      continue;
    }
    let key = reference.to_lowercase();
    if seen_file_refs.insert(key) {
      file_refs.push(reference);
    }
  }

  cleaned = file_prefix_regex.replace_all(cleaned.as_str(), "").to_string();
  cleaned = file_path_regex.replace_all(cleaned.as_str(), "").to_string();
  cleaned = cleaned.trim().to_string();

  let root = get_workspace_root(state).ok();
  for reference in file_refs {
    let normalized_ref = reference.trim_start_matches("./").trim_start_matches('/');
    if normalized_ref.is_empty() {
      continue;
    }
    if root.is_none() {
      push_block(
        format!("file {normalized_ref}"),
        "(project files are unavailable in current environment)".to_string(),
      );
      continue;
    }
    let relative = match validate_relative_path(normalized_ref) {
      Ok(value) => value,
      Err(err) => {
        push_block(format!("file {normalized_ref}"), format!("read failed: {err}"));
        continue;
      }
    };
    let Some(root_path) = root.as_ref() else {
      continue;
    };
    let absolute = root_path.join(relative);
    match fs::read_to_string(&absolute) {
      Ok(content) => push_block(format!("file {normalized_ref}"), content),
      Err(err) => push_block(format!("file {normalized_ref}"), format!("read failed: {err}")),
    }
  }

  if blocks.is_empty() {
    return Ok(ResolveInlineReferencesResult {
      resolved_input: source,
      blocks_added: 0,
    });
  }

  let resolved_input = if cleaned.is_empty() {
    format!(
      "Please continue writing based on the following references.\n\n{}",
      blocks.join("\n\n")
    )
  } else {
    format!("{cleaned}\n\n[References]\n{}", blocks.join("\n\n"))
  };

  Ok(ResolveInlineReferencesResult {
    resolved_input,
    blocks_added: blocks.len(),
  })
}

pub fn validate_novel_task_quality(
  state: &AppState,
  payload: NovelTaskQualityRequest,
) -> Result<NovelTaskQualityResult, String> {
  let root = get_workspace_root(state)?;
  let task = payload.task;
  let text = payload.assistant_text.trim();
  if text.is_empty() {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some("AI returned empty content".to_string()),
    });
  }
  if !text.contains(&format!("TASK_DONE: {}", task.id)) {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some(format!("Missing completion tag TASK_DONE: {}", task.id)),
    });
  }

  let scope_rel = normalize_rel_path_for_read(task.scope.as_str())?;
  let scope_path = root.join(scope_rel);
  let content = fs::read_to_string(&scope_path)
    .map_err(|_| format!("target file is missing or unreadable: {}", task.scope))?;
  let compact = normalize_no_whitespace(content.as_str());
  let min_length = std::cmp::max(600usize, ((task.target_words as f32) * 0.42_f32) as usize);
  if compact.len() < min_length {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some(format!("file content is too short ({}/{})", compact.len(), min_length)),
    });
  }

  let lowered = content.to_lowercase();
  let placeholder_tokens = ["todo", "lorem", "xxx", "[待写]", "待补全", "待完善", "待续"];
  if placeholder_tokens.iter().any(|token| lowered.contains(token)) {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some("chapter contains placeholder text".to_string()),
    });
  }

  if !content.trim().is_empty()
    && task.acceptance_checks.iter().any(|check| check.contains("閽╁瓙"))
  {
    let tail: String = content.chars().rev().take(80).collect::<String>().chars().rev().collect();
    let has_hook_end = tail.chars().any(|ch| ['?', '!', '.', '？', '！', '。', '…'].contains(&ch));
    if !has_hook_end {
      return Ok(NovelTaskQualityResult {
        ok: false,
        reason: Some("chapter ending lacks a valid hook/closure sentence".to_string()),
      });
    }
  }

  if let Some(dep_id) = task.depends_on.first() {
    if let Some(dep_task) = payload.task_pool.iter().find(|item| item.id == *dep_id) {
      if dep_task.scope != task.scope {
        if let Ok(dep_rel) = normalize_rel_path_for_read(dep_task.scope.as_str()) {
          if let Ok(dep_content) = fs::read_to_string(root.join(dep_rel)) {
            let current_head: String = normalize_no_whitespace(content.as_str()).chars().take(140).collect();
            let dep_head: String = normalize_no_whitespace(dep_content.as_str()).chars().take(140).collect();
            if current_head.len() > 80 && dep_head.len() > 80 && current_head == dep_head {
              return Ok(NovelTaskQualityResult {
                ok: false,
                reason: Some("chapter opening is highly duplicated from dependency task".to_string()),
              });
            }
          }
        }
      }
    }
  }

  Ok(NovelTaskQualityResult {
    ok: true,
    reason: None,
  })
}

// ---- 由 commands.rs 等价搬移（文件操作）----
pub fn list_workspace_tree(state: &AppState, max_depth: usize) -> Result<FsEntry, String> {
  let root = get_workspace_root(state)?;
  build_tree(&root, &root, max_depth)
}

pub fn read_text(state: &AppState, relative_path: &str) -> Result<String, String> {
  let root = get_workspace_root(state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  fs::read_to_string(target).map_err(|e| format!("read failed: {e}"))
}

pub fn write_text(
  state: &AppState,
  relative_path: &str,
  content: &str,
) -> Result<(), String> {
  let root = get_workspace_root(state)?;
  write_text_internal(&root, &relative_path, &content, false, "auto-save")
}

pub(crate) fn write_text_internal(
  root: &Path,
  relative_path: &str,
  content: &str,
  create_parent_dirs: bool,
  history_reason: &str,
) -> Result<(), String> {
  let rel = validate_relative_path(relative_path)?;
  let target = root.join(rel);
  let rel_norm = relative_path.replace('\\', "/");

  if rel_norm == ".novel/.cache/outline.json" {
    let existing = if target.exists() {
      fs::read_to_string(&target).unwrap_or_default()
    } else {
      String::new()
    };
    validate_outline(&existing, content)?;
  }

  if let Some(parent) = target.parent() {
    if create_parent_dirs {
      fs::create_dir_all(parent).map_err(|e| format!("create parent dir failed: {e}"))?;
    } else if !parent.exists() {
      return Err("parent directory does not exist; create it first".to_string());
    }
  }

  if target.exists() && should_track_history_path(&rel_norm) {
    if let Ok(previous_content) = fs::read_to_string(&target) {
      if previous_content != content {
        let _ = create_history_snapshot_internal(root, &rel_norm, &previous_content, history_reason);
      }
    }
  }
  fs::write(&target, content).map_err(|e| format!("write failed: {e}"))?;

  if rel_norm.starts_with("concept/") && rel_norm.to_lowercase().ends_with(".md") {
    update_concept_index(root, &rel_norm, content)?;
  }

  Ok(())
}

pub fn create_file(state: &AppState, relative_path: &str) -> Result<(), String> {
  let root = get_workspace_root(state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  if let Some(parent) = target.parent() {
    if !parent.exists() {
      return Err("parent directory does not exist; create it first".to_string());
    }
  }
  fs::write(target, "").map_err(|e| format!("create file failed: {e}"))
}

pub fn create_dir(state: &AppState, relative_path: &str) -> Result<(), String> {
  if relative_path.trim().is_empty() {
    return Err("empty path is not allowed".to_string());
  }
  let root = get_workspace_root(state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  fs::create_dir_all(target).map_err(|e| format!("create dir failed: {e}"))
}

pub fn delete_entry(state: &AppState, relative_path: &str) -> Result<(), String> {
  if relative_path.trim().is_empty() {
    return Err("empty path is not allowed".to_string());
  }
  let root = get_workspace_root(state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  let md = fs::metadata(&target).map_err(|e| format!("stat failed: {e}"))?;
  if md.is_dir() {
    fs::remove_dir_all(target).map_err(|e| format!("delete dir failed: {e}"))
  } else {
    fs::remove_file(target).map_err(|e| format!("delete file failed: {e}"))
  }
}

pub fn rename_entry(state: &AppState, from_relative_path: &str, to_relative_path: &str) -> Result<(), String> {
  if from_relative_path.trim().is_empty() || to_relative_path.trim().is_empty() {
    return Err("empty path is not allowed".to_string());
  }
  let root = get_workspace_root(state)?;
  let from_rel = validate_relative_path(&from_relative_path)?;
  let to_rel = validate_relative_path(&to_relative_path)?;
  let from = root.join(from_rel);
  let to = root.join(to_rel);
  if let Some(parent) = to.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
  }
  fs::rename(from, to).map_err(|e| format!("rename failed: {e}"))
}

// ---- 由 commands.rs 等价搬移（工作区文件树）----
fn build_tree(root: &Path, path: &Path, max_depth: usize) -> Result<FsEntry, String> {
  let meta = fs::metadata(path).map_err(|e| format!("metadata failed: {e}"))?;
  let name = if path == root {
    root
      .file_name()
      .map(|s| s.to_string_lossy().to_string())
      .unwrap_or_else(|| root.to_string_lossy().to_string())
  } else {
    path
      .file_name()
      .map(|s| s.to_string_lossy().to_string())
      .unwrap_or_else(|| path.to_string_lossy().to_string())
  };
  let rel_path = path
    .strip_prefix(root)
    .unwrap_or(path)
    .to_string_lossy()
    .to_string()
    .replace('\\', "/");

  if meta.is_dir() {
    if max_depth == 0 {
      return Ok(FsEntry {
        name,
        path: rel_path,
        kind: "dir".to_string(),
        children: vec![],
      });
    }

    let mut children: Vec<FsEntry> = vec![];
    for entry in fs::read_dir(path).map_err(|e| format!("read dir failed: {e}"))? {
      let entry = entry.map_err(|e| format!("read dir entry failed: {e}"))?;
      let child_path = entry.path();
      let child = build_tree(root, &child_path, max_depth - 1)?;
      children.push(child);
    }

    children.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
      ("dir", "file") => std::cmp::Ordering::Less,
      ("file", "dir") => std::cmp::Ordering::Greater,
      _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(FsEntry {
      name,
      path: rel_path,
      kind: "dir".to_string(),
      children,
    })
  } else {
    Ok(FsEntry {
      name,
      path: rel_path,
      kind: "file".to_string(),
      children: vec![],
    })
  }
}

