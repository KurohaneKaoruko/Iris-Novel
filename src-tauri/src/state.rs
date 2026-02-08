use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
  pub workspace_root: Mutex<Option<PathBuf>>,
}
