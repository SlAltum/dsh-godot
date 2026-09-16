# dsh-godot —— DeepSeek Harness 的 Godot 能力族

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 智能体框架的 Godot Engine 插件族：无头项目工具、GDScript 语义导航、脚本化调试器。作为独立仓库维护；各包在 harness monorepo workspace 内构建。

## 特性

| 包 | 角色 | DSH 接缝 |
|---|---|---|
| `tool-godot/` | 无头 CLI 工具：`godot_validate`、`godot_run_scene`、`godot_format`、`godot_inspect`、`godot_editor_script` | `ctx.tools` |
| `lsp-godot/` | GDScript 导航（`goToDefinition` / `findReferences` / `hover`），经由 Godot 内置 TCP 语言服务器，attach 或 spawn | `ctx.lsp` |
| `tool-godot-debug/` | `godot_debug`：一次有界的脚本化调试运行——断点、无头启动、逐步栈 / 变量快照、结构化报告 | `ctx.tools` |
| `ui-godot/` | `godot` 命名空间的 Web 设置卡（持久客户端包，`dsh.client` 行） | 浏览器 slots |

本仓库的能力从 **godot-vscode-plugin**（Godot Tools v2.7.1，约 70 万安装量）迁移而来，保留纯逻辑核心；迁移由针对真实 Godot 4.7 实例记录的协议事实钉住。模块地图与协议事实指引见 [docs/architecture.md](docs/architecture.md)。

## 前置条件

- **Godot 4.2+。** CLI 工具与调试器需要支持 `--headless` 的 Godot 4.2 或更新构建（spawn 模式 LSP 的版本门槛同时接受 3.6+）。
- **宿主二进制在调用时解析。** godot（以及默认 `godot_format` 后端的 gdformat）为宿主安装，绝不随包分发；可执行文件缺失以结构化的 `GODOT_UNAVAILABLE` 错误在调用时暴露，绝不在加载时失败。
- **项目需先导入一次。** 无头游戏模式不会自动导入；每个项目先运行一次 `godot --headless --editor --path <root> --import --quit`，否则首次运行会更慢。
- **游戏用户数据目录必须可写。** 游戏的 `user://` 目录必须可写；否则游戏模式以 signal 11 崩溃。

## 安装

与其他 harness 插件一样挂载——在 `cordis.yml` 组合中加一行，或进程内 `ctx.plugin()`：

```ts
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'
import * as GodotLsp from '@deepseek-ai/dsh-lsp-godot'
import * as ToolGodotDebug from '@deepseek-ai/dsh-tool-godot-debug'

// A deployment points at its godot install; the default resolves `godot` on PATH.
export async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodot, { executable: 'C:\\Godot\\godot.exe' })
  await ctx.plugin(GodotLsp, { connectMode: 'spawn', spawnExecutable: 'C:\\Godot\\godot.exe' })
  await ctx.plugin(ToolGodotDebug, { executable: 'C:\\Godot\\godot.exe' })
}
```

## 配置

每个键都有默认值；各包细节见各包 README。

| 包 | 重要配置 | 值得注意的默认值 |
|---|---|---|
| `tool-godot` | `executable`、`gdformatExecutable`、`formatBackend: 'gdformat' \| 'builtin'`、`timeoutMs` | `executable: godot`；`timeoutMs: 60000` |
| `lsp-godot` | `connectMode: attach \| spawn \| auto`、`ports`、`spawnExecutable`、`spawnPort`、`spawnReadyTimeoutMs` | `connectMode: auto`；`ports: [6005]` |
| `tool-godot-debug` | `executable`、`debugPort`（0 = 自动选取）、`connectWaitMs`、`idleTimeoutMs`、`maxOutputBytes` | `debugPort: 0`；`connectWaitMs: 20000`；单次调用 `maxStops` 上限 50 |

## 面向模型的工具

