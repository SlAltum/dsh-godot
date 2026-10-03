# @deepseek-ai/dsh-ui-godot

[English](README.md) | 中文

Web 插件配置界面（设置 → Plugins）中的 **Godot 设置卡片**。浏览器插件注册一个以 `godot` 为键的本地化 `settings.plugin.item` 贡献；"插件"分区拥有卡片槽位与外壳。卡片通过客户端 settings scope 读写 `godot` 设置命名空间——命名空间本身由宿主侧的 [`tool-godot`](../tool-godot/README.zh.md) 包注册，因此本包不携带任何宿主代码；当部署未组合 tool-godot 时，卡片渲染为空。

本包是动态 UI 插件（`docs/ui-plugin-godot.js`）所提供设置卡片的**持久化**替代品：作为部署组合中的 `dsh.client` 行，它能挺过 dsh web 进程重启，而进程内存态的动态插件做不到。动态插件的调试工具卡（键 `godot_debug` / `godot_debug_session`）不在范围内；本次只迁移设置卡片。

## 设置

卡片编辑 `godot` 命名空间的四个字段：

| 字段 | 含义 |
|---|---|
| `executable` | Godot 编辑器路径或 PATH 命令名；留空使用默认命令 `godot`。 |
| `gdformatExecutable` | gdformat 工具路径或 PATH 命令名（后端为 `gdformat` 时使用）。 |
| `formatBackend` | `godot_format` 后端：`gdformat` 或 `builtin`。 |
| `timeoutMs` | 协作式工具调用预算（毫秒，仅限数字；留空使用默认值）。 |

卡片暂存用户输入，仅在点击**保存**时写入；宿主是接受与否的唯一权威，未落盘的保存会保留草稿供修正。用户层携带的字段显示**已覆盖**标记与**重置**控件；清空字段后重新继承组合层。命名空间不可用时卡片渲染为空，首个分区到达前显示加载提示，只读文档下禁用全部控件。

## 模型体验

无：卡片只编辑浏览器侧设置，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 部署

在部署组合中添加一行 `dsh.client`：

```yaml
- id: ui-godot
  name: '@deepseek-ai/dsh-ui-godot'
```

需要宿主提供 `godot` 设置命名空间（由 `tool-godot` 包注册）；标签页只为宿主实际提供的命名空间分发卡片。

## 已知限制与暂缓事项

- **仅设置卡片** —— 调试工具卡仍由动态 UI 插件（`docs/ui-plugin-godot.js`）提供；待有部署挂载 `tool-godot-debug` 后再迁移。
- **无宿主代码** —— 命名空间、其 schema 与默认值由 `tool-godot` 持有；本包无法改变宿主提供的内容。
