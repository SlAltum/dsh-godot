# @deepseek-ai/dsh-tool-godot-ego

[English](README.md) | 中文

Godot 项目的**可视化沙盒**：`godot_play` 启动一个持续运行的游戏进程，并在两次工具调用之间保持存活，因此模型可以**看见**一帧画面、**读取**场景与实时属性、用鼠标、键盘与等待**操作**游戏，最后**停止**它。默认注册 21 个工具；只有 `allowEval` 打开时 `godot_eval` 才加入。

源码入口：[`src/index.ts`](src/index.ts)——插件入口（服务、工具、提示段落、观察窗路由）。

沙盒对项目**零足迹**：临时 `SceneTree` 替换游戏主循环，桥接节点从项目外加载，`project.godot` 与所有 `res://` 文件逐字节不变。端口与口令走环境变量，画面只保存在内存中，游戏进程归会话所有，而不是 harness 的任务运行时。

本包注入 `tools`、`subprocess`、`systemPrompt`；取帧工具还要求 `attachments` 与 `llm` 已挂载才出现，观察窗路由只在 `webServer` 存在时注册。

```ts
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodotEgo from '@deepseek-ai/dsh-tool-godot-ego'

// A deployment points at its godot install; the default resolves `godot` on PATH.
export async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodotEgo, { executable: 'C:\\Godot\\godot.exe' })
}
```

## 工作原理

`godot_play` 解析项目根；`.godot/` 缺失时先跑一次 `--headless --editor --import`；把两个 GDScript 文件（`boot.gd`、`bridge.gd`）写到项目外的临时目录；绑定 `127.0.0.1:0`；再 spawn `godot --path <root> --script <boot.gd> --windowed --resolution 1280x720 [--position -32000,-32000] [--max-fps N | --fixed-fps N]`。boot 脚本把桥接注入根节点，然后切到项目主场景——`godot_play` 传入场景时，改切到 `DSH_EGO_SCENE`。桥接回连，带会话口令与协议版本发 `hello`，此后应答换行分隔 JSON。桥接保持 `process_mode = PROCESS_MODE_ALWAYS`，因此自行暂停的游戏仍能应答 `state` 与 `shot`。

游戏在正常的原生窗口里运行，这个窗口就是可直接操作的场景窗口；只想看 Web 面板时用 `offscreen: true` 把它移出屏幕。沙盒请求可见窗口；在 Windows 上，本地提供方对这种请求改走直接的 Node spawn 路径，因为原生 Job runner 总是隐藏目标窗口。该路径保留进程树清理，但不使用原生 Job 约束。Web 观察窗镜像同一帧画面，仍然可选。

画面在引擎内截取（`RenderingServer.frame_post_draw` → `get_viewport().get_texture().get_image()`），编码成 PNG/JPEG/WebP buffer 后以 base64 回传；桥接从不写游戏文件系统。`shotdiff` 用 `compute_image_metrics` 把当前帧与上一帧比较，宿主因此不需要图片解码依赖。输入通过 `Viewport.push_input` 注入（同步且限定在游戏视口）；节点读取走 `get_property_list`，只保留存储属性与脚本变量，值用显式 `typeof()` 分派序列化。

一个 workspace 至多一个会话。`godot_stop` 让桥接退出，在 `graceMs` 内等待，超时后升级为终止，并报告真实退出码或信号。dispose 执行同一套反向清理，并删除临时脚本；会话注册表以 `godot.egoSessions` 发布，它自身的清理逻辑在插件卸载时销毁全部会话。

## 宿主端点

`webServer` 挂载时，插件在 `/api/godot` 下为观察窗提供服务：

| 端点 | 方法 | 行为 |
|---|---|---|
| `/api/godot/sessions` | GET | 列出 `{ sessionId, state, pid, window, lostReason }`；从不请求游戏。 |
| `/api/godot/view?session=<id>` | GET | 640 宽 JPEG 的 MJPEG 流，每 200ms 一帧，背压时跳过。 |
| `/api/godot/input` | POST | 把一次 `{ session, x, y, button?, double? }` 点击转发给会话。 |

web server 自身没有鉴权层，因此端点在本地校验：请求必须来自回环地址且不是跨站请求（`Sec-Fetch-Site` / `Origin`），或者携带部署配置的固定 `token` 查询参数。[`ui-godot`](../ui-godot/README.zh.md) 里的观察窗是同源的，无需 token。

## 系统边界

