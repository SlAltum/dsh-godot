# Agent Note：Godot 调试 attach 模式 + 动态断点（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-18-godot-debug-attach.md) | 中文

## Problem

v1 的 `godot_debug` 工具（见 [2026-08-17-godot-debug-tool.md](2026-08-17-godot-debug-tool.zh.md)）仅支持 launch：harness spawn 游戏并拥有进程，CLI `--breakpoints` 是唯一断点来源，工具在 teardown 时杀死游戏。调试用户已启动的游戏——或连接后设置断点——完全不可行，源插件的 attach 能力因此无法触达。

## Decision

在现有工具上增加 attach 模式与动态断点（不新增包、不动协议层——`DebugController` 本就是 TCP server 侧）：

- `mode: 'attach'`（工具参数；默认 `'launch'`）：工具绑定**显式**端口（参数 `port` 或配置 `debugPort`；0/缺省 → `GODOT_PARSE_ERROR` 附启动指引——原子调用内自动端口无意义）并等待调用方启动的游戏连入。不 spawn、无 `--version` 门槛（不拥有二进制；游戏需 4.2+ 以提供 threadId 协议字段，文档化）、不 kill。
- 动态断点：`set_pid` 后发送 `breakpoint [res://path, line, true]`；是 attach 的**唯一**断点来源（CLI `--breakpoints` 仅 launch）。可选 `pauseOnAttach` 发一次 `break`，获得即时的「游戏此刻在做什么」探测停顿。
- detach 收尾（try/finally，覆盖取消等所有路径）：每个已发送断点 best-effort `breakpoint [path, line, false]` → best-effort `continue` → `controller.dispose()`。结果携带 `detached: true`，无 `exit`（游戏非本工具所有）。
- 分叉点在项目校验 / 断点 `res://` 转换之后、**`resolveExecutable` 之前**——attach 从不触碰 godot 二进制或 subprocess seam（测试中断言 `subprocess.spawns` 为空）。
- attach 拒绝 `scene`/`args`（`GODOT_PARSE_ERROR`），`pauseOnAttach` 在 attach 之外同样拒绝。`EADDRINUSE`/listen 错误仅在 attach 分支内映射为 `GODOT_UNAVAILABLE`（launch 错误表面不变）。

## Protocol facts（Godot 4.7 实测，`.context/t4/facts.md`）

- 连接时已暂停的游戏（脚本错误停顿、未 import 的 Parser Error）会在 `set_pid` 后**补发 `debug_enter`**——无需额外的「探测已暂停态」命令；controller 的历史消费机制天然处理。
- `break` 暂停的 `debug_enter [true, "", true, 1]`：`isUserBreakpoint=true`、reason 为**空字符串**（渲染为 `[break]`）、堆栈转储为空（引擎栈，`N=0`）——渲染层已有防御（空帧列表）；完整 scopes 改在首个有帧的停顿渲染。
- 暂停态 detach：游戏**自动恢复运行**（断开从不使其保持暂停）。无调试器时残留动态断点被**忽略**（游戏继续运行）。两者使 teardown 的 continue/断点移除成为防御性动作而非必需。
- **Godot 不重试失败的调试器连接**：端口监听前启动的游戏永远不会连上。因此 attach 指引明确：游戏必须在工具调用之后启动，参数 `--remote-debug tcp://127.0.0.1:<port>`。
- detach 后的游戏不会对同端口第二次 attach 重连（一次运行一次连接）。

## Source-plugin alignment

设计与源插件成熟实现逐项对齐验证（`godot-vscode-plugin/src/debugger/godot4/server_controller.ts`）：attach = `server.listen(port)`，无 spawn/版本校验/kill（L360-393）；attach 下 socket close 不 abort 控制器（L368-378）；`terminateRequest` 只停 launch 模式（debug_session.ts L181-188）；`breakpoint [path, line, true|false]` 与 `break` 命令形态一致（L93-121）；空栈转储是普通停顿（L724-728）。差异均为 DSH 特有：一次性调用语义（dispose vs 保留会话）与防御性 detach 清理。

## Testing

- 11 个新单元/集成测试（tool.spec.ts attach 套件：fixture 全流程回放断言 `detached`、无 spawn 断言、缺端口/scene/args/pauseOnAttach 校验、连接超时指引、端口占用、abort+dispose；toResPath 加固：跨盘符路径与反斜杠逃逸）+ REAL-composition attach 测试及其 snapshot + 真机冒烟（GODOT_EXE opt-in）：attach、命中动态断点并验证 detach 后游戏存活。
- keyless 回放 fixture `t4-attach.bin`/`t4-attach.json`（19 帧 2316 字节）由真机录制经 `.context/t4/gen-fixture.mjs` 生成；`break` 触发的 `debug_enter` 标记 `trigger: "break"`，FakeGame 收到 `break` 命令时回放。
- launch 回归：Phase 4 前的全套测试原样通过（66 tests），外加 T3.0 真机冒烟。

## Alternatives considered

- **有状态会话工具 / 交互式断点**——与工具族一次性原则冲突；动态断点 + `pauseOnAttach` 一次调用覆盖模型可见需求。
- **自动端口 + 错误里报告端口**——原子调用无法及时把端口交给用户；显式端口 + 文档化启动顺序才是可用契约。
- **TCP 活性探测检测工具监听**（测试期想法）——controller 把「接受后即丢弃」的探测连接视为游戏断开并中止运行；冒烟测试改为调用后固定等待（bind 同步级快）。
- **移除 detach 的 best-effort continue/断点移除**——已 pin 事实表明没有它们 detach 也无害，但保留作为引擎版本差异的低成本保险。

## Consequences

- `DebugRunResult` 新增 `detached: boolean`（launch 恒 `false`）；`execute()` 在两个分支都归一化（attach 恒走 null-exit 分支）。
- 渲染：空 reason 标记 `[break]`；完整 scopes 在首个有帧的停顿渲染；attach 结果末尾附 `attached; game left running (not owned by the tool)`。
- `toResPath` 加固：跨盘符绝对路径（Windows `path.relative` 对异盘返回绝对路径——此前是静默永不命中的断点）与反斜杠 `res://` 逃逸（均为预存缺陷，两模式同时修复）。
- attach 部署完全不需要 godot 二进制（对齐 lsp-godot 的 attach-only 路径）。
- README 已知限制更新：attach 启动顺序（Godot 不重试）、attach 命中语义（不回退）、项目一致假设（调试协议无工作区握手）、harness 崩溃在 attach 下 = 无害 detach。
