//! 书架域：作品条目、书架/选择器状态、外部项目记录与最近工作区。

use crate::app_data;
use crate::app_settings;
use super::workspace::{canonicalize_path, init_novel_workspace};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Serialize, Clone)]
pub struct ProjectItem {
  pub name: String,
  pub path: String,
  pub source: String,
  pub is_valid_workspace: bool,
  pub last_opened_at: Option<i64>,
  pub description: Option<String>,
  pub chapters_count: u32,
  pub total_words: u32,
  pub updated_at: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct ProjectPickerState {
  pub default_root: String,
  pub default_projects: Vec<ProjectItem>,
  pub external_projects: Vec<ProjectItem>,
  pub last_workspace: Option<String>,
  pub launch_mode: app_settings::LaunchMode,
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct ExternalProjectsStore {
  #[serde(default)]
  pub(crate) projects: Vec<ExternalProjectRecord>,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct ExternalProjectRecord {
  pub(crate) path: String,
  pub(crate) added_at: i64,
}

pub fn get_last_workspace(_app: &AppHandle) -> Result<Option<String>, String> {
  let path = last_workspace_path()?;
  if !path.exists() {
    return Ok(None);
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read last workspace failed: {e}"))?;
  #[derive(Deserialize)]
  struct LastWorkspace {
    path: String,
  }
  let v: LastWorkspace = serde_json::from_str(&raw).map_err(|e| format!("parse last workspace failed: {e}"))?;
  let p = v.path.trim().to_string();
  if p.is_empty() {
    return Ok(None);
  }
  if !Path::new(&p).exists() {
    return Ok(None);
  }
  Ok(Some(p))
}

fn last_workspace_path() -> Result<PathBuf, String> {
  app_data::state_file_path("last_workspace.json")
}

pub(crate) fn save_last_workspace(_app: &AppHandle, root: &Path) -> Result<(), String> {
  let path = last_workspace_path()?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create last workspace dir failed: {e}"))?;
  }
  let payload = serde_json::json!({ "path": root.to_string_lossy().to_string() }).to_string();
  fs::write(path, payload).map_err(|e| format!("write last workspace failed: {e}"))
}

fn external_projects_path() -> Result<PathBuf, String> {
  app_data::state_file_path("external_projects.json")
}

fn load_external_projects(_app: &AppHandle) -> Result<Vec<ExternalProjectRecord>, String> {
  let path = external_projects_path()?;
  if !path.exists() {
    return Ok(Vec::new());
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read external projects failed: {e}"))?;
  let parsed = serde_json::from_str::<ExternalProjectsStore>(&raw)
    .map_err(|e| format!("parse external projects failed: {e}"))?;
  Ok(parsed.projects)
}

fn save_external_projects(_app: &AppHandle, records: &[ExternalProjectRecord]) -> Result<(), String> {
  let path = external_projects_path()?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create external projects dir failed: {e}"))?;
  }
  let payload = ExternalProjectsStore {
    projects: records.to_vec(),
  };
  let raw = serde_json::to_string_pretty(&payload).map_err(|e| format!("serialize external projects failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write external projects failed: {e}"))
}

fn default_projects_root() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|e| format!("resolve current executable failed: {e}"))?;
  let install_dir = exe
    .parent()
    .ok_or_else(|| "resolve install directory failed".to_string())?;
  Ok(install_dir.join("projects"))
}

fn is_valid_workspace_root(path: &Path) -> bool {
  path.join("concept").is_dir() || path.join("outline").is_dir() || path.join("stories").is_dir()
}

pub(crate) fn work_meta_path(root: &Path) -> PathBuf {
  root.join(".novel").join("work.json")
}

fn read_work_description(root: &Path) -> Option<String> {
  #[derive(Deserialize)]
  struct WorkMeta {
    #[serde(default)]
    description: Option<String>,
  }
  let raw = fs::read_to_string(work_meta_path(root)).ok()?;
  let meta: WorkMeta = serde_json::from_str(&raw).ok()?;
  meta
    .description
    .map(|d| d.trim().to_string())
    .filter(|d| !d.is_empty())
}

fn write_work_description(root: &Path, description: Option<String>) -> Result<(), String> {
  let meta_path = work_meta_path(root);
  if let Some(parent) = meta_path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create .novel dir failed: {e}"))?;
  }
  let payload = serde_json::json!({ "description": description });
  let raw = serde_json::to_string_pretty(&payload)
    .map_err(|e| format!("serialize work meta failed: {e}"))?;
  fs::write(meta_path, raw).map_err(|e| format!("write work meta failed: {e}"))
}