沙盒观察的是真实进程，因此部分效果只能**补偿，无法撤销**：

- **游戏进程一旦启动，就无法当作没启动过。** 可以终止，但不能撤销历史；工具如实报告退出事实。
- **已投递的图像与日志不可撤回。** `godot_see` 报告帧号，`godot_diff` 与桥接保留的上一帧比较；`godot_logs` 按游标增量读取，不改写历史。
- **`.godot/` 导入产物由引擎写入。** 它属于 Godot，不属于本包，dispose 不会删除。
- **外部前提是环境，不是效果。** Godot 二进制、工程文件与显卡驱动是部署事实；缺失或不兼容会以结构化错误码失败。
- **`allowEval: false` 不是安全边界。** 它去掉一个误用面——agent 仍能写 `.gd` 文件——降低的是误伤概率，不是有意的逃逸。

## 设置

本包不注册设置命名空间；可执行文件与各项上限是组合层配置。`executable` 留空即使用 `tool-godot` 设置卡里的实时值；只有需要用另一个 Godot 构建运行沙盒时才显式设置。

## 配置

每个键都有默认值；部署只覆盖环境需要的那几项。

| 键 | 默认值 | 含义 |
|---|---|---|
| `executable` | 空（继承） | 显式路径或命令名。留空继承 `tool-godot` 的实时值，最后回退 `PATH` 上的 `godot`。 |
| `executableArgs` | `[]` | 插在 godot 可执行文件之后的固定 argv 元素（部署包装）。 |
| `allowEval` | `false` | 注册 `godot_eval` 并允许桥接内 `Expression` 求值。 |
| `offscreen` | `false` | 把窗口放到屏幕外（`--position -32000,-32000`），用于不需要用户看到窗口的部署。 |
| `maxFps` | `60` | 经 `--max-fps` 传入的帧率上限；`0` 保留引擎默认。 |
| `fixedFps` | `0` | 经 `--fixed-fps` 传入的确定性节奏；大于 `0` 时取代 `--max-fps`。 |
| `importTimeoutMs` | `120000` | 一次性导入的预算。 |
| `timeoutMs` | `60000` | 超时策略经 `exec.signal` 强制执行的协作工具预算。 |
| `requestTimeoutMs` | `20000` | 单条桥接命令与握手的预算。 |
| `graceMs` | `5000` | 停止游戏时的终止升级宽限。 |
| `maxNodes` | `200` | `godot_state` 渲染的场景树节点预算；`0` 关闭场景树。 |
| `maxProps` | `40` | `godot_node` 的属性行预算。 |
| `maxWidth` | `1280` | 预览截图宽度（像素）；`0` 关闭缩放。 |

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `godot_play` | `path?`、`scene?`、`offscreen?`、`maxFps?`、`fixedFps?`、`restart?` | 启动或复用本 workspace 的会话；返回 `{ sessionId, pid?, created, running: true }`。 |
| `godot_stop` | — | 让游戏退出、等待、必要时终止；`{ stopped, sessionId?, exitCode?, signal? }`，无会话时 `stopped: false`。 |
| `godot_scene` | `path?` | 报告当前场景，或用 `change_scene_to_file` 切换；`{ scene, changed, frames? }`。 |
| `godot_status` | — | 宿主侧快照：`{ state, pid?, window?, lostReason?, projectRoot?, imported? }`；从不联系游戏。 |
| `godot_see` | `format?`、`quality?`、`maxWidth?`、`target?`、`region?`、`ifUnchanged?` | 把一帧取进对话；可裁一个 Control 或一个区域；可按需跳过帧号未变的图。 |
| `godot_state` | `tree?`、`targets?`、`maxNodes?`、`diff?` | 场景路径、fps、帧号、节点数、暂停标志、有界场景树、可点击控件与变化清单。 |
| `godot_node` | `path`、`props?`、`maxProps?`、`depth?` | 单个节点的存储属性与脚本变量，支持通配过滤与行预算。 |
| `godot_find` | `name?`、`class?`、`text?` | 对控件清单做大小写不敏感子串搜索；每个条件都必须命中。 |
| `godot_diff` | `useLuma?` | 引擎内帧比较的 `{ mean, mean_squared, peak_snr, frame }`。 |
| `godot_logs` | `since?`、`maxBytes?`、`stream?` | 增量读取 stdout/stderr，并返回下一个游标。 |
| `godot_actions` | — | `{ actions, count }`：项目的 InputMap 动作名。 |
| `godot_click` | `x?`/`y?` 或 `target?`、`button?`、`double?` | 按坐标或控件中心点击；报告消费该事件的节点。 |
| `godot_key` | `key?`、`action?`、`pressed?`、`modifiers?` | 轻敲或按住按键，或按下/松开 InputMap 动作。 |
| `godot_type` | `text` | 向焦点控件逐字符输入文本。 |
| `godot_fill` | `target`、`text` | 替换输入框文本：点击、全选、输入替换内容并校验结果值。 |
| `godot_check` | `target`、`checked?` | 把 checkbox、check button 或单选按钮设为期望状态，只在状态不同时点击。 |
| `godot_hover` | `x`/`y` 或 `target` | 不按键地移动指针，触发 hover 状态。 |
| `godot_drag` | `from`、`to`、`steps?` | 按下、分步移动、松开——滑条、拖放、镜头平移。 |
| `godot_scroll` | `x`/`y` 或 `target`、`delta` | 在指定点或 Control 中心滚动滚轮；正值向下。 |
| `godot_wait` | `frames?`、`ms?` | 在游戏内等待若干帧（默认 5）或墙钟毫秒。 |
| `godot_wait_for` | `path?`、`property?`、`equals?`、`exists?`、`timeoutMs?`、`intervalMs?` | 轮询到状态字段或节点属性严格等于期望值，或等到节点出现/消失；超时报告最后观测值。 |

