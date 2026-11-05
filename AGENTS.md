# AGENTS.md

本文件为所有 AI Agent（Claude Code、Codex、Cursor 等）在此代码库中工作时提供指导。

## 项目概述

Iris-Creation 是一个基于 **Tauri v2 + React + Lexical** 构建的桌面小说写作工作台。它不是通用 IDE，而是专注于小说作者需求的工具：
- 作品与资料管理
- 章节写作与改稿
- AI 规划、审阅与长期记忆
- 人物、关系、线索与连续性维护

## 开发命令

```bash
# 开发
pnpm run dev              # 仅启动前端开发服务器（端口 1420）
pnpm run tauri:dev        # 完整桌面开发模式（推荐）

# 构建
pnpm run build            # 仅构建前端
pnpm run tauri:build      # 构建桌面应用

# 测试与代码检查
pnpm run test             # 运行 Vitest 测试
pnpm run test:watch       # 监视模式运行测试
pnpm run lint             # 运行 ESLint

# 移动端（如需要）
pnpm run tauri:android:dev
pnpm run tauri:ios:dev
```

## 架构

### 前端 (`webui/`)

`src-react/`（旧桌面端 Lexical 前端）已于 2026-11 退役删除，`webui/` 是唯一前端。要点：

- **`api/backend.ts`** - 类型化 RPC 命令绑定（与 `rpc_dispatch.rs` 一一对应）
- **`api/novel.ts`** - 作品内数据层：章节元数据、人物卡、情节线、记忆索引、写作历史（Markdown/JSON 直读直写，`parseCharacters`/`parsePlotLines` 等纯函数有单测）
- **`api/planner.ts`** - 规划队列：run-queue.md JSON frontmatter 读写（与旧桌面端格式兼容）
- **`api/writing.ts`** - AI 写作工作流：续写/大纲/细纲/润色提示词构建 + 流式生成
- **`features/bookshelf/`** - 书架页
- **`features/workspace/`** - 工作台：TipTap 编辑器、聊天面板、人物/情节线/记忆/历史/规划面板、命令面板（Ctrl+K）、设置中心、工具箱（搜索/导出/风险审阅）、拆书
- **`hooks/useChat.ts`** - 流式聊天（WS token 过滤/取消/会话恢复）
- **`state/WorkContext.tsx`** - workRoot/activePath/写作设置全局状态

### 后端 (`src-tauri/src/`)

- **`lib.rs`** - 共享库：桌面（Tauri）与 `iris-creation-server` 共用的服务层
- **`main.rs`** - Tauri 桌面壳入口：setup 内嵌 `iris_creation::server::run`（127.0.0.1:8765），窗口直接加载该地址，与独立 iris-creation-server 形态行为一致；invoke 通道保留但 webui 不使用
- **`bin/iris-creation-server.rs`** - 本地 Web 服务端入口：托管 webui 静态资源 + RPC + WS
- **`server/`** - HTTP/WS 服务：`rpc_dispatch.rs`（67 命令分发）、WS 升级与 cancel 指令
- **`commands.rs`** - 命令实现（`*_impl` 共用函数供 Tauri/RPC 双通道调用）
- **`agent_system.rs`** - AI 代理运行时，包含工具注册表和记忆存储
- **`skills/mod.rs`** - 写作技能：内置技能 + Novelist-Skills 子模块（`skills/` 目录，编译期内嵌 + 运行时目录覆盖）
- **`app_settings.rs`** - 应用设置和提供商配置
- **`secrets.rs`** - API 密钥存储（平台特定：Windows DPAPI，macOS/Linux keyring）
- **`chat_history.rs`** - 聊天会话持久化

### 作品目录结构

每个小说作品使用固定结构：
```
<work>/
  concept/   # 设定、人物、关系等资料（.md）
  outline/   # 大纲与规划资料（.md）
  stories/   # 正文章节（.md）
  .novel/    # 状态、缓存、历史、索引
```

### 应用数据位置

- 设置： `<install-dir>/config/settings.json`
- 写作助手： `<install-dir>/data/agents.json`
- 聊天历史： `<install-dir>/data/chat_history.json`
- 书架状态： `<install-dir>/state/last_workspace.json`, `<install-dir>/state/external_projects.json`
- API 密钥： `<install-dir>/secrets/secrets.json`

## 关键技术细节

### AI 工作流模式

1. **审阅优先**（默认）：AI 生成审阅建议，用户逐条接受/拒绝
2. **自动应用**：AI 修改直接应用到内容

### 记忆索引系统

位于 `.novel/state/`：
- `character-state-index.md` - 人物状态追踪
- `foreshadow-index.md` - 伏笔/线索索引

每个索引支持：
- 自动生成（`source: auto`）
- 手动修订（`source: manual`）
- 锁定保护（`locked: true`）

### 代理系统

Rust 后端包含 AI 代理运行时：
- 工具注册表用于文件操作（`fs_read_text`、`fs_write_text`、`fs_list_dir` 等)
- 记忆存储用于长期上下文
- 写作技能通过聊天面板 `/skill <id>` 指令或控制项里的技能下拉选用，发送时注入技能写作规范

### 技能库（Novelist-Skills 子模块）

`skills/` 是 git submodule（https://github.com/KurohaneKaoruko/Novelist-Skills.git ），提供场景写作、正文铁律、剧情规划、连续性维护、风格库（热血/轻小说/悬疑/言情/科幻/仙侠）等 SKILL.md 技能：

- 加载优先级：`IRIS_CREATION_SKILLS_DIR` 环境变量 > 可执行文件旁 `skills/` > 编译期内嵌（build.rs 生成 `skills_data.rs`）
- 克隆后需 `git submodule update --init --recursive`
- 每个技能是 `<skills>/<id>/SKILL.md`，YAML frontmatter（name/description）+ 正文（prompt）

### 前后端通信

Web 前端与后端通过 **HTTP RPC + WebSocket** 通信（见下方「新版 Web UI」）；桌面壳另保留 Tauri invoke 通道。

### Web UI（`webui/`）

`webui/` 是唯一 Web 前端（React 18 + Vite + TipTap 2 + TS strict），由 `iris-creation-server` 托管静态资源并暴露 RPC/WS：

```bash
cd webui
pnpm exec vite build      # 构建到 webui/dist（生产由 iris-creation-server 托管）
npx tsc -b tsconfig.json --noEmit   # 类型检查
pnpm exec vite            # dev 服务器端口 1421，/api /ws 代理到 8765
```

- 运行方式：`./src-tauri/target/debug/iris-creation-server --port 8765 --static-dir webui/dist --data-dir <data>`
- RPC：`POST /api/rpc/{cmd}` 返回 `{ok}|{err}`，全部命令绑定在 `webui/src/api/backend.ts`（新增命令改 `src-tauri/src/server/rpc_dispatch.rs` 后在此扩展）
- WS：帧格式 `{"event","payload"}`，事件 `ai_stream_start/token/done/status`、`fs_changed`；取消流发 `{"type":"cancel","streamId"}`
- 作品内数据（人物卡/情节线/章节元数据/记忆索引/写作历史）在 `webui/src/api/novel.ts`，直读直写 Markdown/JSON，与旧桌面端格式双向兼容
- vite **不要**手动分包（manualChunks 会破坏 Prism 全局初始化契约，导致白屏）

## 代码约定

- React 组件使用 `.tsx` 扩展名
- 服务是模块文件导出的单例实例
- Tauri 命令使用域前缀（如 `set_workspace`、`get_app_settings`）
- 设置变更应通过设置服务进行，不直接操作文件
- AI 响应为流式；通过 `chat_cancel_stream` 处理取消
