# Agent Note：ego-godot 可视化沙盒（tool-godot-ego）

Status: implemented

[English](godot-ego-sandbox.md) | 中文

## 问题

Godot 家族能校验、格式化、解析与脚本调试项目，但**看不见**运行中的游戏。`godot_run_scene` 是一次性的（跑 N 帧、拿 stdout、进程结束），`godot_debug` 停在断点、输出是文本。因此 UI 布局、动画手感与物理相关的问题只能靠改代码、跑一次、再从 `print` 行猜。

## 决策

新增 `packages/godot/tool-godot-ego`（`@deepseek-ai/dsh-tool-godot-ego`，host-only）：每个 workspace 一个持续运行的游戏进程，包装成 21 个模型工具，外加条件注册的 `godot_eval`。

**注入零足迹。** 临时 `boot.gd` `SceneTree` 替换项目主循环，注入一个从项目外加载的桥接节点，然后切到主场景——`godot_play` 给了 `scene?` 时切 `DSH_EGO_SCENE`。端口与口令走环境变量，绝不进 `--` 之后的 argv，游戏自身的参数解析不受影响。`project.godot` 与所有 `res://` 文件逐字节不变；引擎写的 `.godot/` 导入缓存是唯一例外。

**会话是可组合性的单位。** 按 workspace 键控的注册表发布 `godot.egoSessions`；插件 fiber 的逆销毁全部会话——关 socket、终止进程、删除临时脚本。工具注册在 `ctx.inject(['tools'])` 内，取帧工具在 `ctx.inject(['attachments', 'llm'])` 内，观察窗路由在 `ctx.inject(['webServer'])` 内，因此缺少这些服务的部署仍得到完整的沙盒。一次 `godot_play` 要么进入 `ready`，要么整条回滚；重复 `godot_stop` 是安全的，返回 `stopped: false`。

**Godot 以一个可选 bundle 安装。** `dsh-base` 与 `dsh-web-app` 都不挂载 Godot 行；`packages/godot/bundle-godot`（`@deepseek-ai/dsh-godot-bundle`）作为一层 profile patch 一次插入五行——工具、LSP、调试器、沙盒与浏览器界面。设置卡注册 `plugins.bundle.config`、以 bundle 名为键，因此跟随已安装的包，出现在其插件页的“已安装插件”下，而不是内置配置列表。不安装该 bundle 的部署没有 Godot 工具、schema 或提示片段。

**协议是换行分隔 JSON。** 桥接保持 `PROCESS_MODE_ALWAYS`，暂停的游戏仍能应答；画面只取进内存（`save_png/jpg/webp_to_buffer`）；帧比较用引擎的 `compute_image_metrics`；属性读取走 `get_property_list`，只保留存储属性与脚本变量；输入经 `Viewport.push_input` 注入。错误码由本包自有（`EgoGodotError`，八码），不扩展 `tool-godot` 的封闭码表。

**工具面。** 会话：`godot_play` / `godot_stop` / `godot_scene` / `godot_status`。观察：`godot_see` / `godot_state` / `godot_node` / `godot_find` / `godot_diff` / `godot_logs` / `godot_actions`。操作：`godot_click` / `godot_key` / `godot_type` / `godot_fill` / `godot_check` / `godot_hover` / `godot_drag` / `godot_scroll` / `godot_wait` / `godot_wait_for`。`godot_eval` 只在 `allowEval: true` 时存在。与浏览器沙盒的对齐按能力记录：表单控件映射到 `godot_fill` 与 `godot_check`；`godot_wait_for` 增加 `path` + `exists` 的等元素出现/消失形态；hover 与 scroll 接受 Control 路径。选择（`godot_select`）需要引擎侧改值并触发信号，留给推迟的属性写入阶段；浏览器专属的运行时能力（登录导入、CAPTCHA、对话框、下载、HTTP、原始 CDP、任意脚本）在 Godot 没有对应物。

