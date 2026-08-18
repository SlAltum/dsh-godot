# @deepseek-ai/dsh-tool-godot-debug

[English](README.md) | 中文

**`godot_debug` 工具**对 Godot 项目执行一次有界、脚本化的调试运行：模型设置断点（`res://` 路径或绝对文件路径 + 行号），工具以 `--remote-debug` headless 启动项目，在每次停顿时快照堆栈与 locals/members/globals，自动继续至 `maxStops`，最后返回结构化报告（含游戏输出与错误）——无需给被测代码加 print 即可探查运行时状态。对象变量在首个停顿就地展开（属性见 `expanded objects`，嵌套对象按 `maxExpandDepth` 递归展开；StringName 渲染为 `&'x'`，数组预览实际值如 `(2) [(11, 12), (21, 22)]`，声明 `__repr__` 成员的对象以其值作为显示名——`thing = Thing(hero) [RefCounted]`，无 `__repr__` 者保持 `Object<id>`），模型可在暂停态**编辑对象属性**（`edits`：设置顶层对象变量的属性，每次写入经引擎验证并报告 `ok`/`failed`），并在每个有帧停顿快照**场景树**（当前节点层级）。第二种模式 `mode: "attach"` 连接用户已用 `--remote-debug tcp://127.0.0.1:<port>` 启动的游戏：断点改为连接后动态发送，detach 后游戏继续运行。

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

**attach 模式**下工具只绑定端口并等待：用户自行启动游戏（`godot --path <root> --remote-debug tcp://127.0.0.1:<port>`），工具在 `set_pid` 后动态发送断点（attach 的唯一断点来源——CLI `--breakpoints` 仅 launch 可用），可选 `pauseOnAttach` 发 `break` 立即暂停一次，执行同样的停顿循环，然后 detach：best-effort 断点移除 + continue + 断开。游戏绝不被杀死并继续运行；报告携带 `detached: true`，无 `exit` 事实。已 pin 的 attach 事实（`.context/t4/facts.md`）：连接时已暂停的游戏会补发 `debug_enter`；`break` 暂停的 reason 为空字符串、`isUserBreakpoint=true`、引擎栈为空；detach 从不把游戏留在暂停态（自动恢复），无调试器时残留断点被忽略；**Godot 不重试失败的连接**——游戏必须在工具调用之后启动（或端口已先处于监听状态）。编辑器调试器共存已 pin（`.context/t11/facts.md`）：空闲的 Godot 编辑器**不**绑定任何调试端口——外部启动的游戏以 `--remote-debug` 指向编辑器默认端口（6007）时会打印一次 `Remote Debugger: Unable to connect` 并照常运行——因此编辑器运行时 attach 完全不受影响（完整停顿循环 + detach，编辑器无感知地继续运行）。一个游戏**只有一个调试目标**：传入多个 `--remote-debug` 参数时**最后一个生效**；已在拨号其他目标的游戏永远不会连入 attach 端口——运行以上述启动顺序指引超时。编辑器自己启动（F5）的游戏由编辑器自身的服务器调试，无法 attach。

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
| `maxExpandDepth` | `2` | 展开深度上限：`1` = 仅顶层对象，`2` = 属性值内的嵌套对象（直接成员/数组/字典）递归展开。 |
| `maxEdits` | `10` | 首个有帧停顿上经 `scene:set_object_property` 应用的编辑数上限；`0` = 禁用编辑。 |
| `maxTreeNodes` | `200` | 每个有帧停顿解析/渲染的场景树节点数上限；`0` = 禁用场景树快照。 |

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `godot_debug` | `path?`、`mode?`（`launch` \| `attach`）、`port?`、`scene?`、`breakpoints?`（`[{file, line}]`）、`pauseOnAttach?`、`expandNodes?`（`string[]` 节点 id）、`nodePaths?`（`string[]` 场景路径）、`edits?`（`[{target, property, value, type?}]`）、`maxStops?`（默认 10，上限 50）、`args?`、`timeoutMs?` | 一次有界调试运行。`launch`（默认）：校验项目（断点在项目根外 → `GODOT_PARSE_ERROR`）、校验 `--version` ≥ 4.2、预选空闲端口、headless 启动游戏、等待 `set_pid`（threadId 就绪），然后循环：等待停顿（断点命中或脚本错误）、快照堆栈+变量、快照场景树、在首个有帧停顿展开对象变量（以 `__repr__` 显示名、`&'x'` StringName 与值预览渲染；属性名可能带引擎分组前缀如 `Node/process_mode`；`expandNodes` 节点 id 与 `nodePaths` 场景路径如 `Main/Player` 优先展开，与变量去重）、应用 `edits`（每条经 re-inspect 验证；target 接受变量名、`node:<id>` 或经本停顿树解析的 `path:<场景路径>`；裸名、`Members/` 前缀名与分组前缀名均可解析——分组前缀的单段属性名经一次额外 inspect 映射到原始名，因为引擎静默拒绝 `Node/...` 标签，已 pin）、继续——直到 `maxStops`、游戏退出或预算耗尽。返回 `{ stops, output, errors, exit, expansion?, edits?, sceneTrees?, outputTruncated?, varsTruncated? }`。`attach`：显式 `port` 必填（0/缺省 → `GODOT_PARSE_ERROR` 附启动指引；`scene`/`args` 被拒绝）、无版本门槛、不 spawn——动态发送断点后执行同样的停顿循环；detach 时 best-effort 断点移除 + continue，返回 `{ stops, output, errors, detached: true }`（无 `exit`）。 |

