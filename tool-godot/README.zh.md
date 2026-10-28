---
description: "面向模型的无头 Godot 工程工具：校验脚本、运行场景、格式化 GDScript、检查工程文件、执行编辑器脚本。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-godot

[English](README.md) | 中文

**面向模型的 Godot 项目工具**——`godot_validate`、`godot_run_scene`、`godot_format`、`godot_inspect`、`godot_editor_script`——由**宿主机安装的 godot 与 gdformat 可执行文件**支撑。它们通过 `ctx.subprocess` 接缝以纯 `argv` 参数启动，没有 shell 层，因此不存在引号转义。与打包 ripgrep 的搜索套件不同，本包不随附任何二进制：注册是无条件的；可执行文件缺失时，调用会返回结构化 `GODOT_UNAVAILABLE` / `GODOT_FORMAT_UNAVAILABLE` 错误，绝不会在加载时失败。包注入 `tools`、`systemPrompt` 与 `subprocess`——刻意**不**注入 `fs`；只有 `godot_inspect`（纯解析 Godot 文本格式）与 `godot_format`（临时副本，绝不触碰用户文件）通过普通 `node:fs` 接触文件系统。

源码入口：[`src/index.ts`](src/index.ts)——插件注册、配置与 `godot` 设置命名空间。

```ts ignore-check
// A deployment points at its godot install; the defaults resolve `godot` and
// `gdformat` on PATH.
await ctx.plugin(LocalSubprocessRuntime)                       // @deepseek-ai/dsh-subprocess-local
await ctx.plugin(ToolGodot, { executable: 'C:\\Godot\\godot.exe' })
```

为什么使用子进程：Godot 校验与无头运行天然是 CLI 工作流，且不存在可供 harness 绑定的稳定进程内 Godot API。子进程接缝负责 spawn 执行、进程树终止、环境清理与有界输出捕获；本包负责 schema、参数校验、argv 构造、诊断解析、结果保留与超时声明。工具绝不暴露后台任务——进程退出、协作超时、调用方取消或失败都会结束调用。

## 概述

把 Godot 工程交给模型，它就能确认脚本与场景能否加载、无头运行场景并读取输出、格式化 `.gd` 文件并拿回文本、解析 `project.godot`／`.tscn`／`.tres` 结构，以及运行 `res://` 编辑器脚本。每次调用都通过 subprocess seam 启动宿主的 `godot`（默认格式化器还需 `gdformat`），因此包内不带任何二进制，且只有调用工具时才执行。缺少可执行文件时返回结构化的 `GODOT_UNAVAILABLE` 错误，而不是在加载时失败。

## 目录

