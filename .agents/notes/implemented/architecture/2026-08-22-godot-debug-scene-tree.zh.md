# Agent Note：Godot 调试场景树快照（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-22-godot-debug-scene-tree.md) | 中文

## Problem

模型能读堆栈/变量（Phase 1-5）、能编辑对象属性（Phase 6），但**看不到当前场景的节点层级**——「此刻场景里有哪些节点、它们的类与场景文件」是调试的重要维度。源插件在每次 `debug_enter` 与 `stack_dump` 都请求场景树（`server_controller.ts` L416/L518），用 `parse_next_scene_node`（helpers.ts L6-20）解析响应，渲染进 VSCode 的 Scene Tree 面板；点击节点联动 inspector（`debugger.ts` L282-307）。

## Decision

为 `godot_debug` 增加**有界直消费**（不新增包；协议事实已 pin 在 `.context/t7/facts.md`）：

- 在**每个有帧的停顿**（对齐源插件 debug_enter/stack_dump 双触发）、暂停态时请求 `scene:request_scene_tree`（无参数），解析扁平递归响应，按停顿渲染缩进行进报告的 `scene tree` 节。
- 解析遵循已 pin 布局：每节点 `[childCount, name, className, id, sceneFilePath, viewFlags, ...children 深度优先]`；id 为非负 INT64 bigint，且**与 `scene:inspect_object` 同一 id 空间**（树节点 id 可被 inspect——探针已实测，T7.0 事实 8）。`className` 对引擎节点是引擎类、对脚本节点是脚本路径（`res://main.gd`）；`viewFlags`（0/14）丢弃。
- 有界：`maxTreeNodes`（默认 200，`0` 禁用；allowZero 校验）、每停顿树预算 = `min(剩余运行预算 − 收尾余量, maxTreeNodes × 50ms)`、每停顿等待 = `min(idleTimeoutMs, 预算)`。
- 失败三分（对齐展开/编辑）：停顿级超时/畸形 = 跳过该树 + `sceneTreeTruncated`；断开 = 运行级结束（部分结果）；外部取消 = `GODOT_ABORTED`。
- 结果字段：`sceneTrees`（stopIndex + 解析根 + 渲染行）、`sceneTreeCount`、`sceneTreeTruncated`——execute() 返回时丢弃含 bigint 的根（仅 `lines` 过 JSON 边界），同步 output schema 与 card meta。
- 树在展开/编辑**之前**执行（快速、无 id 匹配复杂度；展开/编辑消费 inspect 响应、树消费 scene_tree 响应——谓词互不冲突）。

## Protocol facts（Godot 4.7 实测，`.context/t7/facts.md`）

- 响应：`scene:scene_tree` 的 params 为扁平数组，按 `[childCount, name, className, id, sceneFilePath, viewFlags, ...children]` 消费——**childCount 在前**、5 标量字段、子节点递归（源 `parse_next_scene_node` 完全成立）。
- **运行中的游戏也响应**（9ms 完整树）——与 inspect 非暂停态 silence（T5.0 事实 4）不同；工具仍只在暂停态请求（模型在停顿点看树）。
- 每次请求都响应（~13ms）；静态场景跨停顿返回逐字节相同的树（T7.0 事实 5）——逐停顿快照是语义本身，不是变化信号。
- **`break` 暂停上报仅根节点的树**（childCount 0）——引擎行为，非错误；break 停顿本无栈帧，产品跳过（该事实对未来停顿类型有意义）。
- **树节点 id 可被 inspect**（root Window → `scene:inspect_object` 返回 134 props）——联动可行但延后（v1 仅呈现）。
- 非 ASCII 节点名（`Leaf中文`）解码完整（探针 codec，无错位）。

## Source-plugin alignment 与差异

请求/解析形态完全对齐 `server_controller.ts` L127-128 + L433-437 与 `helpers.ts` L6-20。差异：VSCode TreeDataProvider UI 改为有界缩进行；插件的点击联动 inspect 未移植（仅呈现，v1）；响应周围的 `window:title` 类噪音与其他端点一样忽略。探针的树统计 walker 有计数 bug（无害——原始 params 已逐字段记录；产品解析器按正确的扁平数组消费）。

## Testing

- `scene-tree.spec.ts` 8 个测试：parseSceneTree（扁平递归布局、脚本路径 className、非 ASCII 名、root-only 树、非数组/零预算防御、节点预算上限）、renderSceneTree（缩进/类/id/文件行、root-only 单行、maxNodes 上限、null 根）。
- runDebug 场景树测试（逐停顿快照含同树断言、maxTreeNodes=0 禁用、attach 模式）+ REAL-composition 测试含 snapshot（`scene tree (8 nodes):` 块、`Leaf中文` 行）+ 真机冒烟断言根 `Window` 行与缩进子节点。
- keyless fixture `t7-tree.bin`/`t7-tree.json`（18 帧 15548 字节）；**FakeGame 现按请求序号分发 `scene:scene_tree` 响应**（`scene_tree` 首次、`scene_tree:2` 第二次……），因为管线不能对每个请求重放同一帧。
- launch/attach 回归：Phase 7 前全套照常通过（129 测试全绿含冒烟）。

## Consequences

- `maxTreeNodes` 约束每停顿渲染行数；静态场景每停顿树相同（语义：该停顿点的树，非差异）。
- 场景树根携带 bigint id——execute() 归一化剥离（`sceneTrees` = `{stopIndex, lines}[]`），output schema 永不见 bigint。
- 树节点 id 在 inspect id 空间内——未来「inspect/展开树节点」可直接复用 `scene:inspect_object`（Phase 8 嵌套展开的候选来源）。
