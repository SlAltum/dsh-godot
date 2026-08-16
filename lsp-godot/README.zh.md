# @deepseek-ai/dsh-lsp-godot

[English](README.md) | 中文

**Godot GDScript 语言服务器 provider**，接入 LSP 能力 seam（`ctx.lsp`）。插件注册 `godot` provider（`.gd` → `gdscript`），使模型侧的 `lsp` 工具可以针对 Godot 内置 TCP 语言服务器执行 `goToDefinition`、`findReferences` 与 `hover`——连接已运行的编辑器（默认 `127.0.0.1:6005`），或自起 headless 编辑器（`godot --path <dir> --editor --headless --no-window --lsp-port <p>`）。`goToImplementation` 会被能力协商直接拒绝，因为 Godot 从不声明该能力（T0 事实，基于 Godot 4.7 实测记录）。

Godot 专属协议清洗在本包内完成：hover markdown 清洗（行首 tab 剥离 + 源插件的 bbcode 残留兜底）与 URI 规范化（`file:///D%3A/...` → `file:///D:/...`，与 fs provider 的 `pathToFileURL` 形式对齐）。帧协议、能力协商与结果归一化复用 `@deepseek-ai/dsh-lsp-stdio`。

```ts ignore-check
// A deployment attaches to a running editor (default), or spawns one:
await ctx.plugin(ToolGodotLsp, { connectMode: 'attach', ports: [6005] })
await ctx.plugin(ToolGodotLsp, { connectMode: 'spawn', spawnExecutable: 'C:\\Godot\\godot.exe' })
```

## 部署要求

- **attach 模式**需要正在运行的 Godot 编辑器并启用其 LSP（编辑器 → 编辑器设置 → 网络 → Language Server；默认监听 `127.0.0.1:6005`，可配置）。打开的项目必须与查询工作区匹配（相同或为其父目录）——Godot LSP 只索引它打开的项目，服务器会在 initialize 握手期间通过 `gdscript_client/changeWorkspace` 通告不匹配，provider 据此以 `LSP_UNAVAILABLE` 拒绝查询。
- **spawn 模式**需要 Godot 4.2+（或 3.6+）可执行文件（headless LSP 有版本门槛）；provider 在首次实际 spawn 时惰性解析并校验 `--version`。自起编辑器会写 `.godot/` import 产物并使用 provider 预选的端口；冷启动加首次 import 在大项目上可能超过 `lsp` 工具的 60s 默认预算（可调高 `tool-lsp` 的 `timeoutMs` 或预热）。

## Settings

本包不注册 settings 命名空间；`host`、`ports`、`connectMode` 与 spawn 选项均在插件配置（composition 条目）中。`godot` settings 命名空间属于 `@deepseek-ai/dsh-tool-godot`。

## Config

每个键都有默认值；部署只需覆盖环境需要的部分。

| 键 | 默认值 | 含义 |
|---|---|---|
| `host` | `127.0.0.1` | attach 模式的 LSP 服务器主机。 |
| `ports` | `[6005]` | attach 时按顺序探测的端口。 |
| `connectMode` | `auto` | `attach`（已运行的编辑器）、`spawn`（自有的 headless 编辑器）或 `auto`（先探测 attach，失败回退 spawn）。 |
| `connectTimeoutMs` | `1500` | 每次 attach 探测的 TCP 连接预算。 |
| `idleTimeoutMs` | `10000` | 半帧停滞预算，超时即断开连接。 |
| `spawnExecutable` | `godot` | spawn 模式的 Godot 可执行文件（首次 spawn 时惰性解析）。 |
| `spawnArgs` | `[]` | 可执行文件后插入的额外 argv。 |
| `spawnPort` | `0` | 0 = provider 预选空闲端口；否则使用指定端口。 |
| `spawnReadyTimeoutMs` | `120000` | 自起编辑器的 LSP 端口接受连接的预算。 |
| `maxDocumentBytes` | `4000000` | 单次查询打开的源码文档上限。 |
| `maxMessageBytes` | `16000000` | 接受的最大单条帧消息。 |
| `maxStderrBytes` | `1000000` | 自起编辑器保留的 stderr 尾部上限（用于诊断）。 |
| `killGraceMs` | `2000` | 取消宽限与进程终止升级预算。 |

## 模型体验

### System prompt

#### 模型所见

本包不注册 system-prompt 段落；`lsp` 工具的引导文案（`tool-lsp`）已覆盖操作语义。provider 只让 Godot 查询成为可能，不改变模型所见内容。

##### Godot LSP 引导（provider）

```markdown
No provider guidance: the lsp tool's operation semantics are covered by tool-lsp.
```

#### Token 影响

本包不注册提示段落；`lsp` 工具的固定引导文案（`tool-lsp`）不因本包而改变。

#### KV Cache 影响

在 `tool-lsp` 引导文案不变时前缀稳定；provider 注册不增加任何自身提示 token。

### 结果

#### 模型所见

`goToDefinition`/`findReferences` 返回由 `tool-lsp` 渲染的工作区相对 `path:line:character` 位置（Godot URI 先规范化为 fs 形式）；`hover` 返回清洗后的 markdown（行首 tab 剥离 + bbcode 残留兜底）。空 hover（`contents: []`，Godot 在类型标注位置返回）归一化为成功的无结果。

#### Token 影响

受 `tool-lsp` 结果上限约束；连接状态永不对模型可见。

#### KV Cache 影响

追加式；查询结果跟在可复用的请求前缀之后。

### 工具错误

#### 模型所见

失败归一化为 `LspError` 码：`LSP_UNAVAILABLE`（配置端口无服务、spawn 版本门槛失败、spawn 提前退出、查询中途断连、项目不匹配）、`LSP_UNSUPPORTED_OPERATION`（`goToImplementation`——Godot 从不声明——或服务器不支持 transient open）、以及 seam 的 `LSP_MALFORMED_RESPONSE`（服务器负载不可解析）。

#### Token 影响

只有失败的查询增加这些保留 token。

#### KV Cache 影响

追加式。

## 已知限制与延期工作

- **attach 需要匹配的已运行编辑器**——Godot LSP 只索引它打开的项目；服务器 `changeWorkspace` 路径与查询工作区不匹配（相同或父目录）时 provider 拒绝查询。attach 侧无法切换 Godot 的项目。
- **Godot 忽略 `$/cancelRequest`**——中止的查询通过断开连接取消；下一次查询建立全新连接（服务器不识别重连的客户端，源插件 issue #844）。
- **异常断开可能在服务器端残留 open 文档**——provider 在放弃中止连接前尽力发送 `didClose`；下一次 `didOpen` 会覆盖服务器端状态。
- **spawn 需要 Godot 4.2+ / 3.6+**——旧版本会静默跳过 LSP 启动；provider 会带着报告的版本号明确失败。
- **自起编辑器由 provider 持有**——连接关闭即终止编辑器进程；harness 崩溃可能遗留孤儿 headless 编辑器（subprocess seam 只在正常生命周期清理）。
- **自起编辑器冷启动会写 `.godot/` import 产物**，大项目上可能超过 `lsp` 工具的 60s 预算。
- **`gdscript/capabilities` 通知被忽略**——native 类表很大，且不属于 seam 的四个操作。
- **无格式化与重命名**——seam 只暴露四个语义操作；Godot LSP 的格式化/重命名面超出范围（headless 格式化见 `tool-godot`）。
