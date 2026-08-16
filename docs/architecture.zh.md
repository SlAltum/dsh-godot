# dsh-godot — 架构

[English](architecture.md) | 中文

[仓库 README](../README.md) 背后的完整模块地图、数据流与协议说明。README 回答"这是什么、怎么用"；本文回答"怎么构建的、为什么"。

## 模块地图

```
├── README.md / README.zh.md        ← 总览、用法、测试环境
├── LICENSE                         ← MIT
├── .context/                       ← 仅本地的开发资产（git 忽略）：探针项目、
│   │                               ←   原始录制、计划、事实、agent 记忆
├── tool-godot/                     ← headless CLI 工具（ctx.tools）
│   └── src/
│       ├── index.ts                ← 插件入口（注册、配置、settings 命名空间）
│       ├── godot-core.ts           ← 可执行文件解析、项目发现、GodotError 分类
│       ├── validate.ts             ← godot_validate（headless 编辑器、结构化诊断）
│       ├── run-scene.ts            ← godot_run_scene（headless 运行、捕获输出）
│       ├── inspect.ts              ← godot_inspect（纯解析 project.godot/.tscn/.tres）
│       ├── editor-script.ts        ← godot_editor_script（res:// EditorScript 逃生口）
│       ├── format.ts               ← godot_format（gdformat 或 builtin 后端）
│       ├── gdscript-grammar.ts     ← 内嵌 TextMate tmLanguage（gen-grammar.mjs 生成）
│       ├── gdscript-tokenizer.ts   ← TextMate 分词器单例
│       ├── gdscript-format.ts      ← 纯格式化器（formatGdscript(text, options)）
│       ├── gdscript-symbols.ts     ← 格式化器用的符号表
│       └── presentation.ts         ← 卡片 meta 投影（validate/format 视图）
├── lsp-godot/                      ← GDScript LSP provider（ctx.lsp）
│   └── src/
│       ├── index.ts                ← 插件入口（provider 注册、连接模式依赖）
│       ├── provider.ts             ← 查询流程：规范化 → transient open → 请求 → 归一化
│       ├── connection.ts           ← TCP JSON-RPC 端点 + per-workspace 池 + 序列化队列
│       ├── connect-mode.ts         ← attach / spawn / auto 编排
│       ├── spawn.ts                ← 版本门禁（4.2+/3.6+）+ 端口预选；导出 verifyGodotVersion、pickFreePort
│       ├── editor-spawner.ts       ← 经 subprocess seam 的真实 spawn；导出 SubprocessLike
│       ├── hover-clean.ts          ← hover markdown 清洗（行首 tab + bbcode 兜底）
│       ├── uri.ts                  ← Godot URI 规范化（file:///D%3A/ → file:///D:/）
│       └── abort.ts                ← 取消辅助（abortError、throwIfAborted、abortable）
└── tool-godot-debug/               ← godot_debug（ctx.tools）
    └── src/
        ├── index.ts                ← 插件入口（工具注册、卡片 meta 投影）
        ├── tool.ts                 ← 运行管线：版本门禁 → spawn → 停顿 → 终止
        ├── controller.ts           ← TCP server 侧 + 协议路由 + 有界感知信号的等待
        ├── variant-decoder.ts      ← Godot 二进制 variant 解码器（全量，f64 分支已修正）
        ├── variant-encoder.ts      ← 命令编码器（primitive/数组，utf8/undefined 已修正）
        ├── variants.ts             ← 类型码、标志、math 值类（显示形态）
        ├── frames.ts               ← 帧组装（短前缀安全）
        ├── snapshot.ts             ← 有界堆栈/变量渲染（深度/大小上限、截断标志）
        ├── config.ts               ← 插件配置 + 加载时校验
        └── error.ts                ← GodotError（三码，本地实现）
```

## 数据流

**CLI 工具（tool-godot）。** 工具层构建 argv 并校验参数；`ctx.subprocess` 拥有 spawn、进程树终止、环境清洗与有界输出捕获。每次调用都是普通前台 spawn，`exec.signal` 被透传——协作超时与调用方取消会终止进程树。结果有界（`stdoutMaxBytes`/`stderrMaxBytes`、`validateMaxErrors`），截断会被报告，绝不静默。

