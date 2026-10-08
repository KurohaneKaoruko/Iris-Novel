//! 工作区域：工作区切换、初始化、路径校验与文件历史（快照索引）。
//!
//! 由 `crate::commands` 的 Tauri 命令薄壳调用；路径与状态参数不依赖
//! `tauri::State`，便于本地服务端复用。

use crate::state::AppState;
use super::bookshelf::{count_content_chars, save_last_workspace, work_meta_path};
use super::settings::ProjectWritingSettings;
use chrono::Utc;
use notify::{EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
pub struct WorkspaceInfo {
  pub root: String,
}

#[derive(Serialize, Clone)]
pub struct HistoryEntry {
  pub id: String,
  pub file_path: String,
  pub created_at: i64,
  pub reason: String,
  pub word_count: usize,
  pub char_count: usize,
  pub summary: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct HistoryEntryRecord {
  pub(crate) id: String,
  pub(crate) file_path: String,
  pub(crate) snapshot_rel_path: String,
  pub(crate) created_at: i64,
  pub(crate) reason: String,
  pub(crate) word_count: usize,
  pub(crate) char_count: usize,
  pub(crate) summary: String,
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct HistoryStore {
  #[serde(default)]
  pub(crate) entries: Vec<HistoryEntryRecord>,
}

pub(crate) const HISTORY_MAX_ENTRIES: usize = 800;
pub(crate) static HISTORY_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn get_workspace_root(state: &AppState) -> Result<PathBuf, String> {
  state
    .workspace_root
    .lock()
    .map_err(|_| "workspace lock poisoned")?
    .clone()
    .ok_or_else(|| "workspace not set".to_string())
}

pub(crate) fn canonicalize_path(path: &Path) -> Result<PathBuf, String> {
  fs::canonicalize(path).map_err(|e| format!("invalid path: {e}"))
}

pub(crate) fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
  let p = PathBuf::from(relative_path);
  if p.is_absolute() {
    return Err("absolute path is not allowed".to_string());
  }
  for c in p.components() {
    match c {
      Component::Normal(_) | Component::CurDir => {}
      _ => return Err("invalid relative path".to_string()),
    }
  }
  Ok(p)
}

pub fn set_workspace(app: &AppHandle, state: &AppState, path: &str) -> Result<WorkspaceInfo, String> {
  let root = canonicalize_path(Path::new(path))?;
  *state.workspace_root.lock().map_err(|_| "workspace lock poisoned")? = Some(root.clone());
  if let Ok(mut w) = state.fs_watcher.lock() {
    *w = None;
  }
  if let Err(e) = start_fs_watcher(app, state, root.clone()) {
    eprintln!("fs_watcher_start_error: {e}");
    let _ = app.emit("fs_watch_error", serde_json::json!({ "message": e }));
  }
  if let Err(e) = save_last_workspace(app, &root) {
    eprintln!("save_last_workspace_failed: {e}");
  }
  Ok(WorkspaceInfo {
    root: root.to_string_lossy().to_string(),
  })
}

fn start_fs_watcher(app: &AppHandle, state: &AppState, root: PathBuf) -> Result<(), String> {
  let app_handle = app.clone();
  let root_for_strip = root.clone();
  let mut watcher =
    notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| match res {
      Ok(event) => {
        let kind = match event.kind {
          EventKind::Create(_) => "create",
          EventKind::Modify(_) => "modify",
          EventKind::Remove(_) => "remove",
          EventKind::Access(_) => "access",
          EventKind::Other => "other",
          EventKind::Any => "any",
        };
        for p in event.paths {
          let rel = p
            .strip_prefix(&root_for_strip)
            .unwrap_or(&p)
            .to_string_lossy()
            .to_string()
            .replace('\\', "/");
          let _ = app_handle.emit("fs_changed", serde_json::json!({ "kind": kind, "path": rel }));
        }
      }
      Err(e) => {
        let _ = app_handle.emit("fs_watch_error", serde_json::json!({ "message": e.to_string() }));
      }
    })
    .map_err(|e| format!("create watcher failed: {e}"))?;
  watcher
    .watch(&root, RecursiveMode::Recursive)
    .map_err(|e| format!("watch failed: {e}"))?;
  *state.fs_watcher.lock().map_err(|_| "watcher lock poisoned")? = Some(watcher);
  Ok(())
}

pub(crate) fn write_file_if_absent(path: &Path, content: &str) -> Result<(), String> {
  if path.exists() {
    return Ok(());
  }
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
  }
  fs::write(path, content).map_err(|e| format!("write file failed: {e}"))
}

