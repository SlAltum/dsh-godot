# @deepseek-ai/dsh-tool-godot-debug

[English](README.md) | 中文

**`godot_debug` 工具**对 Godot 项目执行一次有界、脚本化的调试运行：模型设置断点（`res://` 路径或绝对文件路径 + 行号），工具以 `--remote-debug` headless 启动项目，在每次停顿时快照堆栈与 locals/members/globals，自动继续至 `maxStops`，最后返回结构化报告（含游戏输出与错误）——无需给被测代码加 print 即可探查运行时状态。对象变量在首个停顿就地展开（属性见 `expanded objects`），模型可在暂停态**编辑对象属性**（`edits`：设置顶层对象变量的属性，每次写入经引擎验证并报告 `ok`/`failed`），并在每个有帧停顿快照**场景树**（当前节点层级）。第二种模式 `mode: "attach"` 连接用户已用 `--remote-debug tcp://127.0.0.1:<port>` 启动的游戏：断点改为连接后动态发送，detach 后游戏继续运行。

与 tool-godot 工具族一致，该工具是 **spawn-backed 一次性调用**：`godot_debug` 从不暴露后台任务；调用只在运行结束、被协作式超时终止、被中止或失败后返回。包注入 `tools`、`systemPrompt` 与 `subprocess`——刻意不注入 `fs`；仅项目根校验与断点路径转换触碰文件系统（plain `node:fs`）。

```ts
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodotDebug from '@deepseek-ai/dsh-tool-godot-debug'

// A deployment points at its godot install; the default resolves `godot` on PATH.
export async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodotDebug, { executable: 'C:\\Godot\\godot.exe' })
}
```

## 工作原理

Godot 4 调试协议是**自定义二进制协议**（非 DAP）：本侧绑定预选空闲端口，spawn `godot --path <root> --headless --remote-debug "tcp://127.0.0.1:<port>" [--breakpoints "res://f:l,..."] [scene] [-- args]`，游戏进程作为 TCP 客户端连入。每帧为 `[u32 LE 长度][variant 编码数组]`，数组为 `[command, threadId, params]`（Godot 4.2+）。每次停顿工具请求堆栈转储与帧变量、快照（有界深度）并继续。协议事实已 pin 在 `.context/t3/facts.md`（Godot 4.7 实测）。

**attach 模式**下工具只绑定端口并等待：用户自行启动游戏（`godot --path <root> --remote-debug tcp://127.0.0.1:<port>`），工具在 `set_pid` 后动态发送断点（attach 的唯一断点来源——CLI `--breakpoints` 仅 launch 可用），可选 `pauseOnAttach` 发 `break` 立即暂停一次，执行同样的停顿循环，然后 detach：best-effort 断点移除 + continue + 断开。游戏绝不被杀死并继续运行；报告携带 `detached: true`，无 `exit` 事实。已 pin 的 attach 事实（`.context/t4/facts.md`）：连接时已暂停的游戏会补发 `debug_enter`；`break` 暂停的 reason 为空字符串、`isUserBreakpoint=true`、引擎栈为空；detach 从不把游戏留在暂停态（自动恢复），无调试器时残留断点被忽略；**Godot 不重试失败的连接**——游戏必须在工具调用之后启动（或端口已先处于监听状态）。

## Settings

本包**不注册** settings 命名空间（`godot` 命名空间归 tool-godot 所有）；可执行文件与上限均为 composition 级配置。

## Config

每个键都有默认值；部署只需覆盖环境需要的部分。