| 工具 | 包 | 用途 |
|---|---|---|
| `godot_validate` | tool-godot | 经无头编辑器做项目 / 脚本校验（结构化问题）。 |
| `godot_run_scene` | tool-godot | 无头运行场景并捕获输出。 |
| `godot_format` | tool-godot | 格式化 `.gd` 文件（gdformat 或内置后端）；只读，返回文本。 |
| `godot_inspect` | tool-godot | 纯解析 `project.godot` / `.tscn` / `.tres` 结构。 |
| `godot_editor_script` | tool-godot | 在无头编辑器中运行 `res://` EditorScript。 |
| `lsp` | (tool-lsp) | `.gd` 导航：`goToDefinition` / `findReferences` / `hover`，经由 Godot provider。 |
| `godot_debug` | tool-godot-debug | 一次脚本化调试运行：断点、无头启动、逐步快照、自动继续、结构化报告。 |

## 工作原理

- **LSP。** Godot 自带 TCP 语言服务器（EditorSettings `network/language_server/remote_port`，默认 6005）。`lsp-godot` 可 attach 到运行中的编辑器，或 spawn 无头编辑器（`--lsp-port`），并按 workspace 池化 provider；`.gd` 查询（`goToDefinition` / `findReferences` / `hover`）经由 harness 的 `ctx.lsp` 接缝提供。
- **调试器。** Godot 远程调试器经 `--remote-debug` 使用自定义二进制协议——而非 DAP。帧为 `[u32 LE 长度][variant 编码数组]`，内容 `[command, threadId, params]`（Godot 4.2+）。`godot_debug` 绑定预选空闲端口，无头启动游戏，在每个停止点快照栈与 locals/members/globals 后自动继续，直至 `maxStops`。
- **范围。** `godot_debug` v1 是只启动的脚本化运行，拥有自己的游戏进程；attach 调试与有状态会话属于后续工作。

## 部署注意事项

- spawn 模式会写入 `.godot/` 导入产物；大型项目冷启动可能超出 60 秒工具预算（调高 `timeoutMs` / `spawnReadyTimeoutMs`）。
- attach 模式要求匹配的项目在运行中的 Godot 编辑器里打开（LSP：编辑器的语言服务器在 `127.0.0.1:6005`）。
- `godot_debug` 在所有路径上都会终止自己的游戏进程；harness 崩溃时仍可能遗留孤儿进程。

## 从源码构建

- 各包依赖 `@deepseek-ai/dsh-*` workspace 包，并针对 harness monorepo workspace 构建与测试（Node.js ^22.19 或 >= 24，pnpm）。
- 完全独立构建时，将这些依赖切换到已发布的 npm 版本（所需包均已在 npm 公开），并自备测试 / lint / tsconfig 配置。

## 仓库结构

- `tool-godot/`、`lsp-godot/`、`tool-godot-debug/`、`ui-godot/` —— 上述四个包（模块地图见 [architecture](docs/architecture.md)）。
- `docs/` —— 架构文档。

## 测试

在以下环境验证：

- **操作系统**：Windows 11（build 26200）
- **Shell**：PowerShell 7（7.6.3）
- **Godot**：4.7 stable（console 构建）
- **Node.js**：24（v24.19.0）
- **DSH**：0.1.0-rc.5（harness monorepo workspace）

在 monorepo 根目录运行单元套件：`pnpm exec vitest run packages/godot/lsp-godot packages/godot/tool-godot-debug`。真实 Godot 集成套件（如调试器冒烟）经 `GODOT_EXE` 环境变量按需启用。

## 已知限制与后续工作

- attach 调试、动态断点、场景树快照、多线程停止、惰性对象展开、变量编辑属于后续工作（钉住的协议事实为这些路径留有余地）。
- 内置格式化器的空白规则跟随 godot-vscode-plugin，而非 gdformat。
- `godot_format` 按设计只读；模型经由文件策略面应用改动。
- 断点需要支持调试的二进制；导出的 release 构建可能不会触发停止。
- harness 崩溃时可能遗留孤立的 godot 进程。
- 变量渲染遵循源插件的显示精度（数学类型 `toFixed(1)`，浮点 `toFixed(5)`）。

## 许可证

基于 MIT 许可证发布。完整文本见 [LICENSE](LICENSE)。
