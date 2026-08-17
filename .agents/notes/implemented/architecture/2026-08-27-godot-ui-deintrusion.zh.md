# Agent Note：移除 dsh 本体的 godot UI 侵入（ui-settings-plugins）

Status: implemented

[English](2026-08-27-godot-ui-deintrusion.md) | 中文

## 问题

未提交的工作把 godot 专属设置卡片（`GodotCard.tsx`、`godot-card-controller.ts`——均为**未跟踪**）嵌进了 `packages/client/ui-settings-plugins`，已跟踪文件的改动（`src/client/index.ts` 无条件注册卡片、`locales.ts` 的 godot 键、三个测试文件）引用它们。发布即损坏：已跟踪的引用改动会进发布包，而未跟踪的卡片文件不会——安装后 `import { GodotCard }` 失败。且无论宿主是否安装 godot 包，dsh 本体 UI 都永久携带 godot 专属组件。

## 决策

整体移除侵入（git checkout 还原 5 个已跟踪文件 + 删除 2 个未跟踪文件——引用方与被引用方均未提交，无断链；该包 77 个测试恢复全绿）。godot UI 改为**动态 Cordis 插件**形态（godot 仓库 `docs/ui-plugin-godot.js`）：`settings.plugin.item` 卡片（经 `ctx.settingsScope.bind` 编辑 `godot` 设置命名空间）+ `tool.call.toolview` 的 `godot_debug` keyed 工具行——本体零足迹、与 godot 仓库完全内聚。

## 备注

- `tool.call.toolview` keyed slot 是工具专属卡的标准加法路径（bash/read/edit/web 先例）；未声明的 key 走 generic 卡兜底。
- 动态 Client 面约束：纯 JS（React 以闭包符号到达、CSS 经 `styles.insert`、主题用 `var(--dsw-*)`）、必须声明 `inject: ['slots']`、注册包在 `ctx.slots.inject(key, () => ctx.slots.register(...))` 内、`settingsScope.bind` 需注入 `connection` + `remote`。
- 本环境 GUI 页面不应答 client Inspect 查询（会挂起）；全部契约改从源码读取（`ui-tool` toolviews + slot-catalog 的动态注册示例）。

## 测试

- 本体恢复：`ui-settings-plugins` 77/77 测试、`git status` 干净。
- 动态插件 UI 在本环境无法端到端验证（页面无应答）；其注册逐字对齐 slot-catalog 示例与既有卡片先例。
