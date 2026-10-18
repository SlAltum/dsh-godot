# dsh-godot — 架构

[English](architecture.md) | 中文

[仓库 README](../README.zh.md) 背后的完整模块地图、数据流与协议说明。README 回答"这是什么、怎么用"；本文回答"怎么构建的、为什么"。

## 模块地图

Godot 是可选能力，不属于 harness 核心：`dsh-base` 与 `dsh-web-app` 都不挂载这些行。`bundle-godot/` 是唯一受支持的安装入口——一个 profile bundle，一次插入五行，并把设置卡挂在自己的插件页上。移除该 bundle，工具、LSP 提供方、调试器、沙盒与浏览器界面会一起消失。

| 模块 | 职责 | 从这里开始 |
|---|---|---|
| **bundle** | 可选 profile 层：把能力族一起安装，并承载设置卡；无运行时代码 | [`bundle-godot/README.zh.md`](../bundle-godot/README.zh.md) · `cordis.patch.yml` |
| **tool-godot** | 无头 CLI 工具与 `godot` 设置命名空间 | [`tool-godot/README.zh.md`](../tool-godot/README.zh.md) · [`src/index.ts`](../tool-godot/src/index.ts) |
| **lsp-godot** | GDScript 语言服务器提供方（attach / spawn / auto） | [`lsp-godot/README.zh.md`](../lsp-godot/README.zh.md) · [`src/index.ts`](../lsp-godot/src/index.ts) |
| **tool-godot-debug** | 一次有界的脚本化调试运行，走 Godot remote-debug 协议 | [`tool-godot-debug/README.zh.md`](../tool-godot-debug/README.zh.md) · [`src/index.ts`](../tool-godot-debug/src/index.ts) |
| **tool-godot-ego** | 持续可视化沙盒：play、观察、读取、操作、stop | [`tool-godot-ego/README.zh.md`](../tool-godot-ego/README.zh.md) · [`src/index.ts`](../tool-godot-ego/src/index.ts) |
| **ui-godot** | 浏览器半边：bundle 页上的设置卡与沙盒观察窗 | [`ui-godot/README.zh.md`](../ui-godot/README.zh.md) · [`src/client/index.ts`](../ui-godot/src/client/index.ts) |

每个模块的 README 是该模块的导航入口：写明源码入口、面向模型的能力面，以及改动时容易踩坏的行为。本文只停在模块边界；下面的小节只描述跨模块的数据流与它们依赖的协议事实。

仓库还在各模块代码旁保留 `tests/`，并用 `.context/` 放仅本地的开发资产（探针项目、录制、计划）；两者都不在模块地图里。

## 数据流

**CLI 工具（tool-godot）。** 工具层构建 argv 并校验参数；`ctx.subprocess` 拥有 spawn、进程树终止、环境清洗与有界输出捕获。每次调用都是普通前台 spawn，`exec.signal` 会透传给子进程——协作超时与调用方取消会终止进程树。结果有界（`stdoutMaxBytes`/`stderrMaxBytes`、`validateMaxErrors`），工具会报告截断，绝不静默。

**LSP 导航（lsp-godot）。** provider 通过 TCP 与 Godot 内置语言服务器说 JSON-RPC。查询流程：规范化工作区、读取源码（有界）、确保连接（attach 已运行编辑器的端口，或自起 provider 持有的无头编辑器）、能力协商、transient `didOpen`、发送操作请求、归一化响应（Godot URI + hover 清洗）、`didClose`。连接按 workspace 池化并带序列化队列；中止的查询意味着断开（Godot 忽略 `$/cancelRequest`），下次查询重建连接。`changeWorkspace` 通知与查询工作区不匹配时，以 `LSP_UNAVAILABLE` 使查询失败。

**调试运行（tool-godot-debug）。** harness 侧是 TCP **服务器**：预选端口，spawn `godot --headless --path <root> --remote-debug tcp://127.0.0.1:<port>`，游戏连入。帧为 `[u32 LE 长度][单个 variant 编码数组]`，数组为 `[command, threadId, params]`（Godot ≥ 4.2）。运行管线：等待 `set_pid`（threadId 就绪），然后循环停顿 → 快照 → 继续直至 `maxStops`：每次 `debug_enter` 请求堆栈转储与帧变量、渲染（有界深度/大小）、再 `continue`。`debug_exit` 表示离开暂停状态而非游戏退出；无 `--quit-after` 的无头游戏会持续运行，因此工具终止进程树并等待（`kill → await done`）。每次取消、超时或协议失败都只结束调用一次。

