# Proposal

## Why

Iris-Novel 目前只能以桌面应用形态使用，且界面沿袭 IDE 式架构（文件树 + 编辑区 + 侧栏），与小说创作"以章节为中心"的心流不匹配；同时设定、大纲、人物等资料以零散 Markdown 文件呈现，缺乏工程化视图。更关键的是：AI 写作时依赖其"主动想起"去查看设定与大纲，经常遗漏导致设定不一致。本变更将产品重构为小说优先的工作区（同时服务桌面端与浏览器端），并把"设定一致性"从 AI 的自觉变为项目的强制机制。

## What Changes

- **小说式工作区布局**（桌面端与 Web 端共用同一套 UI）：取代现有 IDE 式布局——左侧章节列表、中央编辑器、顶部标签页、右侧 AI 对话栏；布局按"书 → 章节"组织而非"目录树 → 文件"。
- **沉浸式 Vibe Novel 模式**：一键收起章节列表、标签页与编辑器，页面仅保留 AI 对话；可随时返回完整工作区。
- **资料工程化管理视图**：设定/人物/大纲不再只是 Markdown 文件列表，提供角色卡视图、设定关联图谱、大纲剧情线视图等结构化查看页面；数据仍以 `.md` 为单一事实来源，视图为其结构化投影。
- **WebUI 与本地服务端**：新增本地服务端（复用 `src-tauri` 现有 Rust 命令逻辑，HTTP + WebSocket 对外暴露与 Tauri 命令等价的 API），前端通过统一传输适配层在"Tauri IPC"与"HTTP/WS"之间自动切换；浏览器访问本地服务即可获得与桌面端一致的使用体验。
- **AI 设定一致性上下文注入**：写作生成前不再依赖 AI 自主查阅设定——流程改为"AI 先分析本次生成涉及哪些设定资料 → 项目确定性检索并主动注入相关内容 → 生成阶段以注入上下文为强约束"，保证设定一致性。
- **BREAKING**：`App.tsx` 现有 IDE 式主布局被替换；桌面端默认布局变更为小说式工作区（原布局相关 UI 设置项语义调整）。

## Capabilities

### New Capabilities

- `novel-workspace-layout`: 小说式工作区布局——章节列表、编辑器、标签页、AI 栏四区布局，区格与折叠行为，沉浸式 Vibe Novel 模式，桌面端与 Web 端共用同一布局行为。
- `material-management`: 资料工程化管理——角色卡、设定关联图谱、大纲剧情线等结构化视图，及其与 Markdown 底层文件的读写一致性。
- `web-service`: WebUI 本地服务端——HTTP/WebSocket API 与 Tauri 命令等价、AI 流式事件经 WS 推送、浏览器端传输适配与降级行为。
- `ai-context-injection`: AI 设定一致性上下文注入——生成前资料分析、项目侧确定性注入、注入范围可视化与一致性约束。

### Modified Capabilities

（无——项目尚无既有 spec。）

## Impact

- **前端**：`src-react/src/App.tsx`（约 5400 行）需拆分并重构主布局；新增布局容器、章节列表、沉浸模式与资料管理视图组件；`tauri.ts` 改造为传输适配层（`isTauriApp()` 已存在，全部 61 个命令封装是唯一调用瓶颈，是现成的切换点）。
- **后端**：`src-tauri` 新增 server 模块（axum + tokio），将 `commands.rs`（61 个命令）的逻辑提取为可同时被 Tauri IPC 与 HTTP/WS 调用的服务层；AI 流式事件（`ai_stream_token` 等）增加 WS 通道。
- **AI 工作流**：`AIAssistanceService`、`chatComposer`、`memoryIndex`、`documentSummary` 所在的上下文组装链路增加"分析 → 注入"前置阶段；Rust 端 `agent_system.rs` 相应扩展注入型工具。
- **依赖**：Rust 新增 `axum`、`tokio`（WS 特性）；前端原则上不引入新框架依赖，图谱视图基于现有 `recharts`/自绘实现。
- **数据**：不改变作品目录结构与 `.md` 单一事实来源；资料视图所需的索引缓存写入 `.novel/`。
