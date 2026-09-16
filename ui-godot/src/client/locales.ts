/** Copy dictionaries for the Godot settings card. */

/** Simplified Chinese dictionary (verbatim v2.3 of ui-plugin-godot.js) and key source of truth. */
export const zh = {
  name: 'Godot',
  loading: '加载中…',
  readOnly: '只读',
  description: '告诉助手本机的 Godot 装在哪里，助手在运行、检查、格式化 Godot 项目时会使用这里的配置。保存后，下一次操作即按新配置执行。',
  executable: 'Godot 编辑器路径',
  executableHint: 'Godot 程序在本机的完整位置，例如 D:\\软件\\Godot\\Godot_v4.7.exe；也可以填已加入系统 PATH 的命令名。留空则使用默认命令 godot。',
  executablePlaceholder: 'godot',
  gdformatExecutable: 'gdformat 工具路径',
  gdformatExecutableHint: '可选。gdformat 是专门给 GDScript 代码排版的命令行工具，需单独安装；没有安装时，可把下方「代码格式化方式」切换为内置。',
  gdformatExecutablePlaceholder: 'gdformat',
  formatBackend: '代码格式化方式',
  formatBackendHint: '整理 GDScript 代码缩进和排版时使用哪种工具。',
  formatBackendGdformat: 'gdformat（效果更好，需单独安装）',
  formatBackendBuiltin: '内置格式化器（无需安装任何东西）',
  timeoutMs: '单次操作超时',
  timeoutMsHint: '助手执行每个 Godot 相关操作最多等待多久，超过即中止并报告（单位：毫秒，默认 60000 即 60 秒）。',
  timeoutMsPlaceholder: '60000',
  overridden: '已覆盖',
  reset: '重置',
  save: '保存',
  discard: '放弃',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
} satisfies Record<string, string>

/** Godot settings card locale key union. */
export type GodotLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  name: 'Godot',
  loading: 'Loading…',
  readOnly: 'Read-only',
  description: 'Tell the assistant where Godot is installed on this machine; it uses this configuration when running, checking, and formatting Godot projects. The next operation uses saved values.',
  executable: 'Godot editor path',
  executableHint: 'Full location of the Godot program, for example D:\\Software\\Godot\\Godot_v4.7.exe; or a command name already on the system PATH. Leave blank to use the default command godot.',
  executablePlaceholder: 'godot',
  gdformatExecutable: 'gdformat tool path',
  gdformatExecutableHint: 'Optional. gdformat is a command-line tool that formats GDScript code and must be installed separately; without it, switch the format mode below to built-in.',
  gdformatExecutablePlaceholder: 'gdformat',
  formatBackend: 'Code format mode',
  formatBackendHint: 'Which tool is used to tidy GDScript indentation and layout.',
  formatBackendGdformat: 'gdformat (better results, requires separate install)',
  formatBackendBuiltin: 'Built-in formatter (nothing to install)',
  timeoutMs: 'Per-operation timeout',
  timeoutMsHint: 'How long the assistant waits for each Godot-related operation before aborting and reporting (in milliseconds, default 60000 = 60 seconds).',
  timeoutMsPlaceholder: '60000',
  overridden: 'Overridden',
  reset: 'Reset',
  save: 'Save',
  discard: 'Discard',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
} satisfies Record<GodotLocaleKey, string>
