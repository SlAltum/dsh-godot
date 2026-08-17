# Agent Note：Godot 调试变量展开（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-19-godot-debug-inspect.md) | 中文

## Problem

每次停顿快照把对象变量渲染为 `Object<id>` 占位（snapshot.ts 的 GDObject 分支）——模型看不到对象内部状态，这是调试报告最大的信息缺口。源插件通过 `scene:inspect_object` 惰性拉取对象属性（VariablesManager/GodotObjectPromise 机制），但那是 UI 驱动（mapper/promise 管道），与一次性工具调用不兼容。

## Decision

为 `godot_debug` 增加**有界直展开**（不新增包；协议事实已 pin 在 `.context/t5/facts.md`）：

- 在**首个有帧的停顿**（与全量 scopes 渲染同一停顿）之后、仍在暂停态时，对该停顿顶层 `ObjectId` 值**串行**发送 `scene:inspect_object [id]`（RID 排除——其 inspect 返回空响应，已 pin），把返回的属性六元组渲染进报告的 `expanded objects` 节。
- **按 id 匹配**：响应 id（INT64，实测非负；负值防御性 +2^64 归一）必须与请求的 UINT64 bigint 相等。仅靠串行无法防止「超时等待的迟到响应被下一次请求消费」（controller 历史优先消费匹配消息）——id 谓词是防线。
- 有界：`maxExpandedObjects`（默认 10，`0` 禁用；allowZero 校验）、`maxExpandedProps`（默认 100）、展开预算 = `min(剩余运行预算 − 收尾余量, 最坏上限)`、每对象等待 = `min(idleTimeoutMs, 剩余预算)`。
- 失败三分：对象级超时/畸形 = 跳过 + `expansionTruncated`；断开 = 运行级结束（stop 循环返回部分结果）；外部取消 = `GODOT_ABORTED`。畸形帧经 controller 的 failProtocol 路径冒泡为 `GODOT_UNAVAILABLE`（非 PARSE）。
- controller 新增表面：公开 `waitForMessage(pred, timeoutMs, signal)`（私有 `waitFor` 对工具层不可达）；`route` 不变。
- 结果字段：`expansion`（stopIndex + entries：name/id/className/rows）、`expandedObjects`、`expansionTruncated`——execute() 归一化（null → 省略）并同步 output schema 与 card meta。

## Protocol facts（Godot 4.7 实测，`.context/t5/facts.md`）

- 响应：`scene:inspect_object [id, className, props]`；`id` 为非负 INT64 且与请求 UINT64 相等（往返 12-21ms）。属性六元组 `[name, typeCode, hint, hintString, usage, value]`——**第 2 个元素是 Variant 类型码（数字），不是类名**；`usage === 128` 为分类分组元素（跳过；后续属性已自带分组前缀）。`Members/`/`Constants/` 前缀剥离；其他前缀（`Node/`）保留。
- 响应 `className` 是**引擎类**（`get_class()`，`class_name Player` 脚本也显示 `Node`），非脚本类名。
- **非暂停态（运行中）游戏不响应**——展开必须在暂停态执行。RID 的 inspect 返回空响应（选择时排除）；已释放对象在变量列表里已解码为 `null`（无 id 可查）。
- break 暂停停为空栈且无对象变量——展开自然跳过。

## Source-plugin alignment 与差异

响应解析对齐 server_controller.ts L438-504（六元组、usage=128 分类、前缀剥离）。差异：交互式 GodotObjectPromise/get_sub_values 机制改为串行有界等待；分类前缀原样保留（而非源插件的 `${category}/${name}` 重拼——4.7 协议已在名称内嵌分组）；`+2^64` id 转换仅防御。

## Testing

- `inspect.spec.ts` 13 个单元/集成测试（选择/去重/RID 排除、六元组解析含畸形防御、id 归一化、对照真实 Godot `t5-inspect` fixture 的 expandObjects 成功路径、id 不匹配超时跳过、预算耗尽、断开与取消传播、stale 响应 id 错配）+ runDebug 展开 3 测试（launch/attach/禁用）+ REAL-composition 测试含 snapshot + 真机冒烟断言 `self` 展开。
- keyless fixture `t5-inspect.bin`/`t5-inspect.json`（19 帧 5412 字节）；FakeGame 现按**请求 id** 分发 `scene:inspect_object` 响应（manifest trigger `inspect:<id>`），多对象串行展开可正确回放。
- **发现并修复 encoder bug**：`sizeVariant` 把 bigint 按 8 字节计算而 INT64 写入需要 12——所有含 bigint 的命令（即每个 inspect 请求）都会 buffer 溢出抛 RangeError。已加回归测试。
- launch/attach 回归：Phase 5 前全套照常通过（95 测试全绿）。

## Consequences

- `VariantEncoder.sizeVariant` 的 bigint 修复是对既有 codec 的正确性修复，不只服务于 Phase 5。
- 展开为模型可见输出增加有界行数（`maxExpandedObjects × maxExpandedProps`）；跳过/无响应的对象保持 `Object<id>` + `expansionTruncated`。
- 展示的类名为引擎类——文档化说明响应不含脚本类名。
