# Agent Note: Godot GDScript 语言服务器 provider（dsh-lsp-godot）

Status: implemented

[English](2026-08-17-godot-lsp-provider.md) | 中文

## Problem

harness 已有 headless Godot 工具化（`tool-godot`），但没有 GDScript 语义导航：`ctx.lsp` seam 的四个操作没有 Godot provider，tool-godot 把该缺口记录为延后。VSCode 生态的成熟集成（godot-vscode-plugin，70 万安装）证明 Godot 内置 TCP 语言服务器（默认 `127.0.0.1:6005`）是稳定通道——无需游戏侧 autoload、无需编辑器插件。

## Decision

在 `packages/godot/lsp-godot` 新增 `@deepseek-ai/dsh-lsp-godot`：`ctx.lsp` provider（id `godot`，`.gd` → `gdscript`），通过 transient `didOpen` 查询服务 `goToDefinition` / `findReferences` / `hover`，两种连接模式加 auto：

- **attach**——连接已运行编辑器的 LSP（`ports` 列表，默认 `[6005]`）；provider 不拥有服务器，因此取消意味着断开并重连（Godot 不认已重连的客户端，源插件 issue #844）。
- **spawn**——以预选端口（绝不传 0）、版本门禁（Godot 4.2+ / 3.6+，来自源插件 `verify_godot_version`）、有界 TCP 就绪等待与提前退出检测及 stderr 尾部启动 `godot --path <dir> --editor --headless --no-window --lsp-port <p>`；自起编辑器归 provider 所有，连接关闭时终止。
- **auto**——有界连接探测 attach，失败回退 spawn。

对 `dsh-lsp-stdio` 的复用仅限纯函数层（`encodeMessage`、`MessageDecoder`、`normalizeLocations`、`normalizeHover`、`requestMethod`、`supportsOperation`、`supportsTransientOpen`、`negotiatePositionEncoding`、`canonicalizeWorkspace`、`readHostSource`）。TCP JSON-RPC 端点（id 配对、通知路由、半帧空闲超时）、`CLIENT_CAPABILITIES`、per-workspace 连接池与序列化队列、连接模式编排均为包自有——`lsp-stdio` 的 `LspInstance` 假定 provider 拥有进程，attach 模式违反该假定。

## Godot 专属协议事实（Godot 4.7 实测，`.context/t0/facts.md`）

- `textDocumentSync` 声明为 `{ change: 1, openClose: true, ... }`——标准 `supportsTransientOpen` 检查适用；早期声称其缺失的探针记录是探针侧字段级 bug，在实现依赖它之前已纠正。
- `positionEncoding` 缺省（默认 utf-16）。
- 项目不匹配由 `gdscript_client/changeWorkspace` + `window/showMessage` 在 initialize 响应**之前**通告；匹配根不发任何消息。工作区匹配规则为"客户端工作区是服务器项目根或其子文件夹"（源插件 `check_workspace`）。seam 的 `LSP_UNAVAILABLE` 在服务器项目不匹配时使查询失败。
- `$/cancelRequest` 被忽略：请求照常完成。因此取消意味着 best-effort cancel + 断开；下次查询重建连接。
- hover 返回预渲染 markdown，每行带前导 tab（代码块风险），旧版本/英文文档上还有 bbcode 残留标签；包在 `normalizeHover` 前清洗（`hover-clean.ts`）。
- 位置 URI 是 URL 编码的（`file:///D%3A/...`）而 DSH fs provider 输出 WHATWG 形式（`file:///D:/...`）；`normalizeGodotUri` 对齐两者，使 `tool-lsp` 的工作区相对渲染可用。
- `gdscript/capabilities` 通知携带大型 native class 表；端点路由它们但 provider 忽略 body。
- `goToImplementation` 从不被声明；seam 的能力协商以 `LSP_UNSUPPORTED_OPERATION` 拒绝，无需特殊处理。

## 包与所有权边界

插件通过 `ctx.effect()` 注册 provider，并在销毁时拆除连接池（HMR 安全：注册消失、连接关闭）。连接建立可注入（`createConnectDeps`、`EditorSpawner`、版本探针），使 spawn 管线无需 Godot 二进制即可测试；真实接线运行于 `ctx.subprocess` 之上。spawn 可执行文件在首次 spawn 时惰性解析（仅 attach 的部署不需要 Godot 二进制）。定时器与字节上限在加载时校验（对齐 `lsp-stdio` 的 `assertTimer`/`assertPositiveInteger`）。

## Alternatives considered

- **整体复用 `lsp-stdio` 的 `LspInstance`**——它假定 provider 拥有服务器进程（shutdown/exit/SIGKILL），attach 模式违反该假定；只共享纯函数层，TCP 端点与 per-workspace 池为包自有。
- **给 `lsp-stdio` 增导出**（CLIENT_CAPABILITIES、Wire 类型、per-workspace 序列化）——为一个消费者扩大既有包的暴露面；本地副本把 blast radius 限制在新包内。
- **仅 attach provider**——spawn 模式（headless 编辑器）消除了自动化环境"用户必须在 Godot 中打开项目"的前置条件；两种模式都已交付并带 auto。
- **用子进程 GDScript Language Server 替代 Godot 的 TCP LSP**——Godot 自带的语言服务器通道正是编辑器与源插件都使用的 TCP；第三方服务器会偏离项目实际解析行为。
- **依赖 initialize 响应获取项目根**——协议在该响应中不含根（T0 pin）；`changeWorkspace` 通知是唯一的权威项目不匹配信号。

## Consequences

attach 模式的正确性依赖用户在 Godot 中打开匹配项目；检测到不匹配时 provider 以 `LSP_UNAVAILABLE` 大声失败，但无法切换 Godot 的项目。断开可能残留服务器端 open 文档（best-effort `didClose` 缓解；下次 `didOpen` 覆盖）。自起编辑器会写 `.godot/` import 产物，冷启动在大型项目上可能超过 `lsp` 工具的 60s 预算。harness 崩溃可能遗留自起 headless 编辑器（subprocess seam 只在正常生命周期内清理）。

## Testing

- 13 个文件 123 个测试，每文件 100% 覆盖：纯函数清洗（真实 T0 样本）、对真实 `node:net` fake server 的端点行为（帧、配对、空闲超时、取消、畸形帧）、池序列化/驱逐、配置校验、连接模式编排、对 fake subprocess seam 的真实编辑器 spawner、REAL composition（tool-lsp + seam + provider + fake server）断言模型可见渲染输出与销毁，以及 T0 transcript 的 keyless 回放（真实 Godot 4.7 响应）——CI 无需 Godot 二进制。