## 说明

- **类型检查归 schema。** 参数 schema 已拒绝非有限数、非整数与非二元数组，工具不再在 `execute` 里重复这些校验；只保留语义守卫（非空文本、非零滚轮 delta、正步数、`res://` 场景路径）。重复的运行期守卫不可达，还会让逐文件分支门禁失败。
- **`godot_status` 只读 host 侧。** 它投影会话句柄上可选的 `snapshot?()`。真实会话总是提供；没有该能力的自定义 factory 报告 `state: "unknown"`，而不是编造生命周期状态。注册表会保留已丢失的会话直到 `godot_stop`，因此丢失原因仍可读。
- **`godot_wait_for` 轮询，不改桥接。** 它读取状态字段（`frames`、`fps`、`nodeCount`、`paused`、`scene`）或单个节点属性，用 `Object.is` 比较；超时带上最后观测值，拼错属性也能诊断。`path` + `exists` 形态覆盖等节点出现/消失，对应浏览器的 selector 等待。
- **表单工具组合输入并回读校验。** `godot_fill` 点击、发 Ctrl+A、输入、读回 `text`；`godot_check` 先读 `button_pressed`，只在状态不同才点击。校验不是可选项：游戏没有可信的 DOM 值，静默不匹配会让模型学到错误状态。
- **滚轮按下必须补发抬起。** 真机 Godot 4.7.2 pin：只发 `pressed` 滚轮事件会让 GUI 状态卡住，下一次左键点击不再切换控件，因此桥接补发匹配的抬起。冒烟里保留「滚轮→勾选」序列，正是它抓到了这个问题。
- **`godot_scene` 与 `godot_play.scene` 共用 `change_scene_to_file`。** 切换不重放项目自身的启动逻辑；README 已写明。
- **`godot_diff` 需要上一帧。** 桥接与最后一张已取帧比较，因此工具写明「先调 `godot_see`」，并原样透传桥接的 `REJECTED` 应答。
- **取帧工具会降级。** 没有附件存储或视觉路由时返回文本与落盘路径；有则返回图片内容块加帧元信息。
- **观察窗是带自己定时器的浏览器客户端。** `ui-godot` 注册 `shell.overlay` 悬浮球，轮询 `/api/godot/sessions`、拉 `/api/godot/view`，并把画面点击转发到 `/api/godot/input`。球与面板用指针事件拖动，位置记在 `localStorage`；面板打开时吸附到球旁。Chrome 拒绝以方法形式调用全局定时器（`this` 必须是 `globalThis`），而该异常会让整个 client fiber 在启动时 failed，因此控制器用 `globalThis.setInterval`/`clearInterval` 包装，并用回归测试钉住 receiver；观察窗注册失败也只记日志，不再让插件失败。`/api/godot` 端点因 web server 没有鉴权层而自行把关：回环 + 同站。
- **`allowEval: false` 是误用面，不是安全边界。** agent 仍能写 `.gd` 文件；该门禁的目的是让模型默认不去做任意表达式求值。

## 测试

- 21 个 spec、217 个单测，按工具族组织，覆盖参数默认值与覆盖、渲染、桥接拒绝与无会话路径。真机冒烟由 `DSH_TEST_GODOT` 门控。`ui-godot` 客户端套件另有 46 个测试，含定时器 receiver 回归。
- 每个源文件覆盖率 100%；不可达分支被删除而不是被忽略，新模块没有新增 `v8 ignore`。
- 冒烟链路 play、观察、读取、操作、stop，现在还在真实 Godot 4.7.2 上覆盖 status、scene、actions、find、diff、wait_for（含节点出现）、hover、scroll、type、drag、check 与 fill（连续两次，证明是替换而非追加）。
- 门禁：`tsc -b` 0、oxlint 0、`vitest` 217 passed + 1 skipped、覆盖率 100%、README 配对一致、工具目录与配置目录中英双侧重跑。
