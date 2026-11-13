# 归档说明：redesign-liquid-glass-ui

- 归档日期：2026-11-13
- 归档方式：`openspec archive redesign-liquid-glass-ui --skip-specs --yes`（未合入主 specs——该变更的产出在 2026-11 的 Agent 工作台重构中已被替换）

## 为何归档

1. **实现目标已不存在**：本变更引用的代码路径（`src-react/src/App.css`、`src-react/src/components/ProjectPickerPage.tsx` 等）属于已于 2026-11 退役删除的旧桌面端 Lexical 前端（`src-react/`）。变更未实施即失去对象。
2. **设计方向被否决**：2026-11 用户明确否决「玻璃拟态」视觉方向（backdrop-blur 半透明表面、发丝边框、玻璃胶囊状态栏），现行视觉规范（根目录 `AGENTS.md`）明令禁止 emoji 图标 / 玻璃拟态 / 999px 胶囊按钮，改为实体表面 + SVG 图标体系。本变更的「液态玻璃」提案与现行规范正面冲突，不应再作为活动变更保留。
3. **任务标记为 Complete 但非本仓库现状**：tasks.md 全部勾选针对旧前端，不代表当前 `webui/` 的任何行为；保留在 changes/ 会误导后续治理判断。

## 现状对照

- 现行设计令牌：`webui/src/styles/global.css`（`--bg-primary/secondary/tertiary/elev` 四级实体表面、`--radius-sm/lg/xl` 圆角阶梯）。
- 现行 Agent 工作台视觉规范：根目录 `AGENTS.md`「前端 (`webui/`)」一节。
