# Spec Delta

## Purpose

内置 AI 面向小说创作特化：工具集收敛为小说创作所需，明确排除命令执行、shell、网络访问等通用 agent 能力，并补充小说专用工具与提示词，使生成行为更贴合小说写作。

## ADDED Requirements

### Requirement: 工具白名单

内置 AI 的 agent 工具集 SHALL 为白名单制，MUST 仅包含：
- 工作区受限文件工具：`fs_read_text`、`fs_list_dir`、`fs_exists`、`fs_create_dir`、`fs_create_file`、`fs_delete_entry`、`fs_rename_entry`、`fs_write_text`（路径 MUST 被约束在工作区内，拒绝 `../` 逃逸）
- 记忆工具：`memory_upsert`、`memory_search`
- 小说专用工具：`novel_list_chapters`、`novel_read_index`、`novel_write_chapter`

系统 MUST NOT 向内置 AI 提供命令执行、shell、任意进程、网络访问类工具；此约束 SHALL 由单元测试固化（断言注册表无 exec/shell/bash/network/http 类工具名）。

#### Scenario: 无命令执行能力
- **WHEN** 内置 AI 请求执行 shell 命令类工具
- **THEN** 该工具不存在于注册表，调用被拒绝

#### Scenario: 文件工具路径逃逸被拒
- **WHEN** 内置 AI 以 `../` 形式路径访问工作区外文件
- **THEN** 工具返回错误，不产生工作区外的任何读写

### Requirement: 小说专用工具

系统 SHALL 提供小说专用 agent 工具：
- `novel_list_chapters`：列出 `stories/` 下章节及各章字数
- `novel_read_index`：读取人物状态索引与伏笔索引（`.novel/state/`）
- `novel_write_chapter`：向 `stories/` 写入整章内容并返回字数统计

#### Scenario: 查询章节列表
- **WHEN** 内置 AI 调用 `novel_list_chapters`
- **THEN** 返回章节文件列表与各章字数

#### Scenario: 写入整章
- **WHEN** 内置 AI 调用 `novel_write_chapter` 写入合法章节路径
- **THEN** 文件写入 `stories/` 下并返回字数统计，路径约束在工作区内

### Requirement: 小说专用系统提示词

内置 AI 的系统提示词 SHALL 面向小说创作（视角一致性、文风、章节结构、设定一致性约束），SHALL NOT 包含引导通用任务执行的措辞；提示词与既有写作技能（风格、剧情技巧、人物）协同。

#### Scenario: 提示词不含通用 agent 引导
- **WHEN** 审查内置 AI 默认系统提示词
- **THEN** 其内容为小说创作规范，不包含命令执行、系统操作类引导