**可视化沙盒（tool-godot-ego）。** 宿主绑定 `127.0.0.1:0`，把 boot `SceneTree` 与桥接节点写入项目外的临时目录，再 spawn `godot --path <root> --script <boot.gd> --windowed`。临时主循环注入桥接后切到主场景；`godot_play` 传入 `scene` 时改读 `DSH_EGO_SCENE`。`project.godot` 与 `res://` 一个字节不动。桥接用环境变量给的端口与口令回连，保持 `process_mode = PROCESS_MODE_ALWAYS`（暂停的游戏仍应答），画面只在内存中取帧，`shotdiff` 在引擎内算指标，节点属性通过 `get_property_list` 读取，输入通过 `Viewport.push_input` 注入。一个 workspace 至多一个会话；dispose 关闭 socket、终止进程并删除临时脚本。`ui-godot` 浏览器半边注册 `shell.overlay` 观察球，轮询 `/api/godot/sessions`、拉 `/api/godot/view`，并把画面点击转发到 `/api/godot/input`。

## 协议事实

以下事实取自真实 Godot 4.7 实测（探针事实是仅本地资产；以下要点即代码与测试所编码的事实）：

- **LSP**：`textDocumentSync` 为 `{ change: 1, openClose: true }`；`positionEncoding` 缺省 utf-16；项目不匹配时，`gdscript_client/changeWorkspace` 在 initialize 响应前通告；忽略 `$/cancelRequest`；hover 带行首 tab（旧版本还有 bbcode 残留）；URI 为 `%3A` 编码。
- **调试器**：游戏连入；帧为单数组 variant（游戏拒绝平铺顶层 variant）；命令需要来自 `set_pid` 的 `threadId`；`debug_enter` 参数为 `[isUserBreakpoint, reason, true, 1]`（用户停顿 `reason === 'Breakpoint'`，脚本错误为错误描述）；`stack_dump` 行号 1-based；`output` 消息携带 `PackedStringArray`（类型 34）；`stack_frame_var` 有第五个 `className` 元素，源插件未使用。

## 移植时修复的源插件 bug

- `encode_String` 把 UTF-16 的 `str.length` 当作字节长度——非 ASCII 路径损坏。已改用 `Buffer.byteLength`；测试含中文 `res://` 路径。
- `encode_variant` 对 `undefined` 写零字节而 `size_variant` 预留 4 字节——尺寸不匹配的帧。编码器现在对 `undefined` 抛错。
- `PACKED_FLOAT64_ARRAY` 用 32 位读取器解码。该分支现在按 64 位读取。

## 测试

测试套件 keyless：codec、帧与控制器测试**回放录制的真实 Godot 字节**（`tool-godot-debug/tests/fixtures/` 里的 `t3-breakpoints.bin`、`t3-error.bin`、`t3-norun.bin`；lsp transcript 在 `lsp-godot/tests/fixtures/t0-responses.json`），因此 CI 无需 Godot 二进制。REAL-composition 测试 boot 完整进程内链路（工具 → subprocess seam → fake godot 可执行 → fake game/server）并断言模型可见输出、snapshot 与 HMR 销毁。`GODOT_EXE` 门控的真机冒烟对真实 Godot 4.7 运行调试工具（两个断点、堆栈/变量、输出）。验证环境：Windows 11、PowerShell 7、Godot 4.7、Node.js 24、DSH 0.1.0-rc.5（见 README「测试环境」）。

### 部署环境注意

- **`user://` 必须可写。** user 数据目录无法创建时游戏模式崩溃（信号 11 / 0xC0000005）；沙箱/容器部署必须把 `APPDATA` 重定向到可写目录。
- **无头游戏模式不自动导入。** 缺少 `.godot` 全局类缓存的项目会触发 Parser Error 停顿而非正常运行；先导入一次（`--headless --editor --import --quit`）。
- **首次运行导入延迟。** 无头编辑器/游戏冷启动会导入资源，大项目可能超过 60s 工具预算（配置 `timeoutMs` / `spawnReadyTimeoutMs`）。
- **`--breakpoints` 值无法转义逗号**（Godot 按 `,` 分割）。
- **取消语义。** 游戏忽略 `$/cancelRequest`（LSP）——取消意味着断开；下次查询重建连接。调试器侧取消意味着终止游戏进程树并等待。