pub(crate) fn init_novel_workspace(root: &Path) -> Result<(), String> {
  let novel_dir = root.join(".novel");

  let dirs = [
    novel_dir.join(".settings"),
    novel_dir.join(".cache"),
    novel_dir.join(".history"),
    novel_dir.join(".history").join("snapshots"),
    novel_dir.join("plans"),
    novel_dir.join("tasks"),
    novel_dir.join("state"),
    root.join("stories"),
    root.join("concept"),
    root.join("outline"),
  ];

  for d in dirs {
    fs::create_dir_all(d).map_err(|e| format!("create dir failed: {e}"))?;
  }

  let concept_index = novel_dir.join(".cache").join("concept_index.json");
  if !concept_index.exists() {
    let raw = serde_json::json!({
      "revision": 0,
      "updated_at": "",
      "files": {}
    })
    .to_string();
    fs::write(concept_index, raw).map_err(|e| format!("write concept index failed: {e}"))?;
  }

  let outline_path = novel_dir.join(".cache").join("outline.json");
  if !outline_path.exists() {
    let raw = serde_json::json!({ "events": [] }).to_string();
    fs::write(outline_path, raw).map_err(|e| format!("write outline failed: {e}"))?;
  }

  let project_settings = novel_dir.join(".settings").join("project.json");
  if !project_settings.exists() {
    let raw = serde_json::to_string_pretty(&ProjectWritingSettings::default())
      .map_err(|e| format!("serialize default project settings failed: {e}"))?;
    fs::write(project_settings, raw).map_err(|e| format!("write project settings failed: {e}"))?;
  }

  let characters_path = novel_dir.join(".cache").join("characters.json");
  if !characters_path.exists() {
    let raw = serde_json::json!({ "characters": [] }).to_string();
    fs::write(characters_path, raw).map_err(|e| format!("write characters failed: {e}"))?;
  }

  let relations_path = novel_dir.join(".cache").join("relations.json");
  if !relations_path.exists() {
    let raw = serde_json::json!({ "relations": [] }).to_string();
    fs::write(relations_path, raw).map_err(|e| format!("write relations failed: {e}"))?;
  }

  let session_state = novel_dir.join("state").join("session-state.json");
  if !session_state.exists() {
    let raw = serde_json::json!({ "sessions": {} }).to_string();
    fs::write(session_state, raw).map_err(|e| format!("write session state failed: {e}"))?;
  }

  let continuity_index = novel_dir.join("state").join("continuity-index.md");
  if !continuity_index.exists() {
    let raw = "# Continuity Index\n\nTrack characters, timeline, and callbacks here.\n";
    fs::write(continuity_index, raw).map_err(|e| format!("write continuity index failed: {e}"))?;
  }

  let character_state_index = novel_dir.join("state").join("character-state-index.md");
  if !character_state_index.exists() {
    let raw = "# Character State Index\n\nTrack recent character state shifts here.\n";
    fs::write(character_state_index, raw).map_err(|e| format!("write character state index failed: {e}"))?;
  }

  let foreshadow_index = novel_dir.join("state").join("foreshadow-index.md");
  if !foreshadow_index.exists() {
    let raw = "# Foreshadow Index\n\nTrack active clues, hooks, and unresolved signals here.\n";
    fs::write(foreshadow_index, raw).map_err(|e| format!("write foreshadow index failed: {e}"))?;
  }

  let history_store = novel_dir.join(".history").join("revisions.json");
  write_file_if_absent(&history_store, "{\n  \"entries\": []\n}")?;

  let work_meta = work_meta_path(root);
  if !work_meta.exists() {
    write_file_if_absent(&work_meta, "{\n  \"description\": null\n}")?;
  }

  let outline_md = root.join("outline").join("outline.md");
  write_file_if_absent(
    &outline_md,
    "# Story Outline\n\n## Act 1\n- Setup\n\n## Act 2\n- Conflict escalates\n\n## Act 3\n- Resolution\n",
  )?;

  let characters_md = root.join("concept").join("characters.md");
  write_file_if_absent(
    &characters_md,
    "# Character Sheet\n\n## Protagonist\n- Goal:\n- Flaw:\n- Arc:\n",
  )?;

  let relations_md = root.join("concept").join("relations.md");
  write_file_if_absent(
    &relations_md,
    "# Character Relations\n\n- Protagonist -> Mentor : Trust and conflict\n",
  )?;

  let first_chapter = root.join("stories").join("chapter-0001-opening.md");
  write_file_if_absent(
    &first_chapter,
    "# Chapter 1: Opening\n\nWrite your first scene here.\n",
  )?;

  Ok(())
}