`godot_eval`（`expression`）仅在 `allowEval: true` 时注册。

## 错误

失败携带本包自有的 `EgoGodotError`（`HarnessError` 子类），以 `{ name, code }` 呈现：

| 码 | 含义 |
|---|---|
| `GODOT_EGO_UNAVAILABLE` | 可执行文件无法运行或部署不可用。 |
| `GODOT_EGO_NO_SESSION` | 本 workspace 没有会话；先调 `godot_play`。 |
| `GODOT_EGO_TIMEOUT` | 握手、某条桥接命令或 `godot_wait_for` 超出预算。 |
| `GODOT_EGO_REJECTED` | 桥接或工具拒绝了请求（未知命令、不可达场景、节点不存在、非 res:// 路径）。 |
| `GODOT_EGO_NOT_IMPORTED` | 一次性导入失败。 |
| `GODOT_EGO_ABORTED` | 调用方取消，或调用进行中销毁了会话。 |
| `GODOT_EGO_STALE_FRAME` | 请求的帧不比已投递的帧新。 |
| `GODOT_EGO_LOST` | 游戏退出、断开或破坏协议；会话不可再用。 |

## 测试

在 monorepo 根运行单元套件：`pnpm exec vitest run packages/godot/tool-godot-ego`。真机冒烟经 `DSH_TEST_GODOT`（Godot 可执行文件路径）按需启用；它用一条链路完成 play、观察、读取、操作与 stop。

`tests/fixtures/gomoku` 是自带的两入五子棋工程，供真机检查使用。用 `godot_play` 启动后，通过 `godot_find` 与 `godot_click` 操作 `Cell_07_07` 交叉点；黑棋连成五子会显示 `Black wins`，`New game` 清空棋盘。每个交叉点都是具名 Button，因此 find、click、node 读取与重置都不依赖图像坐标。完整自测与对弈流程见 [English](tests/fixtures/gomoku/TEST_CHARTER.md) · [中文](tests/fixtures/gomoku/TEST_CHARTER.zh.md)。

## Model Experience

### System prompt

#### What the model sees

插件注册范围内的每个请求都带这段指引。按 agent 隐藏工具 schema 不会移除该段落。

##### Godot visual sandbox guidance (tool:godot-ego)

```markdown
Godot visual sandbox: call godot_play to start the project, godot_see to look at the current frame (crop with target for detail), godot_state for the scene tree and clickable Control paths, godot_click / godot_key / godot_type / godot_fill / godot_check / godot_hover / godot_drag / godot_scroll to operate it, godot_wait or godot_wait_for before the next capture, godot_node for live property values, godot_find to locate a Control by name/class/text, godot_actions for InputMap action names, godot_scene to report or switch scenes, godot_diff to measure visual change, godot_status for the session, godot_logs for print and error output, and godot_stop when done. Prefer clicking by Control path: it is deterministic, while coordinates depend on the window scale.
```

#### Token effect

