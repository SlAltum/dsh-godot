# Godot UI 插件（动态 Cordis 插件部署示例）

Godot 的 UI 能力以**动态 Cordis 插件**形式提供，零侵入 dsh 本体（`ui-settings-plugins` 等 client 包不含任何 godot 代码）。

## 能力

| UI | Slot | 说明 |
|---|---|---|
| godot 设置卡片 | `settings.plugin.item`（id `godot`） | 编辑 `godot` 设置命名空间的 `executable` / `gdformatExecutable`，保存即对下一次工具调用生效（宿主每次 execute 重读设置） |
| `godot_debug` 工具卡 | `tool.call.toolview`（key `godot_debug`） | godot_debug 调用的专属展示（未注册时走 generic 工具卡） |

## 加载

- **会话内**：`cordis_define` 定义（host 面 = `applyHost`，client 面 = `applyClient`），`cordis_run` 激活。
- **部署**：按部署环境的插件加载方式引入本文件（动态插件机制）。

## 能力边界（cordis-client-runner）

- Client 面纯 JS：无 JSX/TS/import——`React` 闭包符号、CSS 经 `styles.insert`、主题色用 `var(--dsw-*)`。
- 必须声明 `inject`：`slots`（UI 座位入口）+ `settingsScope`/`connection`/`remote`（设置卡片读写）。
- 注册包在 `ctx.slots.inject(key, () => ctx.slots.register(...))` 内（slot 随声明条目生命周期存在）。
- 本仓库开发环境 GUI 页面无应答时无法端到端验证 UI，需在有响应的部署中加载确认。

## 历史

2026-08-27：从 dsh 本体 `ui-settings-plugins` 移除 godot 卡片（发布破坏修复——未跟踪卡片文件不进发布包而引用改动会进，导致安装失败），UI 改为本动态插件形态。
