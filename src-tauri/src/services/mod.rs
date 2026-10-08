//! 服务层：按域拆分的业务逻辑与类型，供 Tauri 命令与本地 HTTP/WS 服务共用。
//!
//! 迁移约定（等价搬移）：命令实现逐步改为对服务层函数的薄壳调用，
//! 保持入参、返回结构与行为不变。

pub mod ai_stream;
pub mod bookshelf;
pub mod chat;
pub mod fs;
pub mod settings;
pub mod workspace;

pub(crate) fn build_http_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .connect_timeout(std::time::Duration::from_secs(15))
    .timeout(std::time::Duration::from_secs(300))
    .pool_idle_timeout(std::time::Duration::from_secs(90))
    .build()
    .map_err(|e| format!("http client build failed: {e}"))
}
