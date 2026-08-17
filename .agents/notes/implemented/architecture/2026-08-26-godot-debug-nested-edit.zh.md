# Agent Note：Godot 调试嵌套/容器内属性编辑（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-26-godot-debug-nested-edit.md) | 中文

## Problem

Phase 6 交付了 `scene:set_object_property` 对**顶层**对象标量属性的编辑；数组/字典成员与嵌套对象属性延后（源插件 `changes_parent` 路径）。Phase 8 的展开暴露了定位路径（`arr[0]`、`dict["k"]`）——天然挂载点——但当时无法经它们写入。

## Decision

把 `edits.property` 扩展为接受嵌套路径，并按源插件 changes_parent 语义实现，边界显式化（`.context/t14/facts.md`）：

- **路径语法**：首段属性名（裸名或 `Members/` 前缀），后接任意 `[index]`、`["key"]`（含转义）与 `.property` 段：`arr[0]`、`dict["k"]`、`arr[0].x`、`arr[0][1]`。单段路径 = Phase 6 原流程（不增加 inspect——t6 请求形状不变，由 t6 fixture 回归验证）。
- **解析**（`resolveEditPath`）：活体 inspect 链——每段 `.property` inspect 当前对象；`[index]`/`["key"]` 下钻解码容器；嵌套 ObjectId 跳转其自身 id。末段为普通属性 → 在解析到的对象上编辑该属性；末段为容器成员 → **重建整个最外层容器**（深克隆 + 替换成员）写回所属属性——协议没有逐元素 set（事实 1/2：整数组/整字典重建持久、长度跟随写入）。
- **重建门禁**（`rebuildReason`）：含 ObjectId/RawObject/NodePath/Callable/Signal 的容器**发送前**即失败并给出可读 detail——引擎对含对象引用的整写**静默拒绝**（事实 7），门禁是必须而非优化。
- **编码器增量**（用户裁定：含数学类型）：编码器现可写解码器产出的全部数学类型（Vector2/2i/3/3i/4/4i、Rect2/2i、Basis、AABB、Transform2D/3D、Plane、Quat、Projection、Color——float32，与解码器对称），含数学值的容器可正确重建（事实 6：Vector2 成员往返）。
- **值比较**：StringName 类型属性回读为 StringName——`valueEquals` 与请求的普通字符串等价比较（事实 3）。

## Protocol facts（Godot 4.7 实测，`.context/t14/facts.md`）

- 整数组重建写入：被接受并持久，含嵌套数组成员；数组**长度跟随**重建值。
- 整字典重建：被接受并持久；StringName 键经往返保留。
- 未类型化容器成员**无强制转换**（12.5 保持）——不同于类型化属性的截断。
- 类型化容器：`PackedInt32Array` 接受纯 int 普通数组（转换）；类型化 `Array[int]` 含错型元素时**整写拒绝**（静默、值不变）。
- 含 ObjectId 的容器：引擎静默拒绝整写。
- 嵌套对象属性经其自身 id 直写与顶层一致；StringName 类型属性回读 StringName。
- 连接调试器期间游戏 `window:title` 上报 `(DEBUG)`（副产品观察）。

## Source-plugin alignment 与差异

changes_parent 机制（向上走到最外层容器、重建、写回所属者）与 `debugger.ts` `edit_value` + `inspector_provider.ts` `get_changed_value` 一致。差异：(a) 我们对含对象引用的容器**显式失败**而非静默损坏（源编码器同样没有 ObjectId 分支——边界事实相同，但我们显式化）；(b) 数学类型编码与**我们的**解码器对称；(c) 验证仍是 re-inspect 制（引擎对 set 无确认，T6.0 事实 1）。

## Testing

- 真机管线探针 `.context/t14/run-t14-pipeline.mjs`：把**出货版 runDebug** 经录制 TCP 代理运行（fake subprocess seam 把 spawn 的 `--remote-debug` 改写指向代理）——运行结果本身即真机冒烟（Godot 4.7 上 4/4 嵌套编辑通过），录制的字节成为 keyless FakeGame fixture（`t14-edit.bin/json`，33 帧，含路径行走请求的逐 id 序列）。
- 单测：`parseEditPath`（语法/转义/非法）、`findMapEntry`（string/StringName/数字键）、`rebuildReason` 门禁、`rebuildContainer`（克隆隔离、嵌套应用、长度增长）、`valueEquals` StringName、编码器数学类型往返。
- e2e：`applyEdits` 与 `runDebug` 对 t14 fixture 回放（成员重建 + 嵌套对象属性编辑；门禁/不可下行/越界/缺键的失败 detail）。
- 全量 165 测试绿（含 t6/launch/attach 回归；snapshot 不变）；lint/tsc 干净。

## Consequences

- 模型现可用渲染出的展开路径编辑数组元素、字典值、嵌套数组成员与嵌套对象属性——把 Phase 6 的编辑能力补全到引擎自身的边界（容器内对象引用、类型化容器元素类型）。
- t6 顶层编辑路径逐字节不变（单段路径不增加 inspect），既有 fixture 与测试全部保留通过。
- 遗留：容器键编辑（T16）、场景树节点联动（T15）、多 stop 编辑（T13）。
