---
description: "Godot 包组：无头项目工具、GDScript LSP 提供方、脚本化调试器、可视化沙盒与浏览器界面，以单个可选 bundle 交付。"
kind: "package-group"
---

# dsh-godot —— DeepSeek Harness 的 Godot 能力族

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 智能体框架的 Godot Engine 插件族：无头项目工具、GDScript 语义导航、脚本化调试器、运行中游戏的可视化沙盒。作为独立仓库维护；各包在 harness monorepo workspace 内构建。

## 概述

把智能体指向一个 Godot 工程，它就能校验脚本、无头运行场景、格式化 GDScript、检查工程文件、执行一次脚本化调试，并驱动一个它能看见的运行中游戏。整个系列由一个可选 bundle 安装；`dsh-base` 与 `dsh-web-app` 不含任何 Godot 行，因此不使用 Godot 的工程不承担任何开销。各包各自声明宿主要求——Godot 4.2+ 可执行文件，以及可选的 gdformat——缺少可执行文件在调用时报告，而非加载时。

## 目录

- [特性](#features)
- [前置条件](#prerequisites)
- [安装](#installation)
- [配置](#configuration)
- [面向模型的工具](#model-facing-tools)
- [工作原理](#how-it-works)
- [部署注意事项](#deployment-notes)
- [从源码构建](#building-from-source)
- [仓库结构](#repository-layout)
- [测试](#testing)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [许可证](#license)
- [开发备注](#dev-note)

<a id="features"></a>
## 特性

| 包 | 角色 | DSH 接缝 |
|---|---|---|
| `bundle-godot/` | **可选能力 bundle**：一次安装下面五个包；Godot 不在 `dsh-base` / `dsh-web-app` 里 | `dsh.bundle.patch` |
| `tool-godot/` | 无头 CLI 工具：`godot_validate`、`godot_run_scene`、`godot_format`、`godot_inspect`、`godot_editor_script` | `ctx.tools` |
| `lsp-godot/` | GDScript 导航（`goToDefinition` / `findReferences` / `hover`），通过 Godot 内置 TCP 语言服务器，attach 或 spawn | `ctx.lsp` |
| `tool-godot-debug/` | `godot_debug`：一次有界的脚本化调试运行——断点、无头启动、逐步栈 / 变量快照、结构化报告 | `ctx.tools` |
| `tool-godot-ego/` | 可视化沙盒：持续运行的游戏可观察、读取与操作（`godot_play` 等 21 个工具） | `ctx.tools` |
| `ui-godot/` | `godot` 命名空间的 Web 设置卡与沙盒观察窗（悬浮球、实时画面、点击操作） | 浏览器 slots |

本仓库的能力从 **godot-vscode-plugin**（Godot Tools v2.7.1，约 70 万安装量）迁移而来，保留纯逻辑核心；针对真实 Godot 4.7 实例记录的协议事实锁定了这些行为。模块地图与协议事实指引见 [docs/architecture.md](docs/architecture.md)。

<a id="prerequisites"></a>
## 前置条件

- **Godot 4.2+。** CLI 工具与调试器需要支持 `--headless` 的 Godot 4.2 或更新构建（spawn 模式 LSP 的版本门槛同时接受 3.6+）。
- **宿主二进制在调用时解析。** godot（以及默认 `godot_format` 后端的 gdformat）为宿主安装，绝不随包分发；可执行文件缺失时，调用会返回结构化错误，不会在加载时失败。
- **项目需先导入一次。** 无头游戏模式不会自动导入；每个项目先运行一次 `godot --headless --editor --path <root> --import --quit`，否则首次运行会更慢。
- **游戏用户数据目录必须可写。** 游戏的 `user://` 目录必须可写；否则游戏模式以 signal 11 崩溃。

<a id="installation"></a>
## 安装

Godot 是**可选能力**：`dsh-base` 与 `dsh-web-app` 都不挂载这些包。推荐用能力 bundle，一次插入五个行，并在插件页的**已安装插件**下出现：

```bash
dsh plugin install link:D:/source_code/deepseek-harness/packages/godot/bundle-godot
```

安装后重启 `dsh web`。bundle 页面带 `tool-godot` 设置表单，各行保留“配置”一节的默认值。只需要部分行的 profile 可以改为逐包插入，跳过 bundle。

进程内或手写组合时，直接挂载各行：

```ts
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'
import * as GodotLsp from '@deepseek-ai/dsh-lsp-godot'
import * as ToolGodotDebug from '@deepseek-ai/dsh-tool-godot-debug'
import * as ToolGodotEgo from '@deepseek-ai/dsh-tool-godot-ego'

// A deployment points at its godot install; the default resolves `godot` on PATH.
export async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodot, { executable: 'C:\\Godot\\godot.exe' })
  await ctx.plugin(GodotLsp, { connectMode: 'spawn', spawnExecutable: 'C:\\Godot\\godot.exe' })
  await ctx.plugin(ToolGodotDebug, { executable: 'C:\\Godot\\godot.exe' })
  await ctx.plugin(ToolGodotEgo, { executable: 'C:\\Godot\\godot.exe' })
}
```

<a id="configuration"></a>
## 配置

每个键都有默认值；配置细节见各包 README。

| 包 | 重要配置 | 值得注意的默认值 |
|---|---|---|
| `tool-godot` | `executable`、`gdformatExecutable`、`formatBackend: 'gdformat' \| 'builtin'`、`timeoutMs` | `executable: godot`；`timeoutMs: 60000` |
| `lsp-godot` | `connectMode: attach \| spawn \| auto`、`ports`、`spawnExecutable`、`spawnPort`、`spawnReadyTimeoutMs` | `connectMode: auto`；`ports: [6005]` |
| `tool-godot-debug` | `executable`、`debugPort`（0 = 自动选取）、`connectWaitMs`、`idleTimeoutMs`、`maxOutputBytes` | `debugPort: 0`；`connectWaitMs: 20000`；单次调用 `maxStops` 上限 50 |
| `tool-godot-ego` | `executable`、`allowEval`、`offscreen`、`maxFps` / `fixedFps`、`maxWidth`、`maxNodes`、`maxProps`、`requestTimeoutMs`、`graceMs` | `allowEval: false`；`maxFps: 60`；`maxWidth: 1280`；`requestTimeoutMs: 20000` |

<a id="model-facing-tools"></a>
## 面向模型的工具

| 工具 | 包 | 用途 |
|---|---|---|
| `godot_validate` | tool-godot | 通过无头编辑器校验项目与脚本（结构化问题）。 |
| `godot_run_scene` | tool-godot | 无头运行场景并捕获输出。 |
| `godot_format` | tool-godot | 格式化 `.gd` 文件（gdformat 或内置后端）；只读，返回文本。 |
| `godot_inspect` | tool-godot | 纯解析 `project.godot` / `.tscn` / `.tres` 结构。 |
| `godot_editor_script` | tool-godot | 在无头编辑器中运行 `res://` EditorScript。 |
| `lsp` | (tool-lsp) | `.gd` 导航：`goToDefinition` / `findReferences` / `hover`，通过 Godot provider。 |
| `godot_debug` | tool-godot-debug | 一次脚本化调试运行：断点、无头启动、逐步快照、自动继续、结构化报告。 |
| `godot_play` / `godot_stop` / `godot_scene` / `godot_status` | tool-godot-ego | 启动、停止、报告或切换场景，并查看沙盒会话（共 21 个工具）。 |
| `godot_see` / `godot_state` / `godot_node` / `godot_find` / `godot_diff` / `godot_logs` / `godot_actions` | tool-godot-ego | 查看画面、读取场景树与可点击控件、读取属性、测量画面变化、读取日志、列出 InputMap 动作。 |
| `godot_click` / `godot_key` / `godot_type` / `godot_fill` / `godot_check` / `godot_hover` / `godot_drag` / `godot_scroll` / `godot_wait` / `godot_wait_for` | tool-godot-ego | 操作运行中的游戏（含填写输入框与切换控件状态），等待若干帧或某个值条件。 |

<a id="how-it-works"></a>
## 工作原理

- **LSP。** Godot 自带 TCP 语言服务器（EditorSettings `network/language_server/remote_port`，默认 6005）。`lsp-godot` 可 attach 到运行中的编辑器，或 spawn 无头编辑器（`--lsp-port`），并按 workspace 池化 provider；`.gd` 查询（`goToDefinition` / `findReferences` / `hover`）通过 harness 的 `ctx.lsp` 接缝提供。
- **调试器。** Godot 远程调试器经 `--remote-debug` 使用自定义二进制协议——而非 DAP。帧为 `[u32 LE 长度][variant 编码数组]`，内容 `[command, threadId, params]`（Godot 4.2+）。`godot_debug` 绑定预选空闲端口，无头启动游戏，在每个停止点快照栈与 locals/members/globals 后自动继续，直至 `maxStops`。
- **可视化沙盒。** 临时 `SceneTree` 替换项目主循环，并从项目外加载桥接节点，因此工具从不改写 `project.godot`。桥接在回环上应答换行分隔 JSON（端口与口令走环境变量），画面只在内存中取帧，输入通过 `Viewport.push_input` 注入。游戏在两次调用之间持续运行；`godot_see` 把一帧送进对话。
- **范围。** `godot_debug` v1 是只启动的脚本化运行，拥有自己的游戏进程；attach 调试与有状态会话属于后续工作。

<a id="deployment-notes"></a>
## 部署注意事项

- spawn 模式会写入 `.godot/` 导入产物；大型项目冷启动可能超出 60 秒工具预算（调高 `timeoutMs` / `spawnReadyTimeoutMs`）。
- attach 模式要求匹配的项目在运行中的 Godot 编辑器里打开（LSP：编辑器的语言服务器在 `127.0.0.1:6005`）。
- `godot_debug` 在所有路径上都会终止自己的游戏进程；harness 崩溃时仍可能遗留孤儿进程。

<a id="building-from-source"></a>
## 从源码构建

- 各包依赖 `@deepseek-ai/dsh-*` workspace 包，并针对 harness monorepo workspace 构建与测试（Node.js ^22.19 或 >= 24，pnpm）。
- 完全独立构建时，将这些依赖切换到已发布的 npm 版本（所需包均已在 npm 公开），并自备测试 / lint / tsconfig 配置。

<a id="repository-layout"></a>
## 仓库结构

- `bundle-godot/` —— 可选能力 bundle（行、图标、安装说明）。
- `tool-godot/`、`lsp-godot/`、`tool-godot-debug/`、`tool-godot-ego/`、`ui-godot/` —— 上述五个包（模块地图见 [architecture](docs/architecture.md)）。
- `docs/` —— 架构文档。

<a id="testing"></a>
## 测试

在以下环境验证：

- **操作系统**：Windows 11（build 26200）
- **Shell**：PowerShell 7（7.6.3）
- **Godot**：4.7 stable（console 构建）
- **Node.js**：24（v24.19.0）
- **DSH**：0.1.0-rc.5（harness monorepo workspace）

在 monorepo 根目录运行单元套件：`pnpm exec vitest run packages/godot/lsp-godot packages/godot/tool-godot-debug`。真实 Godot 集成套件（如调试器冒烟）经 `GODOT_EXE` 环境变量按需启用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- attach 调试、动态断点、场景树快照、多线程停止、惰性对象展开、变量编辑属于后续工作（钉住的协议事实为这些路径留有余地）。
- 内置格式化器的空白规则跟随 godot-vscode-plugin，而非 gdformat。
- `godot_format` 按设计只读；模型通过文件策略面应用改动。
- 断点需要支持调试的二进制；导出的 release 构建可能不会触发停止。
- harness 崩溃时可能遗留孤立的 godot 进程。
- 变量渲染遵循源插件的显示精度（数学类型 `toFixed(1)`，浮点 `toFixed(5)`）。

<a id="license"></a>
## 许可证

基于 MIT 许可证发布。完整文本见 [LICENSE](LICENSE)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

协议事实（LSP 分帧、远程调试器二进制格式、Godot 版本门）都已用真实 Godot 4.7 实例记录在 `docs/` 下；改动任何线上行为声明前先复核。这些包位于独立仓库，以 `packages/godot` 子模块挂载，因此改动先落在子模块，再在父仓库记录新提交。

</details>
