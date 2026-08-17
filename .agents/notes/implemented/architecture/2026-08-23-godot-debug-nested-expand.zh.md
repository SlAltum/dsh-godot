# Agent Note：Godot 调试嵌套对象展开（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-23-godot-debug-nested-expand.md) | 中文

## Problem

Phase 5 展开只渲染顶层对象值：`expanded objects` 呈现 `self`/`player` 的属性行，但属性值里的 `Object<id>` 保持占位——模型看到 `player = Object<27061650910> [Node]` 却看不到它的属性。源插件用 `get_sub_values`（helpers.ts L36-72）无限递归（数组→索引子值、Map→键子值、GDObject→成员子值，再逐层递归）。这种无界 UI 驱动递归与一次性工具调用不兼容。

## Decision

把展开升级为**有界递归展开**（不新增包；协议事实已 pin 在 `.context/t8/facts.md`）：

- 顶层选择不变；当 `maxExpandDepth > 1`（默认 2，config `maxExpandDepth`，1 = 与 Phase 5 完全一致）时，属性值内的 ObjectId 以同样的串行/id 匹配协议递归：直接属性、数组元素（`arr[i]`）、字典值（`dict["k"]`）。字典**键**不展开（源插件规则，T8.0 事实 1）；`RawObject`（内联解码对象，Map 子类）也不遍历。
- **顶层优先去重**：每个选中的顶层 id 预保留，因此同时出现在属性内的顶层对象（如 `self.player` == 顶层 `player`，T8.0 事实 2）只展开一次、在顶层；嵌套 children 携带定位路径名。
- `ExpandedEntry` 新增可选递归 `children`（现有字段不变——向后兼容）。渲染按更深缩进递归；`expanded objects (N):` 头部统计**全部**展开数（顶层 + children）。
- 有界：展开预算 `min(剩余运行预算 − 收尾余量, maxExpandedObjects × maxExpandDepth × idleTimeoutMs)`；每对象等待 `min(idleTimeoutMs, 剩余)`。失败三分不变（对象级跳过 + 标记 / 断开运行级 / 取消）。
- output schema 把 `children` 声明为 `items: json`（schema 无法递归）；execute() 返回时把展开载体断言为 schema 形状（运行时值均为纯 JSON——entry id 已是字符串）。

## Protocol facts（Godot 4.7 实测，`.context/t8/facts.md`）

- 容器形态确认：`Members/arr`（typeCode 28）解码为 `[ObjectId]`、`Members/dict`（typeCode 27）为 `{k: ObjectId}`——collectNestedIds 遍历 Array 元素与 Map 值。
- **同 id 重叠是常态**：顶层变量与 self 的属性可指向同一对象（去重是正确性需求，非优化）。
- **三级链在协议层不可见**：Node 属性不暴露子节点 ObjectId（无自然深度 3 负载）——深度上限是产品策略，由单测用合成数据覆盖。
- 嵌套响应 id 与请求逐位相等（同 T5.0 事实 1）；往返 13-21ms 与顶层相同。

## Source-plugin alignment 与差异

遍历规则对齐 `get_sub_values`（数组/Map/GDObject 成员；键只渲染不递归）。差异：无界递归改为 `maxExpandDepth` 有界（默认 2）；源插件的交互式展开改为一次性串行；children 以内联缩进渲染（非 UI 树）；`RawObject` 跳过（其成员是对象自身属性，已作为 rows 渲染）。

## Testing

- `inspect.spec.ts`：collectNestedIds（直接/数组/字典路径、RID/null/原始值跳过、字典键不递归、RawObject 跳过）、对照真实 Godot `t8-nested` fixture 的递归展开（5 次展开：顶层 self+member_a+player，children arr[0]/dict["k"]；顶层去重）、深度 1 == Phase 5。
- runDebug 嵌套测试（定位路径递归、深度 1 不递归）+ REAL-composition 测试含 snapshot（缩进 children、`arr[0]`/`dict["k"]` 行）+ 回归：Phase 8 前全套照常通过（136 测试含真机冒烟）。
- keyless fixture `t8-nested.bin`/`t8-nested.json`（20 帧 9724 字节；5 次 inspect 往返）。
- **本阶段发现两个产品 bug**：① `expandedObjects` 只统计顶层 `entries.length`（children 展开数丢失）——展开载体现携带真实计数，schema/render 同步使用；② `RawObject`（Map 子类）被当容器遍历，请求了 fixture 无响应的 id——现跳过。

## Consequences

- `maxExpandDepth` 默认 2 改变默认报告：嵌套对象属性渲染 children 行（受 深度×对象×属性 上限约束）；`maxExpandDepth: 1` 恢复 Phase 5 精确输出。
- 去重规则（顶层优先）意味着既是顶层变量又是属性的对象只出现一次、在顶层。
- 嵌套 children 是未来逐子编辑（T14）与场景树节点联动（T15）的自然挂载点。
