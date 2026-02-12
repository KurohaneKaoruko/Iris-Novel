use crate::branding;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn data_file_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("app data dir failed: {e}"))?;

  let new_path = base.join(branding::DATA_DIR_NAME).join(file_name);
  let legacy_path = base.join(branding::LEGACY_DATA_DIR_NAME).join(file_name);

  if !new_path.exists() && legacy_path.exists() {
    if let Some(parent) = new_path.parent() {
      if fs::create_dir_all(parent).is_err() {
        return Ok(legacy_path);
      }
    }
    if fs::copy(&legacy_path, &new_path).is_err() {
      return Ok(legacy_path);
    }
  }

  Ok(new_path)
}