/// Mirrors the web app's word-count convention: count non-whitespace
/// characters, which behaves sensibly for CJK manuscripts.
pub(crate) fn count_content_chars(text: &str) -> usize {
  text.chars().filter(|c| !c.is_whitespace()).count()
}

struct WorkStats {
  chapters_count: u32,
  total_words: u32,
  updated_at: Option<i64>,
}

fn scan_work_stats(root: &Path) -> WorkStats {
  let mut stats = WorkStats {
    chapters_count: 0,
    total_words: 0,
    updated_at: None,
  };
  let Ok(entries) = fs::read_dir(root.join("stories")) else {
    return stats;
  };
  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_file() {
      continue;
    }
    let ext = path
      .extension()
      .and_then(|e| e.to_str())
      .map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("md") | Some("markdown") | Some("txt")) {
      continue;
    }
    stats.chapters_count += 1;
    if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
      if let Ok(ts) = modified.duration_since(std::time::UNIX_EPOCH) {
        let ts = ts.as_secs() as i64;
        let is_newer = match stats.updated_at {
          Some(current) => ts > current,
          None => true,
        };
        if is_newer {
          stats.updated_at = Some(ts);
        }
      }
    }
    if let Ok(content) = fs::read_to_string(&path) {
      stats.total_words += count_content_chars(&content) as u32;
    }
  }
  stats
}

fn to_project_item(path: &Path, source: &str, last_opened_at: Option<i64>) -> ProjectItem {
  let name = path
    .file_name()
    .map(|v| v.to_string_lossy().to_string())
    .unwrap_or_else(|| path.to_string_lossy().to_string());
  let description = read_work_description(path);
  let stats = scan_work_stats(path);
  ProjectItem {
    name,
    path: path.to_string_lossy().to_string(),
    source: source.to_string(),
    is_valid_workspace: is_valid_workspace_root(path),
    last_opened_at,
    description,
    chapters_count: stats.chapters_count,
    total_words: stats.total_words,
    updated_at: stats.updated_at,
  }
}

fn list_default_projects(root: &Path) -> Result<Vec<ProjectItem>, String> {
  let mut projects: Vec<ProjectItem> = Vec::new();
  if !root.exists() {
    return Ok(projects);
  }
  for entry in fs::read_dir(root).map_err(|e| format!("read default projects failed: {e}"))? {
    let entry = entry.map_err(|e| format!("read default project entry failed: {e}"))?;
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    let canonical = canonicalize_path(&path).unwrap_or(path);
    projects.push(to_project_item(&canonical, "default", None));
  }
  projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  Ok(projects)
}

fn sanitize_project_folder_name(input: &str) -> String {
  let mut out = String::new();
  for ch in input.trim().chars() {
    let allowed = ch.is_ascii_alphanumeric()
      || ch == '-'
      || ch == '_'
      || ('\u{4E00}'..='\u{9FFF}').contains(&ch);
    if allowed {
      out.push(ch);
    } else if ch.is_whitespace() {
      out.push('-');
    }
  }
  let compact = out
    .split('-')
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join("-");
  if compact.is_empty() {
    "novel".to_string()
  } else {
    compact
  }
}

fn build_unique_project_path(root: &Path, base_name: &str) -> PathBuf {
  let mut idx = 1usize;
  loop {
    let candidate = if idx == 1 {
      root.join(base_name)
    } else {
      root.join(format!("{base_name}-{idx:02}"))
    };
    if !candidate.exists() {
      return candidate;
    }
    idx += 1;
  }
}

fn parse_launch_mode(mode: &str) -> Result<app_settings::LaunchMode, String> {
  match mode.trim() {
    "picker" => Ok(app_settings::LaunchMode::Picker),
    "auto_last" => Ok(app_settings::LaunchMode::AutoLast),
    _ => Err("invalid launch mode".to_string()),
  }
}