| 键 | 默认值 | 含义 |
|---|---|---|
| `executable` | `godot` | godot 可执行文件路径或 PATH 命令名。 |
| `executableArgs` | `[]` | 可执行文件后插入的固定 argv（部署包装器）。 |
| `debugPort` | `0` | 游戏连入的 remote-debug 端口；`0` = 自动预选空闲端口（默认）。固定端口适合需要放行入站规则的部署。 |
| `maxMessageBytes` | `16777216` | 接受的最大单条协议帧消息。 |
| `maxOutputBytes` | `1048576` | 单次运行保留的游戏 `output`/`error` 内容字节上限；超出后结果标记 `outputTruncated`。 |
| `maxStderrBytes` | `1048576` | 自起游戏保留的 stderr 尾部上限（用于诊断）。 |
| `idleTimeoutMs` | `10000` | 半帧/响应停滞预算，超时断开连接；不能超过 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)。 |
| `connectWaitMs` | `20000` | spawn 后游戏连入的预算（冷启动 + 首次 import）。 |
| `graceMs` | `5000` | 中止运行前的终止升级宽限；不能超过 `MAX_TIMER_DELAY_MS`。 |
| `timeoutMs` | `60000` | 协作式工具调用预算，经 `exec.signal` 由工具调用超时策略强制执行。大项目首次 import 可能需要更大预算。 |
| `maxExpandedObjects` | `10` | 首个有帧停顿上经 `scene:inspect_object` 展开的对象数上限；`0` = 禁用展开。 |
| `maxExpandedProps` | `100` | 每个展开对象保留的属性行上限。 |
| `maxEdits` | `10` | 首个有帧停顿上经 `scene:set_object_property` 应用的编辑数上限；`0` = 禁用编辑。 |
| `maxTreeNodes` | `200` | 每个有帧停顿解析/渲染的场景树节点数上限；`0` = 禁用场景树快照。 |

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `godot_debug` | `path?`、`mode?`（`launch` \| `attach`）、`port?`、`scene?`、`breakpoints?`（`[{file, line}]`）、`pauseOnAttach?`、`edits?`（`[{target, property, value, type?}]`）、`maxStops?`（默认 10，上限 50）、`args?`、`timeoutMs?` | 一次有界调试运行。`launch`（默认）：校验项目（断点在项目根外 → `GODOT_PARSE_ERROR`）、校验 `--version` ≥ 4.2、预选空闲端口、headless 启动游戏、等待 `set_pid`（threadId 就绪），然后循环：等待停顿（断点命中或脚本错误）、快照堆栈+变量、快照场景树、在首个有帧停顿展开对象变量、应用 `edits`（每条经 re-inspect 验证）、继续——直到 `maxStops`、游戏退出或预算耗尽。返回 `{ stops, output, errors, exit, expansion?, edits?, sceneTrees?, outputTruncated?, varsTruncated? }`。`attach`：显式 `port` 必填（0/缺省 → `GODOT_PARSE_ERROR` 附启动指引；`scene`/`args` 被拒绝）、无版本门槛、不 spawn——动态发送断点后执行同样的停顿循环；detach 时 best-effort 断点移除 + continue，返回 `{ stops, output, errors, detached: true }`（无 `exit`）。 |

## 错误

失败携带包属 `GodotError`（`HarnessError` 子类），在 `isError` 结果上以 `{ name, code }` 呈现：`GODOT_UNAVAILABLE`（可执行文件/版本/启动/连接失败，附版本或 stderr 尾部）、`GODOT_PARSE_ERROR`（项目不可读、断点在项目外、协议帧畸形或超长）、`GODOT_ABORTED`（协作式超时或调用方取消）。无任何停顿即完成的运行是成功的部分结果（`stops: []` + 输出与错误），不是错误。

## 模型体验

### System prompt

#### 模型所见

本插件注册范围内的每个请求都包含独立注册的 godot-debug 引导文案。Agent 级工具限制可以隐藏 schema，但不会移除提示段。

##### Godot debug 引导（tool:godot-debug）

```markdown
Use godot_debug to run a Godot scene under the debugger: set breakpoints (res:// path or absolute file path plus line), the tool launches the project headless, snapshots the stack and locals/members/globals at each stop, and auto-continues up to maxStops. Returns per-stop stack frames and variable values plus the game output and errors. Object variables are expanded in place on the first stop (properties under "expanded objects"). Variable edits (edits parameter) are applied on the first stop while paused and verified against the engine: give target (a top-level variable name, e.g. self or player), property (the name shown in the expansion, Members/ prefix optional), value as a string, and type int|float|string|bool (default string). Only object properties are editable — scalar variables are not. Each edit reports ok/failed. The scene tree (current node hierarchy, "scene tree" block under each stop) is snapshotted on every stop that has a stack frame; node ids are usable for future inspect linkage.
```

#### Token 影响

工具注册期间每次请求的固定引导成本。

#### KV Cache 影响

插件作用域与引导文本不变时前缀稳定。激活、销毁或编辑文本可能使本提示段的复用失效。

### 工具 schema

#### 模型所见

生成的 `godot_debug` schema 见[工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-tool-godot-debug)；工具无条件注册，因此宿主缺少可执行文件不会改变 schema。

#### Token 影响

工具可见时每次请求的固定 schema 成本。

#### KV Cache 影响

工具可见性与定义不变时前缀稳定。

### 结果

#### 模型所见

`godot_debug` 返回 generic 卡：`N stops at <file>:<line> (maxStops)` 头部、每个停顿一行 `#i <file>:<line> @ <function> [reason]`、**首个有帧的停顿**的完整 locals/members/globals（`break` 暂停的引擎栈为空，渲染为 `[break]`）、该停顿对象变量的展开属性（`<name> = Object<<id>> [<引擎类>]` + 缩进 `property = value` 行，受 `maxExpandedObjects`/`maxExpandedProps` 约束）、该停顿应用的编辑（`<target>.<property> = <value> [<type>] ok|failed: <detail>`，受 `maxEdits` 约束，每条经 re-inspect 与引擎验证）、每个有帧停顿的场景树（缩进 `name [class] (id)` 行 + 场景文件，受 `maxTreeNodes` 约束）、输出/错误摘要与截断标记；attach 结果末尾附 `attached; game left running (not owned by the tool)`。

