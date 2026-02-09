use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
  pub workspace_root: Mutex<Option<PathBuf>>,
  pub fs_watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      workspace_root: Mutex::new(None),
      fs_watcher: Mutex::new(None),
    }
  }
}
