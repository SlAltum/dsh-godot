---
description: "Godot 浏览器界面：`godot` 命名空间的设置卡片，以及流式显示沙盒实时画面的悬浮观窗。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ui-godot

[English](README.md) | 中文

**Godot 浏览器界面**：Godot bundle 插件页上的设置卡片，以及运行中游戏的浮动观察窗。设置卡片注册一个以 `@deepseek-ai/dsh-godot-bundle` 为键的本地化 `plugins.bundle.config` 贡献；观察窗在 `shell.overlay` 注册一个实时取帧的悬浮球。两者都只存在于浏览器半边。宿主接缝归 [`tool-godot`](../tool-godot/README.zh.md)（设置命名空间）与 [`tool-godot-ego`](../tool-godot-ego/README.zh.md)（`/api/godot` 端点）所有。本包由可选的 [`dsh-godot-bundle`](../bundle-godot/README.zh.md) 安装，不再随 `dsh-web-app` 发布；没有该 bundle 时，这个客户端半边不会加载。

源码入口：[`src/client/index.ts`](src/client/index.ts)——设置卡与观察窗注册。

本包是动态 UI 插件（`docs/ui-plugin-godot.js`）所提供设置卡片的**持久化**替代品：作为 Godot bundle 的 `dsh.client` 行，它能在 dsh web 进程重启后继续存在，而进程内存态的动态插件不能。动态插件的调试工具卡（键 `godot_debug` / `godot_debug_session`）不在范围内；本次只迁移设置卡片。

设置卡与观察球使用 Godot logo。随包携带的 `src/client/assets/godot-logo.svg` 是 `godot-vscode-plugin` 的 `resources/godot_icon.svg` 未修改副本；Godot logo 版权归 Godot Foundation，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可。

## 概述

在插件页面编辑 `godot` 设置，并在不离开会话的情况下观看运行中的沙盒游戏：卡片在 Godot bundle 页面注册一个本地化配置项，悬浮球打开可点击操作的实时画面。两部分都随可选 bundle 交付——没有该 bundle 时这个客户端部分不会加载——其背后的宿主 seam 属于 `tool-godot` 与 `tool-godot-ego`。

## 目录

- [设置](#settings)
- [观察窗](#watch-panel)
- [部署](#deployment)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="settings"></a>
## 设置

卡片编辑 `godot` 命名空间的四个字段：

| 字段 | 含义 |
|---|---|
| `executable` | Godot 编辑器路径或 PATH 命令名；留空使用默认命令 `godot`。 |
| `gdformatExecutable` | gdformat 工具路径或 PATH 命令名（后端为 `gdformat` 时使用）。 |
| `formatBackend` | `godot_format` 后端：`gdformat` 或 `builtin`。 |
| `timeoutMs` | 协作式工具调用预算（毫秒，仅限数字；留空使用默认值）。 |

卡片暂存用户输入，仅在点击**保存**时写入；宿主决定是否接受，保存未落盘时卡片保留草稿供修正。用户层携带的字段显示**已覆盖**标记与**重置**控件；清空字段后重新继承组合层。命名空间不可用时卡片渲染为空，首个分区到达前显示加载提示，只读文档下禁用全部控件。

<a id="watch-panel"></a>
## 观察窗

悬浮球固定在界面右下角（`shell.overlay`）并始终可见，部署因此能看出沙箱已安装。圆点表示状态：灰色空闲、绿色运行中、橙色已断开、红色端点错误。点击它展开面板，显示会话 id 与状态、实时画面，以及一个可点击操作的游戏画面区。悬浮球与面板都可拖动（面板拖标题栏）；位置写入 `localStorage`，窗口缩放时收进视口，面板每次打开都会吸附到悬浮球旁边。

画面来自宿主的 MJPEG 流（`/api/godot/view?session=...`，640 宽 JPEG、每 200ms 一帧；客户端背压时宿主跳过该帧）。点击画面时把显示矩形映射到会话窗口尺寸，再 POST `/api/godot/input`，因此落点与用户指向的游戏坐标一致。面板每 1.5s 轮询 `/api/godot/sessions`；该列表从不请求游戏。在 `tool-godot-ego` 挂载且 `godot_play` 启动会话之前，面板显示空闲提示，悬浮球保持灰色。

`/api/godot` 端点在宿主侧受保护：回环地址与同站校验（`Sec-Fetch-Site`/`Origin`），或部署配置的固定 token。同源浏览器无需 token。

<a id="deployment"></a>
## 部署

安装可选的 [`dsh-godot-bundle`](../bundle-godot/README.zh.md)；它会连同 `tool-godot` 与 `tool-godot-ego` 一起插入 `ui-godot` 行：

```bash
dsh plugin install link:D:/source_code/deepseek-harness/packages/godot/bundle-godot
```

自定义组合也可以直接加行：

```yaml
- id: ui-godot
  name: '@deepseek-ai/dsh-ui-godot'
```

设置卡渲染在 Godot bundle 的页面上。宿主必须提供 `godot` 设置命名空间（由 `tool-godot` 包注册）；卡片只为宿主实际提供的命名空间渲染。观察窗还需要宿主挂载 [`tool-godot-ego`](../tool-godot-ego/README.zh.md)（它提供 `/api/godot/*`），并要求 shell 声明 `shell.overlay`（由 `dsh-client-ui-layout` 拥有）；没有宿主插件时，悬浮球保持空闲并显示端点错误提示。安装或移除这两个包后都需要重启 dsh web，模块表才会包含它们。

<a id="model-experience"></a>
## 模型体验

无：设置卡与观察窗只编辑浏览器侧设置、渲染宿主状态，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **调试工具卡仍是动态插件** —— `godot_debug` 卡片视图仍在 `docs/ui-plugin-godot.js`；待有部署挂载 `tool-godot-debug` 后再迁移。
- **观察窗依赖宿主插件** —— 客户端始终渲染悬浮球，但画面与点击转发需要 `tool-godot-ego`；未挂载的部署显示空闲/错误状态。
- **每个 workspace 一个预览** —— 面板显示第一个运行中的会话；宿主当前强制每 workspace 单会话。
- **无宿主代码** —— 命名空间、其 schema 与默认值由 `tool-godot` 持有；本包无法改变宿主提供的内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包是动态 UI 插件原先挂载的设置卡片的持久替代：作为 `dsh.client` 行，它能经受 `dsh web` 重启。logo 从 `src/client/assets` 交付，因此 manifest 必须保留 `./assets/*` 导出与 `files` 中的 `lib/assets`，否则客户端 bundle 无法解析它。

</details>
