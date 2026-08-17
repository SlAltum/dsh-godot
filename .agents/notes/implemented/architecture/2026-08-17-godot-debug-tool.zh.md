# Agent Note: Godot 调试工具（dsh-tool-godot-debug）

Status: implemented

[English](2026-08-17-godot-debug-tool.md) | 中文

## Problem

harness 已能对 Godot 项目进行 headless 校验、运行与格式化（`tool-godot`）以及 GDScript 语义导航（`lsp-godot`），但探查运行时状态仍需在被测游戏里加 `print` 语句。VSCode 生态的调试器客户端（godot-vscode-plugin）证明 Godot 的游戏侧远程调试器（`--remote-debug`，自定义二进制协议——非 DAP；`--dap-port` 是编辑器侧的另一条路径，该插件并不使用）是断点、堆栈转储与变量快照的稳定通道。

## Decision

在 `packages/godot/tool-godot-debug` 新增 `@deepseek-ai/dsh-tool-godot-debug`：`godot_debug` 工具运行一次有界、脚本化的调试会话——CLI 断点（`--breakpoints "res://f:l,..."`，单冒号形式）、headless 启动（`godot --headless --path <root> --remote-debug tcp://127.0.0.1:<port>`）、每次停顿的堆栈/变量快照、自动继续至 `maxStops`，最后返回带游戏输出与错误的结构化报告。调用只在运行结束、预算耗尽或取消时返回；游戏进程树在任何路径上都会被终止。

## Protocol facts（Godot 4.7 实测，`.context/t3/facts.md`）

- 连接方向：harness 侧是 TCP **服务器**（预选端口）；游戏连入。帧为 `[u32 LE 长度][单个 ARRAY variant]`，数组为 `[command, threadId, params]`——平铺的顶层 variant 帧会被游戏的 `_read_in` 拒绝（实测两次）。
- 命令必须携带 `threadId`（Godot ≥ 4.2，来自 `set_pid`）；`set_pid` 之前的命令失败。
- `debug_enter` 参数：`[isUserBreakpoint, reason, true, 1]`——用户断点 `reason === 'Breakpoint'`，脚本错误停顿为错误描述（如整数除零）；首标志可可靠区分两者。
- `stack_dump` 参数：`[N, file, line, func, ...]`，`N` = 帧三元组总项数；行号为 **1-based**（与 `godot_validate` 输出一致，无需转换）。
- `stack_frame_vars` 宣告剩余计数，随后是等量的 `stack_frame_var [name, scope(0|1|2), type, value, className]`——第五个 `className` 元素源插件未使用。
- `debug_exit` 是 `continue` 配对触发的"离开暂停状态"事件，**不是**游戏退出信号；无 `--quit-after` 的 headless 游戏会持续运行，因此工具在运行结束后终止进程。
- `output` 消息携带 `PackedStringArray`（类型 34），带尾随 NUL 与多行条目；`error` 消息携带 10 个固定字段加栈三元组列表。
- CLI 断点在 headless 下有效；游戏**不**自动 import——缺少 `.godot` 全局类缓存的项目会触发 Parser Error 停顿而非正常运行。

## 移植时修复的源插件 bug（勿重新引入）

- `encode_String` 将 UTF-16 的 `str.length` 当作字节长度：非 ASCII 路径损坏（截断写入、padding 错位）。已改用 `Buffer.byteLength`；测试含中文 `res://` 路径。
- `encode_variant` 对 `undefined` 写零字节而 `size_variant` 预留 4 字节：产生尺寸不匹配的帧。编码器现在对 `undefined` 抛错。
- `PACKED_FLOAT64_ARRAY` 用 32 位读取器解码（`decodePackedFloat64Array` 是死代码）。该分支现在按 64 位读取。

## 取消与所有权语义

