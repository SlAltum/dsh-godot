# Agent Note：把 godot 设置卡持久化为客户端包（ui-godot）

Status: implemented

[English](2026-08-28-godot-ui-card.md) | 中文

## 问题

去侵入工作完成后，godot 设置卡住在**动态 Cordis 插件**（`docs/ui-plugin-godot.js`）里。动态插件是 dsh web 运行时的进程内存态：页面刷新、新会话存活，但 dsh web 进程重启即失。2026-08-19 两次重启后卡片消失（宿主侧 `godot` 命名空间与数据完好，只是浏览器侧 UI 注册没了）。用户否决了 tool-cordis（进程内重定义插件的工具）作为重载机制——agent 常驻进程内定义插件的信任面被拒绝——改为持久客户端插件包。

## 决策

新包 `packages/godot/ui-godot`（`@deepseek-ai/dsh-ui-godot`），纯浏览器客户端包，注册为 `dsh.client` 行（按构造挺过重启）。v1 只移植设置卡（`settings.plugin.item`，key `godot`）——调试工具卡（`godot_debug` / `godot_debug_session`）在本部署依赖未挂载的 `tool-godot-debug`，留在动态插件。零宿主代码：`godot` 命名空间归 `tool-godot` 所有；卡片经 `ctx.settingsScope.bind({ namespace: 'godot' })` 读写。

结构：`godot-card-form.ts`（自包含暂存表单——参照 `CardForm` 是 `ui-settings-plugins` 包内私有，不可 import）、`godot-card-controller.ts`（scope → 表单 → `hooks.godotCard` 快照 store）、`GodotCard.tsx`（四 shares props + 自写外壳，`--dsw-*` token）、`locales.ts`（zh 文案逐字取自动态插件 v2.3 + en 镜像）。注册走 `ctx.slots.inject('settings.plugin.item', ...)`，选项仅 `{ key: 'godot' }`——动态插件的 key+id 双写桥接是给落后于工作区源码的部署 bundle 的兼容措施；与源码同树构建的包只需当前 keyed 契约。

三面注册，缺一不可：根 `tsconfig.client.json` references 条目；`packages/bundle/web-app/cordis.patch.yml` 浏览器 roster 行（`- id: ui-godot` / `name: '@deepseek-ai/dsh-ui-godot'`）；`packages/bundle/web-app/package.json` 依赖（`workspace:^`）。`pnpm-workspace.yaml` 已 glob `packages/*/*`。

## 备注

- `settings.plugin.item` 的 SlotMap 条目由声明方（`ui-settings-plugins/src/client/slot-contract.ts`）声明；本包用 type-only import（`@deepseek-ai/dsh-client-ui-settings-plugins/client`）拉入 merge——不跨 client bundle purity gate（type-only import 会被擦除）。
- 命名空间不可用时卡片渲染为空（对齐插件卡外壳）；加载与只读提示来自表单 shell（`available` / `loading` / `writable`）。
- `selectField` 要求非空元组类型（`readonly [string, ...string[]]`），使兜底值全类型化、无需非空断言（oxlint 禁 `!`）。
- 动态插件的设置卡注册在同时组合 `ui-godot` 时自行降级（同 key 撞 → 其 try/catch）；文档建议只保留其一。

## 测试

- 5 个 spec 共 44 测试：暂存表单语义（22）、jsdom 组件行为（12）、真实 tsdown bundle 形状含真实 SlotRegistry ring 上的挂载注册（3）、apply 接线与 teardown（4）、invariant companion（1）。
- 包源码覆盖率 100%（唯一 ignore 是防御性无 hint 渲染路径，带理由）。
- 客户端聚合 `tsc -b tsconfig.client.json` 绿；oxlint 0；`verify-cordis-config` 122 个配置文件通过；README pairing 用本地 `.context/verify-pairing.mjs` 验证（沙箱内 tsx 包装 EPERM）。
- 端到端目视需重启 dsh web（模块表启动时组合）——部署侧步骤，已记入计划。