插件作用域内每个请求一段固定段落；它一次说清 21 个工具与首选的点击通道，模型不必每回合重新发现。

#### KV Cache effect

作用域与段落不变时前缀稳定。激活、销毁或改段落都可能使该提示段之后的复用失效。

### Tool schemas

#### What the model sees

沙盒工具的生成 schema 位于工具目录的锚定小节 [godot tool schemas](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-godot-ego)。未开 `allowEval` 时没有 `godot_eval`；未挂载 `attachments`/`llm` 时没有取帧工具。

#### Token effect

工具可见的每个请求都有固定 schema 成本；21 个小 schema 比一个全量 dump 的 schema 更省。

#### KV Cache effect

工具可见性与定义不变时前缀稳定。

### Results

#### What the model sees

文本结果；`godot_see` 另带一个图片内容块。`godot_state` 渲染头部（`scene res://main.tscn · 60 fps · frame 128 · 12 nodes`）、缩进树行（`Main [Node2D] (1)`）与控件行（`Main/HUD/StartButton [Button] rect=(10,20,100,40) text="Start"`）。`godot_node` 渲染 `name = value` 行并标注截断。`godot_find` 渲染 `N of M Controls match` 后接同样的控件行。`godot_fill` 渲染校验后的文本；`godot_check` 渲染结果状态，必要时附 `(already)` 或 `(did not change)`。`godot_diff` 渲染 `mean 0.5 · mse 0.25 · psnr 32.5 dB · frame 42`。`godot_status` 渲染 `session <id> · <state> · pid <n>`，存在时再跟 `window`、`project`、`lost:` 行。`godot_logs` 返回捕获文本与下一个偏移。`godot_wait_for` 报告 `state.frames = 42 after 120 ms`、`Main/Btn exists after 40 ms`，超时则点名最后观测值。

#### Token effect

受配置预算（`maxNodes`、`maxProps`、`maxWidth`）与工具预算约束；裁切后的 `godot_see` 比整帧小。

#### KV Cache effect

只追加；每个结果延长请求前缀，从不改写早先回合。

### Tool errors

#### What the model sees

失败的调用返回 `Error: <message>`，元数据里带结构化的 `GODOT_EGO_*` 码。消息点明恢复步骤（例如 `call godot_play first` 或 `read godot_state for the available targets`）。

#### Token effect

只有失败的调用增加消息；成功调用不受影响。

#### KV Cache effect

只追加。

## Known Limitations and Deferred Work

- **子窗口不在取帧范围内** —— 根视口纹理不含 `Window` 子节点，因此弹窗或第二个窗口对 `godot_see` 不可见。
- **最小化或完全遮挡时可能不渲染** —— 帧会停在旧画面；`godot_see` 报告帧号，`godot_diff` 与上一张已取帧比较。
- **切换场景不重放启动逻辑** —— `godot_scene` 与 `godot_play.scene` 调用 `change_scene_to_file`，不等价于项目自身的启动路径。
- **DPI 与画布变换会移动坐标** —— 尽量按 Control 路径点击；坐标来自上报的 rect，缩放时可能不同。
- **一个 workspace 一个会话** —— 第二次 `godot_play` 复用运行中的会话，除非给 `restart`。
- **配置重载会销毁游戏** —— 插件 fiber 拥有会话，改变组合设置会停止运行中的游戏。
- **依赖编辑器执行的项目可能需要 `--editor`** —— 依赖 `@tool` 执行的脚本在游戏模式下不受支持。
- **没有音频采集，也没有录制/回放** —— `AudioEffectCapture` 与 `--write-movie` 不在范围内。
- **无头部署会直接失败** —— 沙盒需要渲染器；无头部署得到结构化失败，而不是黑屏帧。
- **日志在量大时可能有损** —— 子进程捕获保留有界窗口；`godot_logs` 会标注滑出内存的游标。
- **`godot_fill` 依赖全选快捷键** —— 它点击输入框、发 Ctrl+A、输入并校验；忽略 Ctrl+A 的自定义输入控件会报告不匹配而不是替换文本（这类控件用 `godot_click` + `godot_key` + `godot_type`）。
- **`godot_select` 未实现** —— 在 `OptionButton`/`PopupMenu` 里选择选项需要引擎侧改值并触发信号，属于推迟的属性写入阶段。
- **没有原始命令逃生口** —— 与浏览器 CDP 工具不同，桥接只暴露固定命令集；`godot_eval`（需 `allowEval`）是表达式级的逃生口。