**LSP 导航（lsp-godot）。** provider 经 TCP 与 Godot 内置语言服务器说 JSON-RPC。查询流程：规范化工作区、读取源码（有界）、确保连接（attach 已运行编辑器的端口，或自起归 provider 所有的 headless 编辑器）、能力协商、transient `didOpen`、发送操作请求、归一化响应（Godot URI + hover 清洗）、`didClose`。per-workspace 连接池化并带序列化队列；中止的查询意味着断开（Godot 忽略 `$/cancelRequest`），下次查询重建连接。`changeWorkspace` 通知与查询工作区不匹配时以 `LSP_UNAVAILABLE` 使查询失败。

**调试运行（tool-godot-debug）。** harness 侧是 TCP **服务器**：预选端口，spawn `godot --headless --path <root> --remote-debug tcp://127.0.0.1:<port>`，游戏连入。帧为 `[u32 LE 长度][单个 variant 编码数组]`，数组为 `[command, threadId, params]`（Godot ≥ 4.2）。运行管线：等待 `set_pid`（threadId 就绪），然后循环停顿 → 快照 → 继续直至 `maxStops`：每次 `debug_enter` 请求堆栈转储与帧变量、渲染（有界深度/大小）、再 `continue`。`debug_exit` 表示离开暂停状态而非游戏退出；无 `--quit-after` 的 headless 游戏会持续运行，因此工具终止进程树并等待（`kill → await done`）。取消、超时与协议失败都恰好使调用结算一次。

## 协议事实

针对真实 Godot 4.7 pin（探针事实是仅本地资产；以下要点即代码与测试所编码的事实）：

- **LSP**：`textDocumentSync` 为 `{ change: 1, openClose: true }`；`positionEncoding` 缺省 utf-16；项目不匹配由 `gdscript_client/changeWorkspace` 在 initialize 响应前通告；`$/cancelRequest` 被忽略；hover 带行首 tab（旧版本还有 bbcode 残留）；URI 为 `%3A` 编码。
- **调试器**：游戏连入；帧为单数组 variant（平铺顶层 variant 会被游戏的 `_read_in` 拒绝）；命令需要来自 `set_pid` 的 `threadId`；`debug_enter` 参数为 `[isUserBreakpoint, reason, true, 1]`（用户停顿 `reason === 'Breakpoint'`，脚本错误为错误描述）；`stack_dump` 行号 1-based；`output` 消息携带 `PackedStringArray`（类型 34）；`stack_frame_var` 有第五个 `className` 元素，源插件未使用。

## 移植时修复的源插件 bug

- `encode_String` 把 UTF-16 的 `str.length` 当作字节长度——非 ASCII 路径损坏。已改用 `Buffer.byteLength`；测试含中文 `res://` 路径。
- `encode_variant` 对 `undefined` 写零字节而 `size_variant` 预留 4 字节——尺寸不匹配的帧。编码器现在对 `undefined` 抛错。
- `PACKED_FLOAT64_ARRAY` 用 32 位读取器解码。该分支现在按 64 位读取。

## 测试

测试套件 keyless：codec、帧与控制器测试**回放录制的真实 Godot 字节**（`tool-godot-debug/tests/fixtures/` 里的 `t3-breakpoints.bin`、`t3-error.bin`、`t3-norun.bin`；lsp transcript 在 `lsp-godot/tests/fixtures/t0-responses.json`），因此 CI 无需 Godot 二进制。REAL-composition 测试 boot 完整进程内链路（工具 → subprocess seam → fake godot 可执行 → fake game/server）并断言模型可见输出、snapshot 与 HMR 销毁。`GODOT_EXE` 门控的真机冒烟对真实 Godot 4.7 运行调试工具（两个断点、堆栈/变量、输出）。验证环境：Windows 11、PowerShell 7、Godot 4.7、Node.js 24、DSH 0.1.0-rc.5（见 README「测试环境」）。

### 部署环境注意

- **`user://` 必须可写。** user 数据目录无法创建时游戏模式崩溃（信号 11 / 0xC0000005）；沙箱/容器部署必须把 `APPDATA` 重定向到可写目录。
- **headless 游戏模式不自动 import。** 缺少 `.godot` 全局类缓存的项目会触发 Parser Error 停顿而非正常运行；先 import 一次（`--headless --editor --import --quit`）。
- **首次运行 import 延迟。** headless 编辑器/游戏冷启动会导入资源，大项目可能超过 60s 工具预算（配置 `timeoutMs` / `spawnReadyTimeoutMs`）。
- **`--breakpoints` 值无法转义逗号**（Godot 按 `,` 分割）。
- **取消语义。** 游戏忽略 `$/cancelRequest`（LSP）——取消意味着断开；下次查询重建连接。调试器侧取消意味着终止游戏进程树并等待。
