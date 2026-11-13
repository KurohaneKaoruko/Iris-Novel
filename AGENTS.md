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
- **`api/novel.ts`** - 作品内数据层：章节元数据、人物卡、设定集 Codex、情节线、记忆索引、写作历史、章节排序（Markdown/JSON 直读直写，`parseCharacters`/`parsePlotLines`/`parseCodex` 等纯函数有单测）；工坊结果直写章节（`chapterBodyFromResult` 剥 AI 首行标题 + `createChapterWithContent` 落盘登记）
- **`api/planner.ts`** - 规划队列：run-queue.md JSON frontmatter 读写 + 大纲→任务链导入（`parseOutlineChapters`/`outlineToTasks`，与旧桌面端格式兼容）；AI 拆解（`buildTaskDraftPrompt`+`parseAiTasks`，id/依赖链重建防 AI 输出不可信字段）；UI 在 ToolsDialog「任务队列」页签（拆解/导入/逐章生成/连续生成）
- **`api/stylefp.ts`** - 文风指纹持久化（concept/style-fingerprint.json，随工程走）：工坊学习一次全工程共用——StudioDialog 学/存/删，PlannerTab 逐章生成自动携带
- **`api/lint.ts`** - 正文铁律体检：对齐 novel-ai-lexicon 的规则引擎（一级套路/二级限频/句式模板）
- **`api/import.ts`** - 存量作品导入：智能切章（第X章/Chapter X/数字序号，中文数字转阿拉伯）
- **`api/consistency.ts`** - 一致性检查：人物断档/情节线推进/伏笔回收/章节健康四维交叉核对
- **`api/writing.ts`** - AI 写作工作流：续写/大纲/细纲/润色提示词构建 + 流式生成
- **`api/studio.ts`** - 创作工坊工具集：16 个 AI 快捷创作工具（构思/写作/润改/实用四分类），prompt 模板化 + 纯净补全通道（`studio_complete_stream` RPC，不走 ReAct、不要求打开作品目录）；多稿对照（`generateVariants`，同输入 2-4 稿不同视角并排择优）；风格学习（`learnStyleFingerprint`+`parseStyleFingerprint`，范文 → 六维文风指纹注入所有文风类工具），有单测
- **`api/rpc.ts`** - Web RPC 客户端 + WS 事件订阅：流式事件走全局共享 WS 连接（`subscribeStreamEvents`，多流并发不漏帧；旧的 `subscribeEvent` 每订阅一条连接仅限低频事件使用）
- **`features/launch/`** - 启动页：继续上次工程（last_workspace + 书架统计）、点选式目录选择器（`browse_dir`/`quick_locations`，拒绝手输路径）、新建标准工程
- **`features/agent/`** - Agent 工作台（2026-11 重构，主流 Agent 布局，视觉规范：实体表面+SVG 图标，禁 emoji/玻璃拟态/胶囊按钮）：
  - `AgentWorkspace.tsx` - 三栏主体：会话侧栏 | 中央对话流 | Artifacts 文件面板
  - `SessionSidebar.tsx` - 历史会话（`list/get/save_chat_session`，按工程过滤，标题自动取首条用户消息）
  - `Markdown.tsx` - 零依赖 Markdown 渲染器（围栏代码块/表格/列表/行内格式，有单测）
  - `StepCard.tsx` - 工具步骤卡（订阅 `ai_agent_step` WS 事件，Cline 式可折叠）
  - `SettingsDialog.tsx` - 模型 Provider 管理（Key 走 secrets 通道、测试连接、单选激活）
  - `FileTree.tsx` - 递归文件树（重命名/删除/新建，`fs_changed` 事件驱动刷新）
  - `ChaptersPanel.tsx` - 章节页签（字数/状态三态循环/拖拽排序/新建/导入直跳）
  - `LorePanel.tsx` - 设定页签（人物卡/情节线/设定集三合一，直读 novel.ts 解析 concept|outline 下的 Markdown）
  - `ToolsDialog.tsx` - 工具中心（任务队列/统计/一致性/铁律/导入切章五页签；任务队列=AI 拆解目标或大纲导入→逐章连续生成正文）
  - `PlannerTab.tsx` - 任务队列页签（studio 纯净补全通道逐章生成 + 人物卡/前章结尾/文风指纹上下文 + lint 一级套路质检闸门不过即标待重试、连写遇拦截即停；手动添加任务/内联编辑细纲/批量重试/导出 Markdown 写作计划（`tasksToPlanMarkdown`）；`buildChapterPrompt`/`gateIssues` 纯函数有单测）
  - `StudioDialog.tsx` - 创作工坊（16 个 AI 快捷创作工具四分类；支持 initialText 预填——编辑器选中文本经浮动工具条直达润改；风格学习：范文提取六维文风指纹徽章可移除；多稿对照开关 2-4 稿不同视角选稿卡片；五个出口：复制 / 存为 studio/*.md / 存为章节（stories/chapter-XXXX.md 纳入章节管理）/ 插入编辑器 / 替换选区（编辑器有选区时出现，润改闭环）；Ctrl+K 有快捷入口）
  - `CommandPalette.tsx` - Ctrl+K 命令面板（模糊过滤/键盘导航）
  - `MarkdownView.tsx` - 轻量只读渲染（标题锚点 + `extractToc` 纯函数 TOC，有单测）
  - `DiffView.tsx` - 文件变更历史 diff（覆盖写自动留快照；LCS 行级对比、±统计、上下文折叠、版本恢复）
- **`api/diff.ts`** - 零依赖行级 diff（LCS/collapseDiff，有单测）
- **`api/sessionExport.ts`** - 会话导出 Markdown 分享稿（工具步骤 details 折叠，有单测）
- **`components/Icon.tsx`** - 全应用统一 SVG 图标系统（lucide 线性风格 50 枚，`<Icon name size />`；界面图标禁止 emoji）
- **`workspace/Dialogs`** - 全局 Prompt/Confirm 对话框（唯一从旧工作台保留的组件）
- **`hooks/useChat.ts`** - 流式聊天（WS 事件协议：挂载时订阅一次 + activeStreamId ref 过滤消除竞态；`ai_error` 即终止；token 累积/done 收尾/会话恢复，有协议单测）
- **`state/ProjectContext.tsx`** - workRoot/activePath/书架状态；`openDir` 自动登记 external_projects
- **`state/ThemeContext.tsx`** - dark/light 主题（`data-theme` 写入 documentElement，localStorage 持久）

### 后端 (`src-tauri/src/`)

- **`lib.rs`** - 共享库：桌面（Tauri）与 `iris-creation-server` 共用的服务层
- **`main.rs`** - Tauri 桌面壳入口：setup 内嵌 `iris_creation::server::run`（127.0.0.1:8765），窗口直接加载该地址，与独立 iris-creation-server 形态行为一致；invoke 通道保留但 webui 不使用
- **`bin/iris-creation-server.rs`** - 本地 Web 服务端入口：托管 webui 静态资源 + RPC + WS
- **`server/`** - HTTP/WS 服务：`rpc_dispatch.rs`（66 命令分发分支，72 个命令名含 6 组新旧别名）、WS 升级与 cancel 指令
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

Rust 后端包含 AI 代理运行时（ReAct 循环）：
- 工具注册表用于文件操作（`fs_read_text`、`fs_write_text`、`fs_list_dir` 等）
- 每次工具调用发 `ai_agent_step` WS 事件（actionId/tool/phase/ok/durationMs/输入输出预览），前端渲染为步骤卡
- **工程上下文注入**：`bookshelf::render_work_context` 每轮对话自动把作品名/简介/章节统计/两层目录树注入 system prompt（`<work-context>` 块）
- ReAct 产物清理：`strip_react_artifacts` 剥 `FINAL:` 前缀、丢 `TASK_DONE:` 行；`LiveEmitGate` 在流式输出中抑制 `ACTION:` 段、剥 `FINAL:` 前缀
- 写作技能通过 composer 技能下拉选用，发送时作为 system 消息注入技能写作规范（与 work-context 合流）
- 记忆存储用于长期上下文（`memory_search`/`memory_upsert`）

### 技能库（Novelist-Skills 子模块）

`skills/` 是 git submodule（https://github.com/KurohaneKaoruko/Novelist-Skills.git ），提供场景写作、正文铁律、剧情规划、连续性维护、风格库（热血/轻小说/悬疑/言情/科幻/仙侠）等 SKILL.md 技能：

- 加载优先级：`IRIS_CREATION_SKILLS_DIR` 环境变量 > 可执行文件旁 `skills/` > 编译期内嵌（build.rs 生成 `skills_data.rs`）
- 克隆后需 `git submodule update --init --recursive`
- 每个技能是 `<skills>/<id>/SKILL.md`，YAML frontmatter（name/description）+ 正文（prompt）

### 前后端通信

Web 前端与后端通过 **HTTP RPC + WebSocket** 通信（见下方「新版 Web UI」）；桌面壳另保留 Tauri invoke 通道。

### Web UI（`webui/`）

`webui/` 是唯一 Web 前端（React 18 + Vite + TS strict），由 `iris-creation-server` 托管静态资源并暴露 RPC/WS：

```bash
cd webui
pnpm exec vite build      # 构建到 webui/dist（生产由 iris-creation-server 托管）
npx tsc -b tsconfig.json --noEmit   # 类型检查
pnpm exec vite            # dev 服务器端口 1421，/api /ws 代理到 8765
```

- 运行方式：`./src-tauri/target/debug/iris-creation-server --port 8765 --static-dir webui/dist --data-dir <data>`（Rust 改动后需 `CARGO_HTTP_PROXY='' cargo build --bin iris-creation-server` 并重启）
- RPC：`POST /api/rpc/{cmd}` 返回 `{ok}|{err}`，全部命令绑定在 `webui/src/api/backend.ts`（新增命令改 `src-tauri/src/server/rpc_dispatch.rs` 后在此扩展）
- `export_work`：合并 stories/ 全章导出 md/txt（剥 frontmatter 与首个标题防重复，元数据 title 优先）
- `delete_chat_session`：保留式删除（四通道：service/Tauri/dispatch/backend.ts）
- 前端错误中文化：`useChat.ts` 的 `localizeError`（11 类映射，未命中透传）
- WS：帧格式 `{"event","payload"}`，事件 `ai_stream_start/token/done/status`、`ai_agent_step`（工具步骤）、`ai_perf`（性能）、`ai_error`（后端发 ai_error 后**不一定**跟 done，前端必须自行终止流）、`fs_changed`；取消流发 `{"type":"cancel","streamId"}`
- useChat 竞态教训：事件订阅必须在组件挂载时建立一次（ref 过滤 streamId），**不能**按 streamId 动态挂订阅——RPC 先于订阅到达会丢事件
- 作品内数据（人物卡/情节线/章节元数据/记忆索引/写作历史）在 `webui/src/api/novel.ts`，直读直写 Markdown/JSON，与旧桌面端格式双向兼容
- vite **不要**手动分包（manualChunks 会破坏 Prism 全局初始化契约，导致白屏）
- 视觉规范教训：emoji 图标+玻璃拟态+999px 胶囊是「廉价感」三大来源（2026-11 用户否决）；设计令牌用 global.css 的 --radius-sm/radius/lg/xl 四档圆角与 --bg-primary/secondary/tertiary/elev 四级实体表面；弹层遮罩一律 var(--overlay) 不写死 rgba（浅色主题会发黑）
- 测试：`pnpm exec vitest run`（include `src/**/*.test.ts(x)`；`.gitignore` 白名单已放开 `.test.tsx`）

## 代码约定

- React 组件使用 `.tsx` 扩展名
- 服务是模块文件导出的单例实例
- Tauri 命令使用域前缀（如 `set_workspace`、`get_app_settings`）
- 设置变更应通过设置服务进行，不直接操作文件
- AI 响应为流式；通过 `chat_cancel_stream` 处理取消