#### Token 影响

由 `maxStops` × 每停顿渲染上限（深度 3、每作用域 200 变量）与 `maxOutputBytes` 约束。

#### KV Cache 影响

追加式；新可见内容跟随可复用请求前缀。

### 工具错误

#### 模型所见

失败规范化为 `Error: <message>`，附结构化 `GODOT_UNAVAILABLE`、`GODOT_PARSE_ERROR` 或 `GODOT_ABORTED` 元数据。

#### Token 影响

仅失败调用增加保留 token。

#### KV Cache 影响

追加式。

## 已知限制与延后工作

- **godot 是宿主安装**——包内不随附二进制；缺少可执行文件在调用时失败（`GODOT_UNAVAILABLE`），绝不在加载时。
- **headless 调试要求项目至少 import 过一次**——游戏模式不自动 import，缺少 `.godot` 全局类缓存会触发 Parser Error 停顿而非正常运行；先执行 `godot --headless --editor --path <root> --import --quit`，或接受首次运行报告该问题。
- **断点需要可调试构建**——导出的 release 构建可能不产生停顿；标准构建可以。
- **`--breakpoints` 值无法转义逗号**——Godot 按 `,` 分割参数，含逗号的文件名无法经 CLI 断点定位（可用 `godot_debug` 的 `args` 传入并依赖动态停顿，或重命名文件）。
- **游戏 user 数据目录必须可写**——`user://` 创建失败时 Godot 游戏模式崩溃（信号 11，如沙箱/容器部署）；将环境的 `APPDATA`（Windows）指向可写目录或记录部署要求。
- **首次运行 import 延迟**——首个 headless 运行会导入资源；大项目默认 60s 预算可能需要通过 `timeoutMs` 调高。
- **变量渲染沿用源插件的显示精度**——math 类型经 `stringify_value` 呈现，`toFixed(1)` 四舍五入（`0.123456` → `0.1`）。
- **变量编辑仅限首个停顿的顶层标量属性**——`scene:set_object_property` 只在首个有帧的停顿执行，目标是顶层对象变量（标量变量没有对象 id，引擎也没有对应机制），只写标量值（`int`/`float`/`string`/`bool`）——嵌套/容器属性（数组/字典成员、源插件 `changes_parent` 路径）延后。引擎对 set **无协议级确认**（已 pin，`.context/t6/facts.md`），每条编辑经 re-inspect 对象并比对值来验证；失败的写入（属性不存在、只读属性、类型不匹配）在协议层静默，呈现为逐条 `failed` 结果并标记 `editsTruncated`。`int` 值按引擎式截断解析（`12.5` → `12`）；`string` 属性拒绝非字符串值。运行中的游戏也会接受写入，但工具只在暂停态应用编辑。
- **对象展开仅限首个停顿的顶层一级**——`scene:inspect_object` 只在首个有帧的停顿对顶层对象值执行（数组/字典成员保持 `Object<id>`）；属性内的嵌套对象渲染为 `Object<id>`，不递归。无响应的对象被跳过并标记 `expansionTruncated`（非暂停态的游戏不响应——已 pin）。展开的类名为**引擎类**（`get_class()`，如 `class_name Player` 脚本显示为 `Node`），非脚本类名。
- **场景树仅呈现且按有帧停顿快照**——`scene:request_scene_tree` 在每个有帧的停顿执行；树渲染为缩进 `name [class] (id)` 行（脚本节点的类为其脚本路径，如 `res://main.gd`，已 pin `.context/t7/facts.md`），每停顿受 `maxTreeNodes` 约束。节点 id **不**联动展开/编辑（延后）；`break` 暂停上报仅根节点的树（引擎行为，非错误）。
- **attach 需要显式端口与正确的启动顺序**——调用方必须预知端口，且游戏必须在工具调用之后启动：Godot 不重试失败的调试器连接（已 pin，`.context/t4/facts.md`）。`pauseOnAttach` 停顿提供「游戏此刻在做什么」探测。
- **attach 命中依赖游戏再次执行到目标行**——动态断点不回退已执行代码；可配合 `pauseOnAttach` 或瞄准会再次运行的代码。
- **attach 假设项目与运行中的游戏一致**——调试协议没有工作区握手；`path` 错误会产生永不命中的断点（运行报告 `stops: []`）。
- **多线程停顿延后**——launch/attach 覆盖脚本化逐停顿快照；原始协议事实（`.context/t3/facts.md`）为这些路径保留依据。
- **harness 崩溃可能遗留孤儿 godot 进程**——工具在 teardown 时终止进程树；harness 骤然死亡仍可能遗留自起游戏进程。attach 模式下骤然死亡只是 detach：游戏自动恢复运行（断开从不使其保持暂停，已 pin）。
