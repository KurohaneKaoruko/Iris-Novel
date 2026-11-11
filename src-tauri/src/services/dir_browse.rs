//! 目录浏览：供前端「打开目录」对话框逐级点选（无原生文件选择器的 Web 形态兜底）。
//! 只读；仅返回目录条目与常用元数据，不暴露文件内容。

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct DirEntryInfo {
  pub name: String,
  pub path: String,
  /// 是否为作品工程（存在 .novel 目录或 stories/ 目录）
  pub is_workspace: bool,
}

#[derive(Serialize)]
pub struct DirListing {
  pub path: String,
  pub parent: Option<String>,
  pub home: String,
  pub entries: Vec<DirEntryInfo>,
}

fn home_dir() -> PathBuf {
  std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .map(PathBuf::from)
    .unwrap_or_else(|_| PathBuf::from("/"))
}

fn is_workspace_dir(p: &Path) -> bool {
  p.join(".novel").is_dir() || p.join("stories").is_dir()
}

/// 列出某目录下的子目录（跳过隐藏目录与常见噪音目录）。
pub fn list_dir(path: &str) -> Result<DirListing, String> {
  let trimmed = path.trim();
  let target = if trimmed.is_empty() || trimmed == "~" {
    home_dir()
  } else {
    let p = PathBuf::from(trimmed);
    if !p.is_dir() {
      return Err(format!("not a directory: {trimmed}"));
    }
    p
  };

  let canonical = std::fs::canonicalize(&target).map_err(|e| format!("resolve failed: {e}"))?;

  let mut entries: Vec<DirEntryInfo> = Vec::new();
  let rd = std::fs::read_dir(&canonical).map_err(|e| format!("read dir failed: {e}"))?;
  for item in rd.flatten() {
    let ft = match item.file_type() {
      Ok(v) => v,
      Err(_) => continue,
    };
    if !ft.is_dir() {
      continue;
    }
    let name = item.file_name().to_string_lossy().to_string();
    if name.starts_with('.') || name == "node_modules" || name == "target" || name == "vendor" {
      continue;
    }
    let child = item.path();
    entries.push(DirEntryInfo {
      name,
      path: child.to_string_lossy().to_string(),
      is_workspace: is_workspace_dir(&child),
    });
  }
  entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

  let parent = canonical
    .parent()
    .map(|p| p.to_string_lossy().to_string());

  Ok(DirListing {
    path: canonical.to_string_lossy().to_string(),
    parent,
    home: home_dir().to_string_lossy().to_string(),
    entries,
  })
}

/// 常用起点：家目录 + 家目录下一层（找得到 novels/writing 之类的常用写作根）。
pub fn quick_locations() -> Vec<DirEntryInfo> {
  let home = home_dir();
  let mut out = vec![DirEntryInfo {
    name: "主目录".to_string(),
    path: home.to_string_lossy().to_string(),
    is_workspace: is_workspace_dir(&home),
  }];
  if let Ok(rd) = std::fs::read_dir(&home) {
    for item in rd.flatten() {
      let ft = match item.file_type() {
        Ok(v) => v,
        Err(_) => continue,
      };
      if !ft.is_dir() {
        continue;
      }
      let name = item.file_name().to_string_lossy().to_string();
      if name.starts_with('.') {
        continue;
      }
      let lower = name.to_lowercase();
      if ["novels", "novel", "writing", "books", "documents", "docs", "projects", "desktop"]
        .iter()
        .any(|k| lower.contains(k))
      {
        let child = item.path();
        out.push(DirEntryInfo {
          name,
          path: child.to_string_lossy().to_string(),
          is_workspace: is_workspace_dir(&child),
        });
      }
    }
  }
  out
}