pub fn init_novel(state: &AppState) -> Result<(), String> {
  let root = get_workspace_root(state)?;
  init_novel_workspace(&root)
}

fn history_dir(root: &Path) -> PathBuf {
  root.join(".novel").join(".history")
}

fn history_index_path(root: &Path) -> PathBuf {
  history_dir(root).join("revisions.json")
}

fn history_snapshots_dir(root: &Path) -> PathBuf {
  history_dir(root).join("snapshots")
}

fn ensure_history_workspace(root: &Path) -> Result<(), String> {
  fs::create_dir_all(history_snapshots_dir(root)).map_err(|e| format!("create history dir failed: {e}"))?;
  let index = history_index_path(root);
  if !index.exists() {
    fs::write(&index, "{\n  \"entries\": []\n}").map_err(|e| format!("init history index failed: {e}"))?;
  }
  Ok(())
}

pub(crate) fn load_history_store(root: &Path) -> Result<HistoryStore, String> {
  ensure_history_workspace(root)?;
  let raw = fs::read_to_string(history_index_path(root)).map_err(|e| format!("read history index failed: {e}"))?;
  serde_json::from_str::<HistoryStore>(&raw).map_err(|e| format!("parse history index failed: {e}"))
}

fn save_history_store(root: &Path, store: &HistoryStore) -> Result<(), String> {
  ensure_history_workspace(root)?;
  let raw = serde_json::to_string_pretty(store).map_err(|e| format!("serialize history index failed: {e}"))?;
  fs::write(history_index_path(root), raw).map_err(|e| format!("write history index failed: {e}"))
}

fn next_history_id() -> String {
  let seq = HISTORY_ID_COUNTER.fetch_add(1, Ordering::Relaxed) % 10_000;
  format!("hist-{}-{seq:04}", Utc::now().timestamp_millis())
}

fn summarize_snapshot(text: &str) -> String {
  let line = text.lines().find(|line| !line.trim().is_empty()).unwrap_or("").trim();
  if line.is_empty() {
    "(empty)".to_string()
  } else if line.chars().count() > 80 {
    let short = line.chars().take(80).collect::<String>();
    format!("{short}...")
  } else {
    line.to_string()
  }
}

fn history_entry_from_record(record: &HistoryEntryRecord) -> HistoryEntry {
  HistoryEntry {
    id: record.id.clone(),
    file_path: record.file_path.clone(),
    created_at: record.created_at,
    reason: record.reason.clone(),
    word_count: record.word_count,
    char_count: record.char_count,
    summary: record.summary.clone(),
  }
}

pub(crate) fn should_track_history_path(relative_path: &str) -> bool {
  let norm = relative_path.replace('\\', "/").to_lowercase();
  if norm.starts_with(".novel/.history/")
    || norm.starts_with(".novel/.cache/")
    || norm.starts_with(".novel/state/")
    || norm.starts_with(".git/")
  {
    return false;
  }
  norm.starts_with("stories/")
    || norm.starts_with("outline/")
    || norm.starts_with("concept/")
    || norm.ends_with(".md")
    || norm.ends_with(".txt")
}