## 错误

失败携带包属 `GodotError`（`HarnessError` 子类），在 `isError` 结果上以 `{ name, code }` 呈现：`GODOT_UNAVAILABLE`（可执行文件/版本/启动/连接失败，附版本或 stderr 尾部）、`GODOT_PARSE_ERROR`（项目不可读、断点在项目外、协议帧畸形或超长）、`GODOT_ABORTED`（协作式超时或调用方取消）。无任何停顿即完成的运行是成功的部分结果（`stops: []` + 输出与错误），不是错误。

## 模型体验

### System prompt

#### 模型所见

本插件注册范围内的每个请求都包含独立注册的 godot-debug 引导文案。Agent 级工具限制可以隐藏 schema，但不会移除提示段。

##### Godot debug 引导（tool:godot-debug）

```markdown
Use godot_debug to run a Godot scene under the debugger: set breakpoints (res:// path or absolute file path plus line), the tool launches the project headless, snapshots the stack and locals/members/globals at each stop, and auto-continues up to maxStops. Returns per-stop stack frames and variable values plus the game output and errors. Object variables are expanded in place on the first stop (properties under "expanded objects"; nested objects inside properties are expanded recursively, bounded by config maxExpandDepth, with location-path names like arr[0] or dict["k"] (StringName dictionary keys render the &'x' form, e.g. dict["&'snkey'"]); StringNames render as &'x', arrays preview their actual values like (2) [(11, 12), (21, 22)], and an object that declares a __repr__ member displays it as its name — e.g. self = Thing(hero) [Node]; without one, Object<id> [engine class]). Property names may carry group prefixes from the engine (e.g. Node/process_mode); edits accept the bare name, the Members/ prefix, or the displayed prefixed form. Tree NODE IDS and SCENE PATHS are directly usable: pass scene-tree node ids (the numbers in the tree lines) to expandNodes, or scene paths (e.g. Main/Player, engine root excluded) to nodePaths — both expand on the first stop before the top-level variables. Edits accept target "node:<id>" (any scene node id) or "path:<scene path>" (resolved against the stop's tree, e.g. path:Main/Player). Paths are the stable cross-call channel: raw ids are per-run random in launch mode. Variable edits (edits parameter) are applied on the first stop while paused and verified against the engine: give target (a top-level variable name, e.g. self or player), property (the name shown in the expansion, Members/ prefix optional), value as a string, and type int|float|string|bool (default string). Only object properties are editable — scalar variables are not. Each edit reports ok/failed. The scene tree (current node hierarchy, "scene tree" block under each stop) is snapshotted on every stop that has a stack frame; node ids are usable for future inspect linkage.
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

`godot_debug` 返回 generic 卡：`N stops at <file>:<line> (maxStops)` 头部、每个停顿一行 `#i <file>:<line> @ <function> [reason]`（子线程暂停标注 `[reason @ thread N]`——线程 id 1 为主线程不标注，已 pin `.context/t10/facts.md`）、**首个有帧的停顿**的完整 locals/members/globals（`break` 暂停的引擎栈为空，渲染为 `[break]`）、该停顿的展开对象（`<name> = <repr> [<引擎类>]`——声明 `__repr__` 成员时显示其值，否则 `Object<<id>>`；属性行带引擎分组前缀如 `Node/process_mode`；嵌套对象以更深缩进与定位路径名呈现，如 `arr[0]`/`dict["k"]`——StringName 字典键用 `&'x'` 形态（`dict["&'snkey'"]`），受 `maxExpandedObjects`/`maxExpandedProps`/`maxExpandDepth` 约束；StringName 渲染 `&'x'`，数组预览其值如 `(2) [(11, 12), (21, 22)]`，预览内 `__repr__` 名同样解析）、该停顿应用的编辑（`<target>.<property> = <value> [<type>] ok|failed: <detail>`，受 `maxEdits` 约束，每条经 re-inspect 与引擎验证）、每个有帧停顿的场景树（缩进 `name [class] (id)` 行 + 场景文件，受 `maxTreeNodes` 约束）、输出/错误摘要与截断标记；attach 结果末尾附 `attached; game left running (not owned by the tool)`。

