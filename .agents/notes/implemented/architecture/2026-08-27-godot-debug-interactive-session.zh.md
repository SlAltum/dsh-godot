# Agent Note：Godot 交互式调试会话（dsh-tool-godot-debug）

状态：已实现

[English](2026-08-27-godot-debug-interactive-session.md) | 中文

## 问题

`godot_debug` 是一次性脚本化运行：模型传入断点，工具跑完返回报告。没有人能在 Web 面板上直接驱动调试器——会话存活期间的暂停/继续/单步、断点管理或变量编辑都不存在（roadmap R16；与 godot-vscode-plugin DAP 工具栏的最大交互差距）。

## 决策

长驻 attach 会话放在**静态包**，由动态插件桥接到 UI：

- **架构边界（审查 H1）**：`harness.handle` 是动态插件专属原语；静态包无 client↔host RPC 通道，动态 host 沙箱不能 import 静态 codec 或自起 TCP。→ `src/session.ts`（`DebugSession` 状态机）+ `src/session-service.ts`（`ctx.provide('godot.debugSession')`）持有会话；动态 host 面注入服务并经 `harness.handle` 桥接 4 个方法（`session/start|stop|poll|command`）；服务缺失回退 in-sandbox 假会话（演示路径）。
- **轮询是唯一通道（审查 H2）**：client `ctx.remote.$on` 的键是固定白名单（无 godot 键），动态 host 无 `ctx.emit`——没有推送。`poll` 返回全量快照 + 单调 `version`（无游标：多消费者互不吞事件）；client 在 apply 层用 `ctx.interval` 轮询（client 闭包中定时器是抛错陷阱）。
- **会话语义**：每宿主进程单会话（游戏只拨一个调试器，T11.0）；`start` 绑定并立即返回 `{sessionId, connecting}`（连接窗口会话级，H6）；命令经一条串行队列（send-only 入队即完成，wait 命令独占队列）；每次停顿快照一次为 T20 `structuredDebugView`（versioned，H4）；空闲 = 仅命令（poll 不计），超时 detach 前走 T4 teardown（best-effort 断点移除 + continue）。
- **模型 + UI 并存（C4）**：`godot_debug_session` 工具（action=start/command/stop）与面板驱动同一会话；edits 复用 `applyEdits`（`Node/process_priority` 等显示名 label 预解析为原始 label——引擎静默拒绝 `Node/` 前缀写入标签，已 pin T13.0）。

## 事实（真机，Godot 4.7，`.context/t21/facts.md`，24/24 断言）

- `break` 暂停上报**空引擎栈**（T4.0 复证）——无帧/变量/树；完整快照只出现在动态断点命中时（`main.gd:25 @ _process`，变量 + 树）。
- `step`/`next` 单步**完成即再暂停**（step-into 落在 `@implicit_new`，next 前进一行）——不是"继续运行"。
- 显示名 label `Node/process_priority` 的编辑经会话成功应用（预 inspect 解析 label 路径真机验证）。
- `stop` → `detached`（reason `stop`）；游戏保持运行。

## 部署边界

本部署未挂载 tool-godot-debug（host Service 目录无 `godot.debugSession`；profile bundles 仅 `dsh-base`+`dsh-web-app`）。真实服务由 tsc 预编译探针直跑 `createDebugSessionService` 对真实游戏验证（`.context/t21/run-t21.mjs`）；UI real 路由（pkg-18 `real: true`）待有该包挂载的部署——与 T20 记录的边界相同。会话内遗留的 `godot_debug_session` 演示工具（假会话）是无关的会话级状态。

## 测试

- 单测 17/17（scripted-game fixture）：全停顿/continue/step/next、断点增删、edits 失败路径（成功路径留给真机）、断开、超时、stop teardown、EADDRINUSE、单会话、端口校验、unknown/busy、output-error 尾部、场景树平铺格式；全包 212 绿；tsc 0。
- 真机：探针序列 start→running→pause→step→next→breakpoint→continue（命中）→edits（ok）→stop→detached，游戏保持运行。

## 后果

- 模型与 Web 面板都能驱动一个活动 attach 会话（暂停/继续/单步/next、断点、暂停态编辑）；快照视图与一次性卡片一致。
- 遗留：T21.8 launch 模式会话（spawn + 版本门槛 + terminate）后补；`step_out` 不提供（协议无独立命令；源插件以 next+flag 模拟）。