pub(crate) fn create_history_snapshot_internal(
  root: &Path,
  file_path: &str,
  snapshot_content: &str,
  reason: &str,
) -> Result<HistoryEntryRecord, String> {
  ensure_history_workspace(root)?;

  let normalized_file_path = file_path.replace('\\', "/");
  let ext = Path::new(&normalized_file_path)
    .extension()
    .and_then(|v| v.to_str())
    .unwrap_or("txt");
  let id = next_history_id();
  let snapshot_rel_path = format!(".novel/.history/snapshots/{id}.{ext}");
  let snapshot_abs_path = root.join(validate_relative_path(&snapshot_rel_path)?);
  fs::write(&snapshot_abs_path, snapshot_content).map_err(|e| format!("write history snapshot failed: {e}"))?;

  let mut store = load_history_store(root)?;
  let record = HistoryEntryRecord {
    id: id.clone(),
    file_path: normalized_file_path,
    snapshot_rel_path,
    created_at: Utc::now().timestamp_millis(),
    reason: reason.to_string(),
    word_count: count_content_chars(snapshot_content),
    char_count: snapshot_content.chars().count(),
    summary: summarize_snapshot(snapshot_content),
  };
  store.entries.insert(0, record.clone());

  if store.entries.len() > HISTORY_MAX_ENTRIES {
    let dropped = store.entries.split_off(HISTORY_MAX_ENTRIES);
    for old in dropped {
      if let Ok(rel) = validate_relative_path(&old.snapshot_rel_path) {
        let old_path = root.join(rel);
        let _ = fs::remove_file(old_path);
      }
    }
  }

  save_history_store(root, &store)?;
  Ok(record)
}

fn find_history_entry_record(store: &HistoryStore, id: &str) -> Option<HistoryEntryRecord> {
  store.entries.iter().find(|entry| entry.id == id).cloned()
}

pub fn list_history_entries(root: &Path, max: Option<usize>) -> Result<Vec<HistoryEntry>, String> {
  let store = load_history_store(root)?;
  let limit = max.unwrap_or(120).clamp(1, 500);
  Ok(
    store
      .entries
      .iter()
      .take(limit)
      .map(history_entry_from_record)
      .collect(),
  )
}

pub fn create_history_snapshot(
  root: &Path,
  relative_path: &str,
  reason: Option<String>,
) -> Result<HistoryEntry, String> {
  let rel = validate_relative_path(relative_path)?;
  let rel_norm = rel.to_string_lossy().replace('\\', "/");
  let target = root.join(rel);
  if !target.exists() {
    return Err("target file does not exist".to_string());
  }
  let content = fs::read_to_string(target).map_err(|e| format!("read snapshot source failed: {e}"))?;
  let reason_text = reason
    .as_deref()
    .map(str::trim)
    .filter(|v| !v.is_empty())
    .unwrap_or("manual");
  let entry = create_history_snapshot_internal(root, &rel_norm, &content, reason_text)?;
  Ok(history_entry_from_record(&entry))
}

pub fn read_history_snapshot(root: &Path, id: &str) -> Result<String, String> {
  let store = load_history_store(root)?;
  let record = find_history_entry_record(&store, id.trim())
    .ok_or_else(|| "history entry not found".to_string())?;
  let rel = validate_relative_path(&record.snapshot_rel_path)?;
  fs::read_to_string(root.join(rel)).map_err(|e| format!("read snapshot failed: {e}"))
}

pub fn restore_history_snapshot(root: &Path, id: &str) -> Result<String, String> {
  let store = load_history_store(root)?;
  let record = find_history_entry_record(&store, id.trim())
    .ok_or_else(|| "history entry not found".to_string())?;
  let file_rel = validate_relative_path(&record.file_path)?;
  let snapshot_rel = validate_relative_path(&record.snapshot_rel_path)?;
  let target = root.join(file_rel);
  let snapshot_path = root.join(snapshot_rel);
  let snapshot_content = fs::read_to_string(snapshot_path).map_err(|e| format!("read snapshot failed: {e}"))?;

  if let Some(parent) = target.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create parent dir failed: {e}"))?;
  }

  if target.exists() {
    if let Ok(current) = fs::read_to_string(&target) {
      if current != snapshot_content {
        let _ = create_history_snapshot_internal(root, &record.file_path, &current, "restore-backup");
      }
    }
  }

  fs::write(&target, &snapshot_content).map_err(|e| format!("restore snapshot failed: {e}"))?;
  if record.file_path.starts_with("concept/") && record.file_path.to_lowercase().ends_with(".md") {
    super::fs::update_concept_index(root, &record.file_path, &snapshot_content)?;
  }
  Ok(record.file_path)
}
