# Agent Note：lsp-godot spawn 失败退避（dsh-lsp-godot）

Status: implemented

[English](2026-08-27-godot-lsp-spawn-cooldown.md) | 中文

## 问题

坏项目/环境可能导致 Godot LSP 完全无法启动（项目有错误时服务器不初始化——godotengine/godot#103313）。spawn 模式每次查询都会冷启动一个 headless 编辑器并烧掉 60s 工具预算，且无退避。

## 决策

新增按工作区的 spawn 重试冷却（`spawnRetryCooldownMs`，默认 60s，`0` = 禁用）：spawn 失败后同一工作区以 `LSP_UNAVAILABLE` 快速失败（附重试提示）而非重新 spawn；一次**成功**的 spawn 清除冷却。实现为 `createConnectDeps`（index.ts）中 `spawnEditor` 的包装层，按 `workspace.canonicalPath` 键控——attach-only 模式不进包装（缺编辑器不冷却）；auto 模式的 attach 失败回退路径经同一 spawnEditor，天然覆盖。

## 备注

- T17-B（completion LSP 操作）被**用户否决**：需扩展共享 lsp seam（lsp/lsp-stdio/tool-lsp 的封闭 `LspOperation`/`LspQueryResult` 联合），违反 D3 无 blast-radius 决策——全部跨包改动已 git checkout 回滚；该方向搁置，留待拥有 seam 变更权的独立项目。

## 测试

- 新增 e2e（real-composition.spec.ts）：失败武装冷却 → 第二次调用以 `LSP_UNAVAILABLE` 快速失败且零 spawn → 冷却过期后重试成功并清除 → 下一次调用再次 spawn。失败注入用「立即退出的编辑器 + 未监听端口」（端口可应答时就绪探测会赢过退出检测——测试 server 端口会破坏注入）。
- lsp-godot 125 测试全绿；lint/tsc 干净；README 三件套 + config-catalog 重跑（zh 镜像顺带补上历史缺失的 tool-godot-debug config 字段）。
