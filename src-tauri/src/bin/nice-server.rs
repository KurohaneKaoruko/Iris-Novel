//! nice-server：本地 Web 服务端。
//!
//! 用法：
//!   nice-server [--host 127.0.0.1] [--port 8765] [--static-dir <dir>] [--data-dir <dir>]
//!
//! - 默认仅绑定 127.0.0.1（本机访问）；LAN 访问需显式 --host 0.0.0.0（用户自担风险）。
//! - `--static-dir` 指向前端构建产物目录；默认 `../src-react/dist`（或 NICE_STATIC_DIR）。
//! - `--data-dir` 覆盖数据目录（settings/secrets/chat_history/bookshelf）；默认与桌面端约定一致
//!   （可执行文件所在目录），也可用 NICE_DATA_DIR。

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "nice-server", version, about = "N.I.C.E. local web server")]
struct Args {
  /// Bind host (default 127.0.0.1, loopback only)
  #[arg(long, default_value = "127.0.0.1")]
  host: String,

  /// Bind port
  #[arg(long, default_value_t = 8765)]
  port: u16,

  /// Frontend static dist directory
  #[arg(long)]
  static_dir: Option<std::path::PathBuf>,

  /// Data directory override (settings/secrets/history/bookshelf)
  #[arg(long)]
  data_dir: Option<std::path::PathBuf>,
}

fn main() {
  let args = Args::parse();
  let rt = tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .build()
    .expect("build tokio runtime");
  rt.block_on(async move {
    if let Err(e) = nice::server::run(nice::server::ServerConfig {
      host: args.host,
      port: args.port,
      static_dir: args.static_dir,
      data_dir: args.data_dir,
    })
    .await
    {
      eprintln!("[nice-server] fatal: {e}");
      std::process::exit(1);
    }
  });
}