- [部署要求：宿主上的 godot 与可选的 gdformat](#deployment-requirement-host-godot-and-optionally-gdformat)
- [设置](#settings)
- [配置](#config)
- [工具](#tools)
- [执行设计](#execution-design)
- [错误](#errors)
- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="deployment-requirement-host-godot-and-optionally-gdformat"></a>
## 部署要求：宿主上的 godot 与可选的 gdformat

工具需要 godot 可执行文件（任意 4.x 构建，必须支持 `--headless`）。`godot_format` 默认运行 [gdtoolkit](https://github.com/Scony/godot-gdscript-toolkit) 的 `gdformat`，或使用 **builtin 后端**（`formatBackend: 'builtin'`）——内嵌的 TextMate 格式化器（移植自 godot-vscode-plugin），无需 Python。两者通过 `executable` / `gdformatExecutable` 配置解析，可以是完整路径或 PATH 命令名。返回的路径按已解析的工作目录显示（调用方 agent 的会话 cwd，缺省为 `process.cwd()`），仅当该工作目录与文件系统根指向同一工作区时，`read` 才能继续读取——与搜索套件记录的共置要求一致。

<a id="settings"></a>
## 设置

本包注册 `godot` settings 命名空间（`GODOT_SETTINGS_NAMESPACE`），在 Web UI 的插件配置区显示为 Godot 卡片。`executable` 与 `gdformatExecutable` 可在其中编辑；保存的值对**下一次工具调用**即生效——每次执行时重新读取权威配置（设置层覆盖组合条目），无需重载。清空字段会重新继承组合条目。实时可执行文件与包装参数还以 `godot.toolchain` 服务发布；沙盒自身的 `executable` 留空时读取该值，因此路径只需在这张卡片里配置。其余上限按设计留在组合层：工具注册时声明的超时无法按调用重新读取。

<a id="config"></a>
## 配置

每个键都有默认值；部署方只覆盖自身环境需要的项。

| 键 | 默认值 | 含义 |
|---|---|---|
| `executable` | `godot` | godot 可执行文件路径或 PATH 命令名。 |
| `executableArgs` | `[]` | 插在 godot 可执行文件之后的固定 argv 元素（部署包装器）。 |
| `gdformatExecutable` | `gdformat` | gdformat 可执行文件路径或 PATH 命令名（`formatBackend` 为 `gdformat` 时使用）。 |
| `gdformatArgs` | `[]` | 插在 gdformat 可执行文件之后的固定 argv 元素。 |
| `formatBackend` | `gdformat` | `godot_format` 后端：`gdformat`（gdtoolkit）或 `builtin`（内嵌 TextMate 格式化器，无需 Python）。 |
| `builtinMaxEmptyLines` | `2` | builtin 后端：文件内最大连续空行数。 |
| `builtinDenseFunctionParameters` | `false` | builtin 后端：压缩函数参数列表内的多余空格。 |
| `builtinSpacesBeforeEndOfLineComment` | `'1'` | builtin 后端：行尾注释前的空格数（`'1'` 或 `'2'`）。 |
| `stdoutMaxBytes` | `1048576` | 单次运行 stdout 保留的最大字节数；有损读取会把结果标记为 `stdoutTruncated`。 |
| `stderrMaxBytes` | `262144` | 单次运行 stderr 保留的最大字节数；有损读取会把结果标记为 `stderrTruncated`。 |
| `validateMaxErrors` | `200` | 单次 `godot_validate` 结果内联保留的最大 issue 数；更多 issue 会置 `issuesTruncated`。 |
| `graceMs` | `5000` | 中止运行落定前，子进程 seam 给予的正向终止升级宽限；不得超过 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.zh.md)。 |
| `timeoutMs` | `60000` | 五个工具的协作调用预算，由 `@deepseek-ai/dsh-tool-call-timeout-policy` 经 `exec.signal` 实施。首次项目校验会启动无头编辑器并导入资源；大型项目可能需要更大预算。 |

<a id="tools"></a>
## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `godot_validate` | `path?`、`mode?`（默认 `project`，可 `file`、`scene`） | `project` 先运行 `godot --headless --editor --path <root> --quit`（导入资源并暴露场景/资源错误），再运行一个生成的 `SceneTree` 扫描脚本加载 `res://` 下所有 `.gd`，因此也能捕获脚本语法错误；`file` 运行 `godot --headless --check-only --script <file> --path <root>`。把 `ERROR:` / `SCRIPT ERROR:` / `WARNING:` 行及其 `at:` 位置（`<path>:<line>[:<column>]` 或 `<function> (<path>:<line>[:<column>])`）解析为结构化 issue（`res://` 路径按项目相对显示）。存在任何 error 类 issue 或非零退出/信号终止时 `ok` 为 false；失败且未解析出任何 issue 的运行会以其引擎输出尾部作为 `diagnostics` 返回。`scene` 完全不启动引擎：它读取一个 `.tscn`（或目录下所有 `.tscn`，上限 200 个文件）并报告结构性错误，例如把带 anchors/offsets 的 Control 放进 Container（容器会重新摆放子节点，于是文件看着对、屏幕不对）、在非容器父节点下使用容器布局、`parent=` 指向不存在的节点、节点路径重复、`ext_resource` 缺失，以及 `[connection]` 调用了目标脚本没有声明的函数。 |
| `godot_run_scene` | `scene`、`path?`、`frames?`、`args?`、`timeoutMs?` | 运行 `godot --headless --path <root> [--quit-after <frames>] <scene> [-- <args>]` 并回传捕获输出。非零退出或信号终止是领域结果（`ok: false`），不是错误。每次运行有自己的预算（`runSceneTimeoutMs`，默认 300000 ms，可用 `timeoutMs` 单次覆盖）：到期先终止进程，再带着 `timedOut: true` 返回它已经产生的输出。工具调用层的超时预算刻意设得更高，因为那一层会整条替换结果，把长跑测试已经打印的内容丢掉。 |
| `godot_format` | `file` | 格式化 `.gd` 文件并返回 `{ file, formatted, original, changed }`；绝不写入用户文件，因此模型用 `write`/`edit` 应用变更并受文件策略约束。`gdformat` 后端在**临时副本**上运行（gdformat 拒绝文件语法为 `GODOT_PARSE_ERROR`；格式化器崩溃或缺模块为 `GODOT_FORMAT_UNAVAILABLE`）；`builtin` 后端进程内格式化，无需 Python。 |
| `godot_inspect` | `path` | 纯解析 Godot 文本格式：项目根得到名称/主场景/autoload/章节；`.tscn` 得到 format/uid/ext_resources/节点；`.tres` 得到章节/ext_resources。不启动任何 godot 子进程。 |
| `godot_editor_script` | `script`（`res://`）、`path?`、`args?` | 在项目之外写入一个生成的 `SceneTree` 引导脚本并运行 `godot --headless --editor --path <root> --script <bootstrap> [-- <args>]`；引导脚本加载 `res://` EditorScript、在编辑器上下文中实例化它并调用其 `_run()`。Godot 的 `--script` 只接受 `SceneTree`/`MainLoop` 脚本，这正是 EditorScript 不能直接传入的原因。返回 stdout 与 stderr，脚本输出 JSON 时按 JSON 解析 stdout。这是需要编辑器访问的项目专属检查（场景图审计、自定义校验、快照导出）的逃生口；脚本是项目代码，拥有完整编辑器访问权（属于用户自己的信任边界）。非零退出是领域结果。 |

<a id="execution-design"></a>
## 执行设计

每次运行都是通过 `ctx.subprocess` 的普通前台 spawn，工作目录为会话 cwd，`exec.signal` 会透传给子进程，协作超时与调用方取消会终止进程树。捕获输出由 `stdoutMaxBytes`/`stderrMaxBytes` 限制；截断会在结果中报告（绝不会从模型视野中静默丢失）。退出语义归工具所有：非零退出与信号杀死是 `ok: false` 的领域结果——只有启动/基础设施失败（`GODOT_UNAVAILABLE`、`GODOT_FORMAT_UNAVAILABLE`）、不可读/不可解析的输入（`GODOT_PARSE_ERROR`）与取消（`GODOT_ABORTED`）才是类型化失败。无头 godot 运行会写 `.godot/` 导入产物；这是 Godot 的预期行为，已在系统提示指引中声明。`godot_validate` 的 project 模式与 `godot_editor_script` 生成的引导脚本写到系统临时目录，绝不写入用户项目。

<a id="errors"></a>
## 错误

失败携带包自有的 `GodotError`（`HarnessError` 子类），在 `isError` 结果上以 `{ name, code }` 呈现：`GODOT_UNAVAILABLE`（godot/gdformat 可执行文件无法解析或启动，或未产生可收集输出）、`GODOT_FORMAT_UNAVAILABLE`（gdformat 调用本身失败——traceback、缺模块）、`GODOT_PARSE_ERROR`（不可读/缺失/不支持的 project、scene 或 resource 输入，或 gdformat 拒绝文件语法）、`GODOT_ABORTED`（协作超时或调用方取消）。模型参数错误（空路径、非 `res://` 脚本、非正 `frames`）保持为普通工具参数错误。

<a id="model-experience"></a>
## Model Experience

### 系统提示

#### 模型看到什么

本插件注册作用域内的每个请求都包含下面独立注册的 godot 指引。按 agent 限定的工具限制可以隐藏 schema，但不会移除提示章节。

##### Godot guidance (tool:godot)

```markdown
Use godot_validate after editing GDScript to get structured parse errors, godot_run_scene to execute a scene headless and capture its output, godot_format to format a script with gdformat (returns the formatted text; apply it with write/edit), godot_inspect to read project/scene/resource structure, and godot_editor_script to run a res:// EditorScript in the project. Headless godot runs write the .godot cache and import artifacts.
```

#### Token 影响

工具注册期间每个请求有固定的指引成本。

#### KV Cache 影响

插件作用域与指引文本不变时前缀稳定。激活、销毁或改动文本可能使本提示章节之后的复用失效。

### 工具 schema

#### 模型看到什么

生成的 [`godot_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-godot) 描述每个工具的参数与规范输出；工具无条件注册，宿主机缺可执行文件不会改变 schema。

#### Token 影响

工具可见的每个请求有固定 schema 成本。

#### KV Cache 影响

工具可见性与定义不变时前缀稳定。注册生命周期或作用域限制可能使首个变更 schema token 起的复用失效。

### 结果

#### 模型看到什么

`godot_validate` 返回通过/失败头部加每条保留 issue 一行 `path:line:column [error|warning] message`，附截断说明；其结果卡片携带 issue 列表与编辑器跳转位置。`godot_run_scene` 与 `godot_editor_script` 返回捕获输出与退出头部。`godot_format` 返回格式化文本并标记 `changed`，其结果卡片渲染前后 diff（元数据每侧上限 64 KiB）。`godot_inspect` 返回按类型区分的结构化摘要。

#### Token 影响

内联 issue 由 `validateMaxErrors` 限制；捕获输出由 stdout/stderr 字节预算限制；保留的结果在压缩前一直留在历史中。

#### KV Cache 影响

只增不改；新出现的可见内容跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

### 工具错误

#### 模型看到什么

失败规范化为 `Error: <message>`，并为调用方携带结构化的 `GODOT_UNAVAILABLE`、`GODOT_FORMAT_UNAVAILABLE`、`GODOT_PARSE_ERROR` 或 `GODOT_ABORTED` 元数据。

#### Token 影响

只有失败的调用才增加这些保留 token。

#### KV Cache 影响

只增不改；新出现的可见内容跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **godot 由宿主安装；gdformat 仅默认后端需要**——包不随附二进制；可执行文件缺失会在调用时（`GODOT_UNAVAILABLE` / `GODOT_FORMAT_UNAVAILABLE`）失败，绝不会在加载时失败。`builtin` 后端（`formatBackend: 'builtin'`）既不需要 gdformat 也不需要 Python——只需内嵌 TextMate 语法与其依赖自带的 `vscode-oniguruma` WASM。
- **builtin 格式化器遵循 godot-vscode-plugin 规则而非 gdformat 的**——其空白决策（参数列表、空行上限、注释间距）由迁移的 snapshot 套件锁定；切换后端会改变同一文件的输出。`gdformat` 仍是默认，以保持 gdtoolkit 一致性。
- **godot_format 按设计只读**——它返回文本；模型必须用 `write`/`edit` 应用变更，使文件策略生效。超大文件的 diff 卡片元数据每侧上限 64 KiB（规范结果仍携带完整文本）。
- **project 模式校验会跑两次引擎**——编辑器导入阶段会启动无头编辑器（首次资源导入是慢的部分），GDScript 扫描阶段会再次启动它，因此大型项目可能需要调大默认 60 秒协作超时（配置 `timeoutMs`）。扫描会丢弃 godot 自身的 `leaked at exit` 收尾噪声——即使项目干净，`--script` 退出路径也会打印它们。
- **godot_editor_script 运行项目代码**——脚本在用户项目内以完整编辑器访问权执行；属于用户自己的信任边界，已在工具描述中声明。
- **无头运行写项目缓存**——validate/run/editor_script 会写 `.godot/` 导入产物；这是 Godot 的预期行为，已在系统提示指引中声明。
- **Godot 4.4+ 内置格式化器无稳定 CLI**——`gdformat` 后端依赖 gdtoolkit；builtin 后端内嵌 godot-vscode-plugin 的格式化器。编辑器内置格式化器不在范围内。
- **语义导航在 `lsp-godot` 中**——DSH `ctx.lsp` 接缝针对 Godot TCP 语言服务器的四个导航操作由同级包 [`lsp-godot`](../lsp-godot/README.zh.md) 提供（attach 已运行的编辑器或自起无头编辑器）；本包只覆盖无头 CLI 工作流。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

这些工具以 spawn 为后端，因为 Godot 没有稳定的进程内 API：subprocess seam 负责 argv 执行、进程树终止、环境清理与有界输出，本包负责 schema、argv 构造、诊断解析与保留策略。新增工具时把 schema 与 argv 构造函数放在同类实现旁边；工具目录是生成的，不要手工编辑 `docs/tool-catalog.md`。

</details>