- v1 仅 launch，因此 harness 拥有游戏进程：取消（工具调用超时/调用方信号）= `exec.signal` → 终止进程树，然后等待进程（`kill → await done`，Windows 下防孤儿）。attach 模式随后交付（[2026-08-18-godot-debug-attach.zh.md](2026-08-18-godot-debug-attach.zh.md)）：该模式下工具从不拥有或杀死游戏——收尾为 best-effort 断点移除 + continue + 断开。
- 所有协议等待都有界（`idleTimeoutMs`）且感知信号；停顿等待超时表示"不再有停顿"（部分结果含输出），不是错误。快照等待超时标记 `varsTruncated`，停顿保留空 scopes。
- 输出/错误收集有字节上限（`maxOutputBytes`）与 `outputTruncated` 标志；每作用域变量上限（200）与 `scopeTruncated`；值长度上限。
- 游戏 user 数据目录必须可写：`user://` 创建失败时游戏模式崩溃（信号 11，harness 沙箱下实测；测试用 `APPDATA` 重定向规避）。
- 复用仅限 lsp-godot 已导出的 `verifyGodotVersion` 与 `pickFreePort`；编解码、帧、控制器与工具管线均为包自有（不给 tool-godot/lsp-godot 新增导出）。

## Alternatives considered

- **基于编辑器 `--dap-port` 的 DAP 层**——Godot 的编辑器侧 DAP 服务器与源插件使用的游戏侧 `--remote-debug` 通道是两条路径；直接说二进制协议省去一层翻译并与经过验证的客户端对齐（未移植 `vscode-debugadapter`）。
- **attach-first 工具**——对用户已启动游戏的 break→snapshot→continue 探针需要预约定端口与运行中的游戏，一次性调用无法保证；launch-first 拥有进程与预算。attach 随后以「显式端口 + 调用后启动」契约交付（[2026-08-18-godot-debug-attach.zh.md](2026-08-18-godot-debug-attach.zh.md)）。
- **有状态会话工具**（跨调用 start/continue/query）——与工具套件的无后台任务原则冲突，需要新的会话基础设施；脚本化运行已覆盖模型可见需求。
- **扩展 `tool-godot`**——编解码/控制器/工具管线（约 2000 行）会使该包翻倍并耦合跨包配置；同级包保持工具族的凝聚力（`tool-godot` 覆盖 CLI 工作流，本包覆盖调试运行），且不给既有包新增导出。
- **惰性对象展开**（源插件 VariablesManager 的 `scene:inspect_object` 往返）——一次性工具无法承受交互式展开；对每次停顿变量列表的有界直渲确定且预算安全。对象变量渲染为 `Object<id>`。
- **动态 `breakpoint` 命令**——CLI `--breakpoints` 形式已由 T3.0 pin 并避免连接后握手；动态停顿随 attach 一起交付（[2026-08-18-godot-debug-attach.zh.md](2026-08-18-godot-debug-attach.zh.md)）。

## Consequences

- 断点需要可调试构建；导出的 release 构建可能不产生停顿。
- `--breakpoints` 值无法转义逗号（Godot 按 `,` 分割）。
- 变量渲染沿用源插件的显示精度（math 类型 `toFixed(1)`、浮点 `toFixed(5)`）；惰性对象展开（`scene:inspect_object`）与变量编辑延后，对象变量渲染为 `Object<id>`。
- harness 崩溃可能遗留自起游戏进程（subprocess seam 只在正常生命周期内清理）。

## Testing

- 66 个单元/集成测试（7 个文件），全部 keyless：codec 锚定真实 Godot 字节 fixture（`.context/t3/` 录制的 `t3-breakpoints.bin`/`t3-error.bin`/`t3-norun.bin`）、帧（短前缀安全）、控制器对回放录制的 fake game（threadId、停顿、快照、输出上限、超时、取消、销毁）、快照渲染、运行管线（版本门禁、项目/断点校验、无停顿运行、提前退出）、REAL composition（工具 → subprocess seam → fake godot 可执行 → fake game）断言模型可见输出、snapshot 与 HMR 销毁，以及真机冒烟（`GODOT_EXE` 门控）在 Godot 4.7 上命中两个断点。
