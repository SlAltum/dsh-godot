# Agent Note：Godot 调试多线程 threadId 语义（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-25-godot-debug-threads.md) | 中文

## Problem

所有协议消息与命令都携带 threadId 字段，但实现只捕获 `set_pid` 的值并对每条命令原样回发——对单线程游戏完全正确，对多线程游戏完全错误。源插件从未实现真实多线程（`threadsRequest` 返回伪造的单线程，debug_session.ts L190-193），无可参考实现。

## Decision

用多线程探针项目 pin 真实协议行为后修复（不新增包；协议事实已 pin 在 `.context/t10/facts.md`）：

- **线程可区分**：`debug_enter` 的消息级 threadId 等于其 `params[3]`，两者都标识**暂停线程**（主线程 1 / 探针中 worker 46）。错误暂停同样区分线程。
- **threadId 字段选择命令作用线程**：用暂停线程 id 发 `get_stack_dump`/`continue` 有效（worker 栈在 `_worker_loop`、随后 `debug_exit`）；用 `set_pid` id 发则以**静默**应答——修复前的实现取不到 worker 停顿的栈、也无法继续。
- **修复**：`DebugController.waitForStop` 现把暂停线程 id（`msg[1]`）捕获进 `pausedThreadId` 状态；`send` 在暂停激活期用暂停 id，首个停顿前回退 `set_pid` id。`StopInfo` 新增 `threadId`；`DebugStop` 透传；报告把子线程停顿标注为 `[reason @ thread N]`（线程 1 = 主线程不标注）；card meta 与 schema 每停顿携带 `threadId`。
- 任意线程暂停时游戏整体暂停（实测观察），但命令响应归属发送时用的 threadId——用暂停 id 永远正确。

## Protocol facts（Godot 4.7 实测，`.context/t10/facts.md`）

- `debug_enter` 的 msg[1] === params[3] === 暂停线程 id（主 1 / worker 46）；`set_pid` 的 threadId 是主线程 id。
- 命令用错误 threadId → 静默（非错误消息）——修复前 worker 停顿表现为快照超时 / `varsTruncated`，而非明确失败。
- `stack_dump` 响应携带请求时用的 threadId（归属判定确定）。
- worker 线程错误暂停（`Division by zero`）携带 worker id；`params[3]` 稳定（不同于 T5.0 记录为不稳定的 `params[2]`，后者仍无语义）。
- 单线程场景不变（threadId 恒 1——零回归）。

## Source-plugin alignment 与差异

不移植源插件的伪造单线程 `threadsRequest`（我们不暴露 DAP 线程）；改用协议真实的逐暂停 threadId。其余（停顿循环、快照、展开、编辑、场景树）全部不变。

## Testing

- controller.spec：t3 单线程 fixture 上 `waitForStop` 返回 `threadId: 1`（断言已更新）。
- tool.spec：worker fixture（`t10-worker.bin`，真实录制：debug_enter 46 → 栈 `res://main.gd:18 @ _worker_loop` → vars）——修复路径取到 worker 栈；主线程 fixture 断言处处 `threadId === 1`。
- REAL-composition：worker 停顿渲染 `[Breakpoint @ thread 46]`；card meta 携带 `threadId: 46`。
- 真机冒烟：t10 项目 worker 断点真实命中，`threadId !== 1`、帧在 worker 循环行。
- 全套全绿（147 测试含冒烟）；单线程快照不变。

## Consequences

- 多线程游戏现在能正确调试：worker 停顿可取其栈/变量/场景树并继续——此前静默产生空快照。
- 报告告知模型哪个线程暂停（仅非主线程标注，单线程输出完全一致）。
- 协议不暴露按线程过滤断点（文档化 Known Limitation）；`--single-threaded-scene` 仍是源插件 argv 的部署选项（未移植）。
