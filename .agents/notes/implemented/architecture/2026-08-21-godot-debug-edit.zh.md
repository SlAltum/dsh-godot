# Agent Note：Godot 调试变量编辑（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-21-godot-debug-edit.md) | 中文

## Problem

Phase 5 之后模型能**读**对象属性（展开）但不能**写**——「改值 → 继续 → 观察效果」的调试闭环无法实现。源插件通过 inspector UI 编辑值（`debugger.ts` L332-397 `edit_value`）：读取当前值的 JS 类型、解析输入框字符串、发送 `scene:set_object_property [id, label, value]`、刷新 inspector 验证。这种 UI 交互与一次性工具调用不兼容。

## Decision

为 `godot_debug` 增加**有界直编辑**（不新增包；协议事实已 pin 在 `.context/t6/facts.md`）：

- 在**首个有帧的停顿**（与展开/全量 scopes 渲染同一停顿）、仍在暂停态时，应用模型的 `edits` 请求：`[{ target, property, value, type }]`——`target` 是顶层对象变量名（`self`、`player`），从该停顿的原始 vars 解析为 `ObjectId`（RID 排除、标量变量拒绝——引擎无对应机制，已 pin）。`value` 是按 `type` 解析的原始字符串（`int`/`float`/`string`/`bool`，缺省 `string`）；`int` 按引擎式截断解析（`12.5` → `12`，对齐引擎对 int 属性写入 float 值的强转）。
- **验证 = re-inspect**：引擎对 `set_object_property` **无协议级确认**（事实 1），失败也静默（事实 5：不存在/只读属性与无效 id 均为无错误消息的空操作）。因此每条编辑重新请求 `scene:inspect_object`（id 匹配，同 Phase 5），找到属性（裸名或 `Members/` 前缀名均可——事实 2），比对解码值与解析后请求值。值未变 → `failed: value unchanged`；属性缺失 → `failed: property not found`。
- 有界：`maxEdits`（默认 10，`0` 禁用；allowZero 校验）、编辑预算 = `min(剩余运行预算 − 收尾余量, 最坏上限)`、每条编辑等待 = `min(idleTimeoutMs, 剩余预算)`。
- 失败三分（对齐展开）：条目级解析/目标/超时/不一致 = 记录失败 + `editsTruncated`；断开 = 运行级结束（返回部分结果）；外部取消 = `GODOT_ABORTED`。
- 结果字段：`edits`（stopIndex + results：target/property/requested/type/ok/detail）、`editsApplied`、`editsTruncated`——execute() 归一化（null → 省略）并同步 output schema 与 card meta。
- `findEditTarget` 以裸名匹配 `stack_frame_var` 变量名（它们不带 `Members/` 前缀；调用方给的前缀在两侧剥离）。

## Protocol facts（Godot 4.7 实测，`.context/t6/facts.md`）

- `scene:set_object_property [id, label, value]` **无 ack**；窗口内可能有无关噪音消息（output/error/window:title）——绝不可把「任意消息」当作确认。
- 裸名（`counter`）与带前缀名（`Members/counter`）均生效；int（int32）/float（float32）/string/bool 值全部落盘。
- 类型强转：int 属性 ← float 值截断（`12.5` → `12`）；string 属性 ← int 值静默忽略；只读与不存在属性为静默空操作；无效 id（0、−1）静默且不断开游戏。
- **运行中的游戏也接受写入**（与 inspect 非暂停态 silence 不同）——工具仍只在暂停态应用编辑（模型需要展开结果才能决定改什么）。
- 编辑跨停顿持久：continue → 下一停顿的重新检查显示新值；改动是真实游戏状态，非仅协议层。

## Source-plugin alignment 与差异

发送形态对齐 `server_controller.ts` L145-147，解析规则沿用 `edit_value` 的按当前类型解析（int/float/bool 形式）。差异：值类型在工具参数中**显式**（模型无法从 toFixed(1) 渲染推断 int/float）；验证为逐条 re-inspect（源插件一次性刷新整个 inspector）；`changes_parent` 路径（数组/字典/嵌套对象成员，`get_changed_value` 容器重建）**未移植**——需要整容器值编码，属 Phase 8 嵌套展开之后的范畴。

## Testing

- `edit.spec.ts` 15 个测试：parseEditValue（截断/严格 float/bool 形式/透传）、findEditTarget（裸名/前缀/标量-RID-null 拒绝）、valueEquals、findPropValue（裸名/前缀/缺失）、对照真实 Godot `t6-edit` fixture 的 applyEdits（四类型编辑验证、解析/目标失败不发送、maxEdits 上限、预算耗尽、断开与取消传播）。
- runDebug 编辑测试（launch/attach/maxEdits=0）+ REAL-composition 测试含 snapshot（`edits (4):` 块逐条结果）+ 真机冒烟：在 line 10 暂停把 `self.counter` 编辑为 777 后，下一次 print 输出 `counter=779`——写入落地的直接引擎侧证据。
- keyless fixture `t6-edit.bin`/`t6-edit.json`（45 帧 20840 字节）；**FakeGame 现按 per-id 请求序号分发 `scene:inspect_object` 响应**（`inspect:<id>` 首次、`inspect:<id>:2` 第二次……），因为同一对象编辑前/后的响应字节不同。
- launch/attach 回归：Phase 6 前全套照常通过（114 测试全绿 + 冒烟）。

## Consequences

- 展开/编辑载体的渲染守卫用 `!= null`（execute() 归一化会丢弃 null 载体，无编辑时 `value.edits` 是 `undefined`）——Phase 5 的 `!== null` 有同样的潜在形态。
- `edits` 只作用于顶层对象属性的标量值；文档携带 Known Limitations（标量变量不可编辑、嵌套/容器成员延后、引擎静默失败逐条呈现）。