#### 浏览器看到的内容（结构化卡片视图，T20）

工具的 `presentationMeta` 携带可回放卡片视图：紧凑的 `DebugMeta`（停顿位置 + 计数）外加带版本、JSON-safe 的 `view`——逐停顿帧列表、首个有帧停顿的渲染变量行、展开树、编辑结果、逐停顿场景树与有界输出/错误尾部。随附动态 UI 插件（`docs/ui-plugin-godot.js`）将其渲染为可折叠的逐停顿分区与摘要 chips 行；view 缺失或损坏时卡片回退整段文本报告。视图与文本保持体积对等：变量行只渲染在首个有帧停顿，256 KiB 序列化预算先裁变量行、再裁场景树行，并置 `viewTruncated` 标记。

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
- **变量渲染保留有效数字**——数字最多保留 7 位有效数字渲染（整数直出、尾零去除；float32 线伪影如 `0.10000000149011612` 归一为 `0.1`）；超大/极小值用指数形式。源插件的 `toFixed(1)` UI 四舍五入（`0.123456` → `0.1`）已被取代。显示规则对齐源插件 2.7.0 表面：字符串加引号（`'hello'`）、StringName 渲染 `&'x'`、数学类型顶层渲染 `Vector2(10, 20)` 但数组预览内**裸 stringify**（`(2) [(11, 12), (21, 22)]`）、字典渲染 `Dictionary(n)`。scope 层（堆栈）ObjectId 保持 `Object<id>`——解析其类名需要对每个值发起请求，超出一次性工具预算（已 pin 差异，`.context/t13/facts.md`）。
- **多线程暂停正确归属与寻址**——子线程（`Thread` 类）停顿标注 `[reason @ thread N]`（线程 id 1 = 主线程不标注）；该停顿的全部命令（栈/变量/场景树/展开/编辑/continue）用**暂停线程 id** 发送——协议的 threadId 字段选择命令作用线程，错误 id 以静默应答（已 pin，`.context/t10/facts.md`）。任意线程暂停时游戏整体暂停；协议不暴露按线程过滤断点。
- **变量编辑仅限首个停顿、顶层或嵌套路径、标量值**——`scene:set_object_property` 只在首个有帧的停顿执行。`property` 接受**嵌套路径**：裸属性名编辑解析到的对象（顶层或经容器成员到达的任意对象）上的该属性；容器成员（`arr[0]`、`dict["k"]`、`arr[0][1]`）则**重建整个最外层容器**（应用修改后写回所属属性——源插件 `changes_parent` 语义；已 pin，`.context/t14/facts.md`——整数组/字典重建持久、长度跟随写入、数学类型成员往返、StringName 键保留）。含对象引用或 NodePath/Callable/Signal 值的容器**不可重建**——引擎会静默拒绝此类写入（事实 7）——这类编辑在发送前即显式失败并给出可读 detail，而非静默无效。只写标量值（`int`/`float`/`string`/`bool`；标量变量本身没有对象 id，引擎也没有对应机制）。引擎对 set **无协议级确认**（已 pin，`.context/t6/facts.md`），每条编辑经 re-inspect 并比对值来验证；失败的写入（属性不存在、只读属性、类型不匹配）在协议层静默，呈现为逐条 `failed` 结果并标记 `editsTruncated`。`int` 值按引擎式截断解析（`12.5` → `12`）适用于类型化属性；未类型化容器成员无强制转换（事实 4）。运行中的游戏也会接受写入，但工具只在暂停态应用编辑。
- **对象展开仅限首个停顿、递归、去重、repr 感知**——`scene:inspect_object` 只在首个有帧的停顿对顶层对象值执行；当 `maxExpandDepth > 1`（默认 2）时，属性值内的 ObjectId（直接成员、数组元素 `arr[i]`、字典值 `dict["k"]`）以定位路径名递归展开，同一 id 同时出现在顶层与嵌套时只展开一次（顶层优先）。深度超过 `maxExpandDepth` 的对象保持 `Object<id>` 占位。声明 `__repr__` 成员的对象以其值作为显示名（`thing = Thing(hero) [RefCounted]`，已 pin `.context/t13/facts.md`），对已展开对象的引用（属性值与数组预览）同样解析其 `__repr__`——源插件经 VariablesManager 惰性解析；一次性工具只解析已展开对象，属记录在案的差异。无响应的对象被跳过并标记 `expansionTruncated`（非暂停态的游戏不响应——已 pin）。展开的类名为**引擎类**（`get_class()`，如 `class_name Player` 脚本显示为 `Node`），非脚本类名；脚本节点渲染其脚本路径。
- **属性名带引擎分组前缀**——分类标记（usage 128）命名其后属性的分组（已 pin，`.context/t13/facts.md`）：展开渲染 `Node/process_mode`、`Node/script`、`Node/Process = null`（组头行保留显示，对齐源插件），`Members/`/`Constants/` 前缀剥离、烘焙前缀（`Node/path`）保留。**引擎静默拒绝非 `Members/` 前缀的写入标签**（已 pin），因此编辑接受裸名、`Members/` 前缀名或显示的分组前缀名——分组前缀的单段属性名在 set 前经一次额外 inspect 映射到原始属性名（裸名与 `Members/` 名保持 Phase 6 无预查形态）。
- **场景树仅呈现且按有帧停顿快照，但已联动展开/编辑**——`scene:request_scene_tree` 在每个有帧的停顿执行；树渲染为缩进 `name [class] (id)` 行（脚本节点的类为其脚本路径，如 `res://main.gd`，已 pin `.context/t7/facts.md`），每停顿受 `maxTreeNodes` 约束。节点 id 与对象变量**同一 id 空间**（已 pin），因此首个有帧停顿在顶层变量之前展开 `expandNodes` id 与 `nodePaths` 场景路径（如 `Main/Player`，引擎根除外——路径是**稳定的跨调用形式**：launch 模式原始 id 每次运行随机，且被 attach 的游戏只拨一个调试服务器、id 无法跨调用复用，已 pin T4.0/T11.0）；`edits` 的 target 同样接受 `node:<id>` 或 `path:<场景路径>`（无法解析的路径保持原 target，以标准 not-editable detail 失败）。`break` 暂停上报仅根节点的树（引擎行为，非错误）。
- **attach 需要显式端口与正确的启动顺序**——调用方必须预知端口，且游戏必须在工具调用之后启动：Godot 不重试失败的调试器连接（已 pin，`.context/t4/facts.md`）。`pauseOnAttach` 停顿提供「游戏此刻在做什么」探测。
- **attach 命中依赖游戏再次执行到目标行**——动态断点不回退已执行代码；可配合 `pauseOnAttach` 或瞄准会再次运行的代码。
- **attach 假设项目与运行中的游戏一致**——调试协议没有工作区握手；`path` 错误会产生永不命中的断点（运行报告 `stops: []`）。
- **一个游戏一个调试器——attach 与 Godot 编辑器调试器不能共享游戏**——游戏启动时只拨一个调试服务器（`--remote-debug`；传多个参数时最后一个生效）。空闲的 Godot 编辑器不绑定任何调试端口，因此编辑器运行时 attach 不受影响（已 pin，`.context/t11/facts.md`）；指向编辑器默认端口（6007）的游戏会打印一次 `Remote Debugger: Unable to connect` 并照常运行。只有编辑器自己启动（F5）的游戏才由它调试，而这些游戏无法 attach。attach 到被其他服务器持有的端口会快速失败并返回 `GODOT_UNAVAILABLE`（`could not bind port …: EADDRINUSE`）。
- **多线程停顿延后**——launch/attach 覆盖脚本化逐停顿快照；原始协议事实（`.context/t3/facts.md`）为这些路径保留依据。
- **harness 崩溃可能遗留孤儿 godot 进程**——工具在 teardown 时终止进程树；harness 骤然死亡仍可能遗留自起游戏进程。attach 模式下骤然死亡只是 detach：游戏自动恢复运行（断开从不使其保持暂停，已 pin）。
