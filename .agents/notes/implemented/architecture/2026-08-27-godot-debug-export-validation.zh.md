# Agent Note：Godot 导出构建断点验证（dsh-tool-godot-debug）

状态：已实现

[English](2026-08-27-godot-debug-export-validation.md) | 中文

## 问题

README 的 Known Limitations 声称导出的 release 构建「可能不产生停顿」——一句未经实测、听似概率性的表述。该任务（roadmap R7/T12）在 2026-08 因本机无导出模板而搁置；随后用户改变裁定，要求用本机现有条件做自动化验证。

## 决策

先做参照核对：godot-vscode-plugin **没有导出游戏专属代码**——导出游戏调试与 attach 完全同形态（游戏带 `--remote-debug` 拨号，断点走远程协议）。所以 T12 验证的是 **Godot 模板行为**，而非插件代码。本机装有 4.5.1.mono 导出模板（无 4.7——模板行为是构建期特性，4.x 全系稳定，事实可外推）。探针（`.context/t12/run-t12.mjs`）用两个模板导出 t3 项目副本（headless `--export-debug`/`--export-release`，Windows Desktop 预设，embed_pck），再以标准协议 attach 每个导出游戏：bind → 游戏带 `--remote-debug` 启动 → set_pid → 动态断点 → 期待 debug_enter。

## 事实（Godot 4.5.1 mono，`.context/t12/facts.md`）

- **debug 模板：完整远程调试器**——导出游戏拨号、应答 set_pid，动态断点命中（`res://player.gd:10 @ run`；栈格式与 4.7 一致）。
- **release 模板：仅连接层**——游戏**照常拨号并应答 set_pid**（约 1.1s），但 breakpoint 命令永不触发停顿（8s 窗口 + 自然退出全程无停顿；其后只有 output/error/performance 心跳）。GDScript 断点引擎被编译排除，连接栈幸存。确定性行为，非概率性。
- **console wrapper 仅 debug 模板生成**——`debug/export_console_wrapper` 只为 debug 模板产出 `<name>.console.exe`；release exe 是 GUI 子系统（stdout/stderr 不可捕获）。导出过程本身需要真实 APPDATA（重定向的 APPDATA 找不到模板）。
- **基线**：两个导出包均可正常运行（退出码 0；debug console exe 打印完整游戏输出）。

## 后果

- README Known Limitation 已重写：debug 模板导出保留断点；release 模板导出确定不命中（仅连接层），附 facts 文件 pin。用户原有的自打包验证路径仍可作为补充（debug 模板 + `--remote-debug`）。
- 遗留：4.7 模板未下载（外推依据是模板行为稳定性）；导出游戏的 CLI `--breakpoints` 形态未测（动态断点 attach 形态是本产品推荐的导出游戏调试路径）。
