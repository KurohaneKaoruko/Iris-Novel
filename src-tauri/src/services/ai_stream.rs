//! AI 流式域：流式生成任务与取消控制。
//!
//! 生成主流程当前位于 `crate::commands::chat_generate_stream`；后续任务将把
//! 任务编排、取消与事件发射逻辑迁移至此，供 Tauri 与本地服务共用。
