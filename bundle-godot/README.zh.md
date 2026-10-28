---
description: "可选的 Godot bundle：一行 profile 配置同时安装五个 Godot 包，也同时移除它们。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-godot-bundle

[English](README.md) | 中文

Godot 能力族的可选安装包。DSH **不**默认发布 Godot：`dsh-base` 与 `dsh-web-app` 都不含 Godot 行，只有项目确实使用 Godot 时，profile 才安装这个 bundle。移除它，Godot 工具、LSP 提供方、调试器、沙盒与浏览器界面会一起撤下。

图标为 Godot logo（© Godot Foundation，CC BY 4.0），取自 `godot-vscode-plugin` 的 `resources/godot_icon.svg`。

源码入口：[`cordis.patch.yml`](cordis.patch.yml) 是 bundle 层；[`src/index.ts`](src/index.ts) 是无运行时代码的占位模块。

## 概述

用一行配置安装全部 Godot 界面，而不是五行：无头项目工具、GDScript 语言服务器、调试器、可视化沙盒与浏览器设置卡片。移除该行会一并撤销它们，因此不再使用 Godot 的 profile 不会留下残余。部署需要处理 Godot 工程时使用它；与 Godot 无关时跳过，因为 `dsh-base` 与 `dsh-web-app` 不含任何 Godot 行。

## 目录

- [包含什么](#what-it-adds)
- [安装](#install)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="what-it-adds"></a>
## 包含什么

| 行 | 包 | 能力 |
|---|---|---|
| `tool-godot` | [`dsh-tool-godot`](../tool-godot/README.zh.md) | 无头运行、截图、项目检查；设置表单挂在 bundle 页面 |
| `lsp-godot` | [`dsh-lsp-godot`](../lsp-godot/README.zh.md) | GDScript 语言服务器（attach / spawn / auto） |
| `tool-godot-debug` | [`dsh-tool-godot-debug`](../tool-godot-debug/README.zh.md) | 通过 Godot 远程调试协议启动或附加调试 |
| `tool-godot-ego` | [`dsh-tool-godot-ego`](../tool-godot-ego/README.zh.md) | 零侵入可视化沙盒与观察窗 |
| `ui-godot` | [`dsh-ui-godot`](../ui-godot/README.zh.md) | 浏览器半边：设置卡与观察窗 |

<a id="install"></a>
## 安装

从本仓库检出目录把 bundle 装进当前 profile，可用插件页，也可用命令行：

```bash
dsh plugin install link:D:/source_code/deepseek-harness/packages/godot/bundle-godot
```

或在 profile 的 `package.json` 里声明依赖，并加入 `dsh.profile.bundles`：

```json
{
  "dependencies": { "@deepseek-ai/dsh-godot-bundle": "link:D:/source_code/deepseek-harness/packages/godot/bundle-godot" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-godot-bundle"] } }
}
```

在 profile 目录运行 `pnpm install`，重启 `dsh web`。bundle 卡片会出现在**已安装插件**下；打开后是 `tool-godot` 的设置表单（可执行文件、gdformat、格式化后端、超时）。各行保留自己的默认值，`godot` 在 `PATH` 上时无需配置。

本地 `link:` 安装不会安装所链接包的依赖；请把五个行包也链接进 profile。npm 安装会把它们提升到 profile 根目录。本检出的 profile 两种方式都已完成。

<a id="model-experience"></a>
## 模型体验

### 组合出的 Godot 工具

#### 模型看到什么

bundle 本身不贡献模型内容：各行贡献 `godot_*` 工具 schema 与系统提示片段，细节见 `tool-godot`、`tool-godot-debug` 与 `tool-godot-ego` 的文档。

#### Token 影响

等于这些行之和。bundle 不新增任何提示文本或工具 schema。

#### KV Cache 影响

bundle 自身无影响。各行的提示片段保持稳定，按普通工具段落缓存。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- bundle 在安装粒度上是全有或全无。只需要无头工具的 profile 可以改为逐包插入，或在安装后用自己的 patch 禁用个别行。
- `lsp-godot` 与沙盒默认调用 `PATH` 上的 `godot`；二进制在别处时，覆盖 `spawnExecutable` 或 `executable`。
- 浏览器界面需要 `dsh web` 部署；无头部署仍可使用工具与 LSP 提供方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`cordis.patch.yml` 就是整层内容；`src/index.ts` 是刻意留空的模块，只为让包能作为插件解析。bundle 图标为取自 `godot-vscode-plugin` 的 Godot logo（© Godot Foundation，CC BY 4.0），在 manifest 中声明，不在此处绘制。

</details>
