# Agent Note：Godot 调试结果卡结构化视图（dsh-tool-godot-debug + ui-plugin-godot）

状态：已实现

[English](2026-08-27-godot-debug-structured-card.md) | 中文

## 问题

`godot_debug` 的结果以整段纯文本（`renderDebugOutput`）呈现。动态工具卡（`docs/ui-plugin-godot.js`）只显示首行加折叠的 `<pre>`——停顿分区、帧、变量、展开树、场景树全部埋在一大段文本里，浏览器侧拿不到任何结构化数据。

## 决策

经工具 `presentationMeta` 携带**结构化、JSON-safe、字节有界**的卡片视图（载体 = `tool/result.meta` → `ToolResultNode.meta`；`resultView` 被排除——它在视图时刻由宿主注册表的 `presentResult` 重算，把 UI 知识放进去会破坏 D3 blast-radius）：

- **`structuredDebugView(value, maxStops)`**（`src/debug-view.ts`）：输入 = execute 归一化后的结果（null 载体已缺失、bigint id 已字符串化——视图层永远见不到 bigint，JSON 边界责任钉死在 execute 层）。输出 `version: 1`：逐停顿帧、**首个有帧停顿**的渲染变量行（与文本报告体积对等——attach `break` 空栈对齐用同一 `fullIdx` 规则）、展开树、编辑结果、逐停顿场景树、有界输出/错误尾部。
- **字节预算**：序列化视图 `VIEW_MAX_BYTES = 256 KiB`；先裁变量行、再裁场景树行，置 `viewTruncated`（框架对 meta 无上限——工具必须自设边界；失控的视图会膨胀会话日志、线缆与客户端内存）。
- **`presentationMeta`** 现返回 `{ ...debugMeta(...), view }`——紧凑 DebugMeta 字段保留以向后兼容；`maxStops` 与 execute 一样用 `Math.min(args.maxStops ?? 10, MAX_STOPS)` 收敛（此前口径不一致）。
- **卡片**（`docs/ui-plugin-godot.js` v2.4）：`parseDebugView` 对不透明 meta 做防御性 narrowing——任何形状违规（数组类型错、字段缺失、版本未知）回退整段文本，单个视图 bug 不会打崩所有结构化卡。结构化渲染：chips 行（`N 停顿`/`M 场景树`/`K 编辑`/`展开对象`/`部分截断`）、每停顿一个折叠分区（帧/变量行/展开树/编辑/场景树）、输出/错误分区、帧文件链接（仅当运行带项目 `path`——launch；attach 无项目映射，帧不可点）。

**类型注意**：`DebugView` 及其家族必须是 `type` 别名而非 interface——interface 没有隐式索引签名，`presentationMeta` 的 `JsonValue` 返回值会在编译期拒绝（`ExpandedEntry`/`EditResult` 也因此重声明为 `DebugExpandedEntry`/`DebugEditResult`）。

## 测试

- 单测（`tests/debug-view.spec.ts`，9 项）：完整视图形状、attach `break` 空栈对齐、全无帧回退、空载体省略、**lossless JSON 往返**（H1/H4 边界）、输出/错误尾部边界、两级字节裁剪、预算内不误截。
- 包回归：195 测试全绿，tsc 0。
- 会话内 e2e：动态演示工具（`godot_debug` 同名 shadow 全局，`harness.defineTool` 支持 `output.presentationMeta`）发射四个受控场景——success（结构化卡）、fallback（无 `view`）、corrupt（`view` 形状违规 → narrowing 拒绝）、error（红卡）。真实 presentationMeta 形状另有 real-composition.spec 的回放夹具覆盖。
- 部署边界：本部署未挂载 tool-godot-debug，真机卡片渲染待有该工具挂载的部署。

## 影响

- 卡片现在按停顿结构化折叠，带帧链接与摘要 chips；不带 `view` 的旧结果渲染与之前完全一致。
- 计划中保留的已知限制：图标资产（T20-opt，约 700 枚 SVG 移植待裁定）、逐变量结构化行（变量区块是渲染字符串——已 pin 的渲染语义保持）、视觉风格文本优先（「类 TUI」为既定选择）。