pub fn get_project_picker_state(app: &AppHandle) -> Result<ProjectPickerState, String> {
  let default_root = default_projects_root()?;
  let default_projects = list_default_projects(&default_root)?;
  let settings = app_settings::load()?;
  let last_workspace = get_last_workspace(app)?;

  let mut seen_paths: HashSet<String> = HashSet::new();
  for item in &default_projects {
    seen_paths.insert(item.path.to_lowercase());
  }

  let mut external_projects: Vec<ProjectItem> = Vec::new();
  for record in load_external_projects(app)? {
    let path = PathBuf::from(&record.path);
    if !path.exists() || !path.is_dir() {
      continue;
    }
    let canonical = canonicalize_path(&path).unwrap_or(path);
    let path_key = canonical.to_string_lossy().to_lowercase();
    if seen_paths.contains(&path_key) {
      continue;
    }
    seen_paths.insert(path_key);
    external_projects.push(to_project_item(&canonical, "external", Some(record.added_at)));
  }
  external_projects.sort_by(|a, b| match (a.last_opened_at, b.last_opened_at) {
    (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
  });

  Ok(ProjectPickerState {
    default_root: default_root.to_string_lossy().to_string(),
    default_projects,
    external_projects,
    last_workspace,
    launch_mode: settings.launch_mode,
  })
}

pub fn create_novel_project(name: &str, description: Option<String>) -> Result<ProjectItem, String> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err("project name is empty".to_string());
  }

  let default_root = default_projects_root()?;
  fs::create_dir_all(&default_root).map_err(|e| format!("create default projects root failed: {e}"))?;

  let folder_name = sanitize_project_folder_name(trimmed);
  let target_root = build_unique_project_path(&default_root, &folder_name);
  fs::create_dir_all(&target_root).map_err(|e| format!("create project dir failed: {e}"))?;

  init_novel_workspace(&target_root)?;

  let clean_description = description
    .map(|d| d.trim().to_string())
    .filter(|d| !d.is_empty());
  if clean_description.is_some() {
    write_work_description(&target_root, clean_description)?;
  }

  let canonical = canonicalize_path(&target_root).unwrap_or(target_root);
  Ok(to_project_item(
    &canonical,
    "default",
    Some(Utc::now().timestamp()),
  ))
}

pub fn remember_external_project(app: &AppHandle, path: &str) -> Result<(), String> {
  let canonical = canonicalize_path(Path::new(path.trim()))?;
  let metadata = fs::metadata(&canonical).map_err(|e| format!("stat project path failed: {e}"))?;
  if !metadata.is_dir() {
    return Err("external project path must be a directory".to_string());
  }
  let canonical_str = canonical.to_string_lossy().to_string();
  let now = Utc::now().timestamp();

  let mut records = load_external_projects(app)?;
  if let Some(existing) = records
    .iter_mut()
    .find(|v| v.path.eq_ignore_ascii_case(&canonical_str))
  {
    existing.added_at = now;
  } else {
    records.push(ExternalProjectRecord {
      path: canonical_str,
      added_at: now,
    });
  }
  records.sort_by(|a, b| b.added_at.cmp(&a.added_at));
  save_external_projects(app, &records)
}

pub fn forget_external_project(app: &AppHandle, path: &str) -> Result<(), String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Ok(());
  }
  let canonical = canonicalize_path(Path::new(trimmed))
    .ok()
    .map(|v| v.to_string_lossy().to_string());
  let mut records = load_external_projects(app)?;
  records.retain(|v| {
    if let Some(canon) = &canonical {
      !v.path.eq_ignore_ascii_case(canon)
    } else {
      !v.path.eq_ignore_ascii_case(trimmed)
    }
  });
  save_external_projects(app, &records)
}

pub fn set_launch_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
  let mut settings = app_settings::load()?;
  settings.launch_mode = parse_launch_mode(mode)?;
  app_settings::save(&settings)
}

pub fn update_work_description(path: &str, description: Option<String>) -> Result<(), String> {
  let trimmed_path = path.trim();
  if trimmed_path.is_empty() {
    return Err("work path is empty".to_string());
  }
  let root = canonicalize_path(Path::new(trimmed_path))?;
  if !root.is_dir() {
    return Err("work path must be a directory".to_string());
  }
  let clean = description
    .map(|d| d.trim().to_string())
    .filter(|d| !d.is_empty());
  write_work_description(&root, clean)
}
