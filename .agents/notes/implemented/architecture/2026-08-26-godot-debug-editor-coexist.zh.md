# Agent Note：Godot 调试 attach 与编辑器调试器共存（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-26-godot-debug-editor-coexist.md) | 中文

## Problem

Phase 4 遗留 Known Limitation：「Godot 编辑器已连接时第二客户端」未测（需要编辑器在跑，成本高）。共存问题——`godot_debug` attach 能否与编辑器调试器共享同一游戏——没有记录在案的答案。源插件只在启动示例中记录了编辑器默认调试端口（`"port": 6007`），无显式共存处理——行为是引擎侧语义，必须实测。

## Decision

用真实 Godot 4.7 编辑器（headless）与真实 attach 流程并跑的探针 pin 行为（`.context/t11/facts.md`），然后更新文档。产品代码零改动（用户裁定：纯验证 + 文档；EADDRINUSE 消息建议改为记入遗留）：

- **空闲编辑器不绑定任何调试端口。** 完全初始化的 headless 编辑器持有零个监听 socket（netstat）；外部启动的游戏以 `--remote-debug tcp://127.0.0.1:6007` 拨号会打印一次 `Remote Debugger: Unable to connect. Status: 1.` 并照常运行（不重试，T4.0 事实 11）。编辑器只对它自己启动（F5）的游戏充当调试服务器（携带其自身调试参数）。
- **一个游戏一个调试器。** 游戏的 remote-debug 客户端只拨一个目标：传两个 `--remote-debug` 参数时**最后一个生效**（实测：DSH 侧收到 `set_pid`）；已在拨号其他目标的游戏永不连入 attach 端口——attach 以既有启动顺序指引超时。编辑器运行时 attach 双向完全不受影响（完整停顿循环 + detach 可用；编辑器进程无感知地继续运行）。
- **文档更新**（`one debugger per game` Known Limitation + attach 用法说明）：指向编辑器默认端口的游戏拨号失败（无人服务），只有编辑器自启（F5）的游戏由编辑器调试，而这些游戏无法 attach。

## Protocol facts（Godot 4.7 实测，`.context/t11/facts.md`）

- 空闲 headless 编辑器：完全初始化（`[ DONE ] loading_editor_layout`）后 0 个监听 TCP socket；6007 可被任何人绑定。
- 编辑器运行时游戏 → 6007：stderr `ERROR: Remote Debugger: Unable to connect. Status: 1.`（`_try_connect (core/debugger/remote_debugger_peer.cpp:190)`），打印一次；游戏继续运行与 tick。
- 双 `--remote-debug` 参数（`tcp://…6007` 在前、`tcp://…<dsh>` 在后）：游戏连接**最后一个参数**的目标（`set_pid` 到达 DSH 侧；6007 无连接）。
- attach 超时表面（出货工具）：`GODOT_UNAVAILABLE`，消息 `godot_debug: game did not connect to tcp://127.0.0.1:<port> within <ms>ms. Start the game with --remote-debug tcp://127.0.0.1:<port> AFTER this call — Godot does not retry a failed connection (pinned, T4.0).`
- 端口冲突表面（出货工具）：`GODOT_UNAVAILABLE`，消息 `godot_debug: could not bind port <port>: listen EADDRINUSE: address already in use 127.0.0.1:<port>`——不含占用方提示（建议已记录，未实现）。
- 连接调试器期间游戏窗口标题上报 `(DEBUG)`（副产品观察，无行为影响）。

## Source-plugin alignment 与差异

源插件没有可移植的共存处理（其 attach/launch 流程已在 Phase 4 对齐）。复确认一处差异：源插件启动示例建议 `"port": 6007`（编辑器默认端口），本工具 attach 模式刻意不默认该端口（必须显式端口——Phase 4 决策 D2），因此与空闲编辑器意外冲突不可能发生（它本来什么都不持有）。

## Testing

- 探针 `.context/t11/run-t11.mjs`（node；工具链经 tsc 预编译至 `tool-godot-debug/.build-t11`——tsx/esbuild 在 harness 沙箱下无法 spawn 服务进程（EPERM）；tsconfig 见 `.context/t11/tsconfig.json`），场景：S0 编辑器空闲（初始化、socket 扫描、游戏拨 6007）、S1 编辑器运行时 raw attach（break + 动态断点双停、快照、detach、游戏继续跑、编辑器存活）、S1b 编辑器运行时出货工具 attach（`detached: true`、3 stops）、S2 游戏拨 6007 + 工具 attach 超时（消息断言）、S2b DSH 先 bind + 游戏指向编辑器端口（无连接）、S3 EADDRINUSE 表面（工具 attach 到被持有端口）、S4 双 `--remote-debug`（末次生效）。
- 证据：`out/<scenario>/summary.json`、`events.json`、netstat 快照、stdout/stderr；事实表 `.context/t11/facts.md`。
- README 双语对（EN/ZH）经 `.context/verify-pairing.mjs` 复验（结构 + md-wrap；hash 已重录进 `README.i18n.yaml`）。

## Consequences

- Phase 4 Known Limitation 以记录在案的事实闭环：空闲编辑器永远不可能成为「第二客户端」（它不绑定任何端口）；编辑器调试的游戏只能是 F5 自启，无法 attach（每游戏一个调试目标，双 `--remote-debug` 末次生效）。
- attach 指引不变（游戏须在工具调用之后启动）——共存场景下模型看到的超时消息现已逐字 pin 定。
- 遗留：EADDRINUSE 消息可提示可能的占用方（编辑器调试会话、另一个 attach）；用户裁定延后。
