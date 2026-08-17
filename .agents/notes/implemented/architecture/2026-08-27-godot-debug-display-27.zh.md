# Agent Note：Godot 调试器 2.7.0 显示升级（dsh-tool-godot-debug）

Status: implemented

[English](2026-08-27-godot-debug-display-27.md) | 中文

## 问题

源插件 2.7.0 发布（godot-vscode-plugin PR #944，commit e99adb0）重构了调试器变量显示：`__repr__` 显示名、`&'StringName'` 表示、字符串引号、category 追踪属性名、数组值预览。我们的移植只有 2.7.0 之前的表面（v1 简化），且 pin 过程中发现一个潜在编码器崩溃：对象 id 超过 2^63-1 时抛 RangeError。

## 决策

将 2.7.0 显示表面移植进一次性架构（用户裁定：按参考插件成熟行为，不现编规则——`.context/plans/godot-debugger-display-27计划.md`）：

- **Category 追踪属性名**（`parseInspectProps`，对齐 `server_controller.ts` L464-485）：usage-128 标记命名其后裸属性的分组（`Node/process_mode`、`Node/script`、`Node/Process = null`——组头行保留显示）；`Members/`/`Constants/` 前缀剥离；烘焙前缀（`Node/path`）保留。Godot 4.7 实测 pin（`.context/t13/facts.md` 事实 4/7/8）。
- **`__repr__` 显示名**：`expandObjects` 改为**两阶段**——先全部 fetch（保留原始 props，预算/去重/跳过语义不变），再以 repr 索引渲染（`Members/__repr__` → 原始值，事实 1/2）。条目头显示 `<repr> [class]`；对已展开对象的引用（属性值、数组预览）解析其 repr；其余保持 `Object<id>`。记录在案的差异：源插件经 VariablesManager 惰性解析；一次性工具只解析已展开对象。
- **显示规则**（`renderValue`/`renderPreview`）：StringName 渲染 `&'x'`（值与 dict 键路径——旧 `String(key)` 对 StringName 键产生 `[object Object]`，事实 3）；数组预览项渲染**实际值**——数学类型裸 stringify（`(2) [(11, 12), (21, 22)]`）、repr 解析、原始值照旧；顶层数学值保持 `Vector2(10, 20)`。
- **编辑契约**（事实 5）：引擎**静默拒绝**非 `Members/` 前缀的写入标签（`Node/process_priority` 实测被拒）。`findPropRow` 匹配顺序：精确 → `Members/`/`Constants/` 不敏感 → category 前缀剥离；带 category 前缀的单段编辑在 set 前经一次实时 inspect 解析**原始 label**（裸名/`Members/` 名保持已 pin 的 Phase 6 无预查形态——t6 fixture 字节不变）。
- **编码器修复**（事实 6）：bigint 变体写二补码 UINT64 位（非负走 `writeBigUInt64LE`）——RefCounted id 超过 2^63-1（t13 实测 9223372064000312793）此前抛 RangeError 并截断展开。

## 协议事实（Godot 4.7 实测，`.context/t13/facts.md`）

- `__repr__` 以 `Members/__repr__` 到达（usage 4100），值为 String。
- StringName dict 键解码为 StringName 实例。
- 组头行：`Process`(64)、`Thread Group`(256)、`Physics Interpolation`(64)、`Auto Translate`(64)、`Editor Description`(64)——null 值，非 usage-128 标记。
- 引擎标签接受性：裸名 ✓、`Members/` ✓（T6 复证）、`Node/` ✗ 静默。
- RefCounted 对象 id 可超过 2^63-1；引擎以二补码位回显。

## 与源插件对齐及差异

Category 追踪与显示规则逐行对齐 2.7.0 代码路径。记录在案的差异（README 已述）：(a) 组头行与 category 前缀按 2.7.0 规则渲染 4.7 payload（源插件 CI 时代的 Godot 编码不同——机制相同）；(b) scope 层 ObjectId 保持 `Object<id>`（解析类名需逐值请求，超出一次性预算）；(c) dict 键独立行 `&'k'` 显示归 T16（路径保持裸值，编辑回环不变）。

## 测试

- 真机探针 `.context/t13/run-t13.mjs`（tsc 预编译构建）：raw 事实 + 出货 `runDebug`——Godot 4.7 上 8/8 显示断言（`thing = Thing(hero)`、`(2) [Thing(a), Thing(b)]` 预览、`&'hero'`、`Node/process_mode`/`Node/script`/`Node/Process` 行、`sn_key_dict["snkey"]` 子路径、`Node/process_priority` 编辑经原始 label ok、6 对象展开无截断——编码器修复）。
- 单测：category 追踪、repr 解析（两阶段 fetch→render）、键显示、预览规则、findPropRow 前缀匹配、前缀单段编辑流程、编码器 uint64 往返。
- e2e：fixture 回放零改动（t3/t5/t6/t8/t10/t14——fixture 未动）；快照重录（4 个）。
- 174 测试全绿（3 smoke-real 跳过）、lint 0、tsc 0。

## 影响

- 模型看到与源插件用户一致的 2.7.0 显示表面：可读对象名、`&'x'` StringName、真实数组预览、分组属性名——且可编辑分组属性而不触发引擎的静默标签拒绝。
- 编码器现可处理 unsigned-high id——此前长运行游戏的展开会被截断。
- 遗留：dict 键展开与 `&'k'` 键名（T16）、场景树节点联动（T15）、跨 stop 去重（T13）、scope 层 ObjectId 类名（记录在案的差异）。
