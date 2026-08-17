# Agent Note：Godot 调试器场景树节点联动（dsh-tool-godot-debug）

Status: implemented

[English](2026-08-27-godot-debug-tree-link.md) | 中文

## 问题

Phase 7 在每个有帧停顿快照场景树（`name [class] (id)` 行），且 T7.0 已 pin 节点 id 与 `scene:inspect_object` **同一 id 空间**——但模型只能"看"树，没有任何入口用节点 id 或路径展开/编辑场景节点。

## 决策

以工具参数暴露联动（无新协议——复用 inspect/set）：

- **`expandNodes?: string[]`**——显式场景树节点 id（字符串：JSON 无法无损承载 bigint，id 可超 2^63-1，T13.0 fact 6），在首个有帧停顿**优先于**顶层变量选择展开。
- **`nodePaths?: string[]`**——场景节点路径（`Main/Player`，引擎根除外），经本停顿场景树解析（`scene-tree.ts` 的 `resolveNodePaths`：引擎 root 之下按名字链深度优先匹配，重名取先序第一个，含空段无效）。要求 `maxTreeNodes > 0`。
- **`edits[].target`** 接受 `node:<id>` 与 `path:<场景路径>`（路径在 collectStops 内经本停顿树解析为 `node:<id>` 形式；无法解析的路径保持原 target，以标准 not-editable detail 失败）。
- 三个来源（expandNodes、nodePaths、顶层变量）相互去重——同一对象在作用域内时树节点 id 即变量 id。

**设计发现（协议现实）：原始 id 无法跨调用复用。** launch 模式 id 每次运行随机；被 attach 的游戏只拨**一个**调试服务器（T11.0），detach 后不重连（T4.0）——探针构建的双会话 attach 流程（会话 1 取树、会话 2 复用 id）实测以 "game did not connect" 失败（游戏不重新拨号）。**场景路径是唯一稳定的跨调用通道**：场景结构跨运行静态。相关已 pin 边界：`pauseOnAttach` 的 `break` 暂停空栈**且**树仅 root，联动须在动态断点停顿上执行。

## 测试

- 单测：`resolveNodePaths`（嵌套路径、无法解析/空段/null、重名先序）、expandObjects extraIds（带名、去重、显式优先、maxObjects=0 仍生效）、findEditTarget `node:` 形式。
- e2e：nodePaths 接线（t7 fixture——树有响应、inspect 超时 → truncated 但证明已接线）、无树时 path: 编辑干净失败、t6 fixture 上 node: 编辑。
- 真机：`.context/t13/run-t13.mjs` tool-link——**单次** attach 会话 + 动态断点：树 → `nodePaths:["Main"]` 展开出名为 `Main` 的条目（className Node）→ `path:Main` 编辑 ok。tool-run 的 8 项显示断言零变化。

## 影响

- 模型可按稳定路径（`nodePaths`、`path:` target）在 launch 与 attach 下展开/编辑任意场景节点；原始 id 仅在单次运行内可用。
- 遗留：ObjectId 字典键 repr 键名曾"随 T15 再议"——键显示仍用 `<id>`（记录于 T16 笔记）。
