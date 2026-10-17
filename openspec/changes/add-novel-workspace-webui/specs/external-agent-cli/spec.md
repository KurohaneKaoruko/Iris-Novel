# Spec Delta

## Purpose

让用户能够在内置 AI 之外，调用本机已安装的外部 Agent CLI（Claude Code、Codex CLI、DeepSeek Harness）进行小说写作，并通过快照+审阅机制保证作品文件安全。

## ADDED Requirements

### Requirement: CLI 检测与配置

系统 SHALL 提供外部 Agent CLI 的可用性检测（可执行文件存在 + 版本探测），并在 UI 中展示各 CLI 的可用状态；任务启动前 MUST 再次校验，不可用时明确报错。

#### Scenario: 检测已安装的 CLI
- **WHEN** 用户打开外部 Agent 面板或触发检测
- **THEN** 系统显示每个预置 CLI（Claude Code / Codex CLI / DeepSeek Harness）的可用状态与版本信息

#### Scenario: 任务启动时 CLI 不可用
- **WHEN** 用户以某 CLI 发起写作任务但该 CLI 未安装或不可执行
- **THEN** 任务不启动，UI 明确提示该 CLI 不可用及原因

### Requirement: 任务发起与上下文拼装

用户 SHALL 能选择 CLI 与作品，输入写作任务；系统复用与内置 AI 相同的小说上下文管线拼装任务书（写作规范、设定/大纲/前情、当前章节、目录结构说明），并以 headless 模式在作品目录内启动 CLI。

#### Scenario: 发起 CLI 写作任务
- **WHEN** 用户选定 CLI 并提交写作任务
- **THEN** 系统组装含小说上下文的任务书，在该作品目录内以 headless 模式启动所选 CLI

#### Scenario: 上下文与内置 AI 同源
- **WHEN** CLI 任务书被组装
- **THEN** 其设定/大纲/前情内容与内置 AI 上下文注入使用同一检索管线，不另建一套

### Requirement: 写入管控双模式

外部 CLI 对作品文件的写入 SHALL 支持两种模式，默认为"快照+审阅"：
- **快照+审阅**：任务前对作品目录（不含 `.novel/`）做快照，任务结束后对比产出变更集（新增/修改/删除 + 新旧内容 + diff），用户逐文件接受或回滚，处理完毕后清理快照。
- **直接写入**：跳过审阅直接生效，系统 MUST 自动记录一条版本历史快照。

模式可在设置中切换。

#### Scenario: 默认快照+审阅流程
- **WHEN** CLI 任务在默认模式下完成且产生了文件改动
- **THEN** 系统展示变更集供用户逐文件审阅，未接受的改动可一键回滚

#### Scenario: 直接写入模式自动存档
- **WHEN** CLI 任务在直接写入模式下完成
- **THEN** 文件改动直接生效，且系统自动创建版本历史快照

### Requirement: 进度展示与取消

CLI 运行期间的 stdout/stderr SHALL 实时推送到 UI（事件流），用户可随时取消任务；取消 MUST 终止整个进程组，且若已有改动则进入变更集审阅。

#### Scenario: 实时查看 CLI 输出
- **WHEN** CLI 任务运行中
- **THEN** UI 实时增量显示该 CLI 的输出内容

#### Scenario: 取消运行中的任务
- **WHEN** 用户在 CLI 任务运行中点击取消
- **THEN** 进程组被终止，任务转入结束状态；若已产生文件改动则进入审阅流程

### Requirement: 任务互斥

同一作品同一时间 MUST 至多运行一个外部 CLI 任务；不同作品间互不影响。违反互斥的发起请求 SHALL 被拒绝并提示。

#### Scenario: 同作品并发被拒
- **WHEN** 某作品已有 CLI 任务运行中，用户再次为该作品发起 CLI 任务
- **THEN** 第二次发起被拒绝并提示已有任务运行

### Requirement: CLI 安全边界声明

CLI 任务书 MUST 包含明确的目录约束（仅操作作品目录内文件、禁止触碰 `.novel/` 目录与快照目录）；Web 部署时 CLI 进程在服务端主机执行。

#### Scenario: 任务书含安全约束
- **WHEN** 系统组装 CLI 任务书
- **THEN** 任务书文本包含对可操作范围与禁入目录的明确声明
