/**
 * ui-plugin-godot — Godot 界面动态插件（部署示例 v2.3）
 *
 * 向 DSH Web 界面添加两块 Godot 相关界面，不改动 DSH 本体：
 *   1. Godot 设置卡片（settings.plugin.item）：Godot 编辑器路径、
 *      gdformat 工具路径、代码格式化方式、单次操作超时。
 *   2. godot_debug 调试工具卡（tool.call.toolview）：摘要行 + 可展开的
 *      调试报告。
 *
 * 加载方式：会话内用 cordis_define / cordis_run（host 面 = applyHost，
 * client 面 = applyClient）；或按部署环境的插件机制引入本文件。
 * 使用说明见同目录 ui-plugin-godot.md。
 *
 * 实现说明（修改本文件前请阅读）：
 *   - 本文件运行在浏览器端，是纯 JavaScript：不能使用 import 和 JSX，
 *     React 与 styles 由运行环境注入，界面用 React.createElement 构建。
 *   - 设置卡片注册时同时提供 key 和 id：新旧两版界面框架对这一位置的
 *     注册要求不同（旧版按 id 收录所有卡片，新版按 key 即设置命名空间
 *     分发），两者都写才能在两个版本下正常显示，请勿删掉其中之一。
 *   - 界面颜色一律使用 var(--dsw-*) 主题变量，不写死颜色值，否则另一套
 *     配色下会显示异常。
 *   - 界面文案为中文；调试报告正文由工具生成、面向助手阅读，保持原样。
 */

/** host 面：无 host 行为（godot 设置命名空间归 tool-godot 所有）。 */
export function applyHost() {
  return {
    name: 'ui-plugin-godot',
    inject: [],
    apply() {},
  }
}

/** client 面：注册 godot 设置卡片与 godot_debug 工具卡。 */
export function applyClient() {
  const css = `
.godot-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);padding:12px 16px}
.godot-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.godot-name{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}
.godot-note{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}
.godot-desc{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);margin-top:2px}
.godot-field{display:grid;grid-template-columns:170px minmax(0,1fr) auto;gap:8px;align-items:center;margin-top:10px}
.godot-label{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.godot-control{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font:var(--dsw-font-xs-13);width:100%;box-sizing:border-box;outline:none}
.godot-control:focus{border-color:var(--dsw-alias-brand-primary)}
.godot-control:disabled{color:var(--dsw-alias-label-tertiary)}
.godot-control[data-invalid=true]{border-color:var(--dsw-alias-label-error)}
.godot-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);margin-top:2px;line-height:1.5}
.godot-chip{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border-radius:4px;padding:1px 6px;white-space:nowrap}
.godot-reset{border:none;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);cursor:pointer;padding:0;text-decoration:underline}
.godot-reset:hover:not(:disabled){color:var(--dsw-alias-label-secondary)}
.godot-actions{display:flex;gap:8px;margin-top:12px}
.godot-btn{border:1px solid var(--dsw-alias-label-dimmed);background:transparent;color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 12px;font:var(--dsw-font-xs-13);cursor:pointer}
.godot-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.godot-btn:disabled{cursor:default;opacity:.5}
.godot-btn-primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.godot-row{display:flex;align-items:center;gap:8px;padding:6px 0;min-width:0;font:var(--dsw-font-xs-13)}
.godot-dot{width:8px;height:8px;border-radius:50%;flex:none}
.godot-dot-running{background:var(--dsw-alias-state-business-primary);animation:godot-pulse 1.6s ease-in-out infinite}
.godot-dot-error{background:var(--dsw-alias-state-error-primary)}
.godot-tool-name{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary);white-space:nowrap}
.godot-tool-summary{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.godot-tool-head{color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.godot-tool-head-error{color:var(--dsw-alias-state-error-primary)}
.godot-inspect{margin-left:auto;border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;padding:0 2px}
.godot-inspect:hover{color:var(--dsw-alias-label-secondary)}
.godot-report{margin-top:2px}
.godot-report>summary{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none;list-style:none}
.godot-report>summary::-webkit-details-marker{display:none}
.godot-report>summary::before{content:'\u25B8  '}
.godot-report[open]>summary::before{content:'\u25BE  '}
.godot-pre{margin:6px 0 0;padding:8px 10px;overflow:auto;max-height:340px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;white-space:pre;color:var(--dsw-alias-label-primary)}
.godot-stop{margin-top:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 10px}
.godot-stop>summary{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;list-style:none}
.godot-stop>summary::-webkit-details-marker{display:none}
.godot-sub{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin-top:6px}
.godot-lines{margin:4px 0 0;padding:6px 8px;overflow:auto;max-height:260px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;white-space:pre;color:var(--dsw-alias-label-primary)}
.godot-frame{margin-top:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.godot-frame-link{color:var(--dsw-alias-brand-primary);text-decoration:underline;cursor:pointer}
.godot-frame-link:hover{text-decoration:none}
.godot-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-label-secondary)}
.godot-icon svg{display:block;width:16px;height:16px}
.godot-tree-line{display:flex;align-items:center;gap:6px;min-width:0;font-family:var(--ds-font-family-code);font-size:12px;line-height:19px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.godot-tree-name{overflow:hidden;text-overflow:ellipsis}
.godot-tree-class{color:var(--dsw-alias-label-tertiary)}
.godot-tree-id{color:var(--dsw-alias-label-caption)}
.godot-exp-line{display:flex;align-items:center;gap:6px;min-width:0;font-family:var(--ds-font-family-code);font-size:12px;line-height:19px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.godot-exp-rows{margin-top:2px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:pre}
@keyframes godot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
`

  /* @godot-icons:start */
  const GODOT_ICONS = {
  "AnimatedSprite2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><g fill=\"currentColor\"><path fill-opacity=\".4\" d=\"M7 0a2 2 0 0 0-2 2h7a2 2 0 0 1 2 2v6a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z\"/><path fill-opacity=\".6\" d=\"M5 2a2 2 0 0 0-2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z\"/><path d=\"M3 4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM2 9a1 1 0 0 1 2 0v1a1 1 0 0 1-2 0zm7 0a1 1 0 0 1 2 0v1a1 1 0 0 1-2 0zm0 3a2.5 2 0 0 1-5 0z\"/></g></svg>",
  "AnimationPlayer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M1 1v14h1v-2h2v2h8v-2h2v2h1V1h-1v2h-2V1H4v2H2V1zm1 4h2v2H2zm10 0h2v2h-2zM2 9h2v2H2zm10 0h2v2h-2z\"/></svg>",
  "Area2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M1 1v4h2V3h2V1zm10 0v2h2v2h2V1zM4 4v8h8V4zm2 2h4v4H6zm-5 5v4h4v-2H3v-2zm12 0v2h-2v2h4v-4z\"/></svg>",
  "Area3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M1 1v4h2V3h2V1zm10 0v2h2v2h2V1zM4 4v8h8V4zm2 2h4v4H6zm-5 5v4h4v-2H3v-2zm12 0v2h-2v2h4v-4z\"/></svg>",
  "AspectRatioContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M5 1a2 2 0 0 0-2 2h2zm2 0v2h2V1zm4 0v2h2a2 2 0 0 0-2-2zM3 5v2h2V5zm8 0v2h2V5zM3 9v2h2V9zm8 0v2h2V9zm-8 4a2 2 0 0 0 2 2v-2zm4 0v2h2v-2zm4 0v2a2 2 0 0 0 2-2z\"/></svg>",
  "AudioStreamPlayer": "<svg xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\" width=\"16\" height=\"16\" version=\"1.0\" viewBox=\"0 0 2.4 2.4\"><path fill=\"currentColor\" d=\"M1.252.15a.1.1 0 0 0-.082.03L.6.75H.318C.225.75.15.817.15.9v.6c0 .083.075.15.168.15H.6l.57.57c.066.067.18.02.18-.074V.256A.106.106 0 0 0 1.252.15\" paint-order=\"markers stroke fill\"/><path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\".165\" d=\"M1.575.675c.45.525 0 1.05 0 1.05m.3-1.35c.675.825 0 1.65 0 1.65\" paint-order=\"markers stroke fill\"/></svg>",
  "Button": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M7 1v3.133l-1.445-.965-1.11 1.664 3 2a1 1 0 0 0 1.11 0l3-2-1.11-1.664L9 4.133V1zM5.5 9A1.5 1.5 0 0 0 4 10.5V12H2v2h12v-2h-2v-1.5A1.5 1.5 0 0 0 10.5 9z\"/></svg>",
  "CPUParticles2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M4.586.5a.764.764 0 0 0-.764.764v.6h-1.2a.764.764 0 0 0-.764.764v1.2h-.6a.764.764 0 0 0-.764.764v.4a.764.764 0 0 0 .764.764h.6v4.5h-.6a.764.764 0 0 0-.764.764v.4a.764.764 0 0 0 .764.764h.6v1.2a.764.764 0 0 0 .764.764h1.2v.6a.764.764 0 0 0 .764.764h.4a.764.764 0 0 0 .764-.764v-.6h4.5v.6a.764.764 0 0 0 .764.764h.4a.764.764 0 0 0 .764-.764v-.6h1.2a.764.764 0 0 0 .764-.764v-1.2h.6a.764.764 0 0 0 .764-.764v-.4a.764.764 0 0 0-.764-.764h-.6v-4.5h.6a.764.764 0 0 0 .764-.764v-.4a.764.764 0 0 0-.764-.764h-.6v-1.2a.764.764 0 0 0-.764-.763h-1.2v-.6a.764.764 0 0 0-.764-.764h-.4a.764.764 0 0 0-.764.764v.6h-4.5v-.6a.764.764 0 0 0-.764-.764zm6.575 5.3a2.186 2.186 0 0 1-.3 4.349h-5.83a2.186 2.186 0 0 1-.3-4.349 3.28 3.644 0 0 1 6.434 0zM5.084 11a.729.729 0 0 1 0 1.459.729.729 0 0 1 0-1.459zm5.83 0a.729.729 0 0 1 0 1.459.729.729 0 0 1 0-1.459zM8 11.729a.729.729 0 0 1 0 1.459.729.729 0 0 1 0-1.46z\"/></svg>",
  "Camera2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M9 2a3 3 0 0 0-3 2.777 3 3 0 1 0-3 5.047V12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1l3 2V7l-3 2V7.23A3 3 0 0 0 9 2z\"/></svg>",
  "Camera3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M9 2a3 3 0 0 0-3 2.777 3 3 0 1 0-3 5.047V12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1l3 2V7l-3 2V7.23A3 3 0 0 0 9 2z\"/></svg>",
  "CanvasLayer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v6h1V3a1 1 0 0 1 1-1h6V1zm-.08 9c-.263.3-.42.73-.42 1.238 0 1.628-3.138-.178-.337 2.67.884.9 2.654.67 3.538-.228a2.33 2.33 0 0 0 0-3.256c-1.1-1.119-2.2-1.084-2.78-.424zm2.381-1.61 2.4 2.441 6.802-6.917a1.7 1.7 0 0 0-2.4-2.442zm8.7-1.39v6a1 1 0 0 1-1 1H7v1h6a2 2 0 0 0 2-2V7z\"/></svg>",
  "CanvasModulate": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M1 1v14h14V1zm2 2h10v10H3z\"/><path fill=\"currentColor\" d=\"M12 12H7.2L12 7.2z\"/><path fill=\"currentColor\" d=\"M4 4h4.8L4 8.8z\"/><path fill=\"currentColor\" d=\"M4 12V8.8L8.8 4H12v3.2L7.2 12z\"/></svg>",
  "CenterContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m3 1c-1.1046 0-2 .89543-2 2v10c0 1.1046.89543 2 2 2h10c1.1046 0 2-.89543 2-2v-10c0-1.1046-.89543-2-2-2zm0 2h10v10h-10zm3 1 2 2 2-2zm-2 2v4l2-2zm8 0-2 2 2 2zm-4 4-2 2h4z\"/></svg>",
  "CharacterBody2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M6.492 1a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v.99a1 1 0 0 0-.316.062l-2.051.684-.684-2.051a1 1 0 0 0-1.898.631l1 3a1 1 0 0 0 1.265.633l1.684-.56v.61c0 .041.019.076.024.116l-4.579 3.052a1 1 0 1 0 1.11 1.664l5.056-3.37 1.495 2.986a1 1 0 0 0 1.21.502l3-1a1 1 0 1 0-.632-1.897l-2.178.725-.975-1.951a.981.981 0 0 0 .469-.827V9h1.383l.722 1.448a1 1 0 1 0 1.79-.895l-1-2A1 1 0 0 0 12.492 7h-3V6h1a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 2h1v2h-1z\"/></svg>",
  "CharacterBody3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M6.492 1a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v.99a1 1 0 0 0-.316.062l-2.051.684-.684-2.051a1 1 0 0 0-1.898.631l1 3a1 1 0 0 0 1.265.633l1.684-.56v.61c0 .041.019.076.024.116l-4.579 3.052a1 1 0 1 0 1.11 1.664l5.056-3.37 1.495 2.986a1 1 0 0 0 1.21.502l3-1a1 1 0 1 0-.632-1.897l-2.178.725-.975-1.951a.981.981 0 0 0 .469-.827V9h1.383l.722 1.448a1 1 0 1 0 1.79-.895l-1-2A1 1 0 0 0 12.492 7h-3V6h1a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 2h1v2h-1z\"/></svg>",
  "CheckBox": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8l-2 2v3H3V4h7l2-2zm9.363 2.05L7.414 9 6 7.586 4.586 9l2.828 2.828 6.363-6.363z\"/></svg>",
  "CheckButton": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m5 4a4 4 0 0 0 -4 4 4 4 0 0 0 4 4h6a4 4 0 0 0 4-4 4 4 0 0 0 -4-4zm0 2h2.541a4 4 0 0 0 -.54102 2 4 4 0 0 0 .54102 2h-2.541a2 2 0 0 1 -2-2 2 2 0 0 1 2-2z\"/></svg>",
  "CollisionShape2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"none\" stroke=\"currentColor\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M14 14H2V2h12z\"/></svg>",
  "CollisionShape3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" d=\"m8 2 6 3v6l-6 3-6-3V5zm0 12V8l6-3M8 8 2 5\"/></svg>",
  "ColorRect": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M1 1v14h14V1zm2 2h10v10H3z\"/><path fill=\"currentColor\" d=\"M12 12H7.2L12 7.2z\"/><path fill=\"currentColor\" d=\"M4 4h4.8L4 8.8z\"/><path fill=\"currentColor\" d=\"M4 12V8.8L8.8 4H12v3.2L7.2 12z\"/></svg>",
  "Control": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><circle cx=\"8\" cy=\"8\" r=\"5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/></svg>",
  "GPUParticles2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M12 11a3 3 0 0 0 .414-5.969 4.5 5 0 0 0-8.824 0 3 3 0 0 0 .414 5.967zm-8 1a1 1 0 0 0 0 2 1 1 0 0 0 0-2zm8 0a1 1 0 0 0 0 2 1 1 0 0 0 0-2zm-4 1a1 1 0 0 0 0 2 1 1 0 0 0 0-2z\"/></svg>",
  "GridContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h2v2H3zm4 0h2v2H7zm4 0h2v2h-2zM3 7h2v2H3zm4 0h2v2H7zm4 0h2v2h-2zm-8 4h2v2H3zm4 0h2v2H7zm4 0h2v2h-2z\"/></svg>",
  "HBoxContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h2v10H3zm4 0h2v10H7zm4 0h2v10h-2z\"/></svg>",
  "Label": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M6 3a1 1 0 0 0-.707.293l-4 4a1 1 0 0 0 0 1.414l4 4A1 1 0 0 0 6 13h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H6zM5 7a1 1 0 0 1 0 2 1 1 0 0 1 0-2z\"/></svg>",
  "Label3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M6 3a1 1 0 0 0-.707.293l-4 4a1 1 0 0 0 0 1.414l4 4A1 1 0 0 0 6 13h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H6zM5 7a1 1 0 0 1 0 2 1 1 0 0 1 0-2z\"/></svg>",
  "Line2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"m2 9 3 4L8 3l3 6 3-2\"/></svg>",
  "LineEdit": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M2 4v5h2V4zm-1 7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2z\"/></svg>",
  "LinkButton": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M6 3a5 5 0 0 0 0 10h1v-2H6a3 3 0 0 1 0-6h1V3zm3 0v2h1a3 3 0 0 1 0 6H9v2h1a5 5 0 0 0 0-10zM6 7a1 1 0 0 0 0 2h4a1 1 0 0 0 0-2z\"/></svg>",
  "MarginContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h10v10H3zm1 3v4l2-2z\"/></svg>",
  "Marker2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m7 1v4h2v-4zm-6 6v2h4v-2zm10 0v2h4v-2zm-4 4v4h2v-4z\"/></svg>",
  "Marker3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m7 1v4h2v-4zm-6 6v2h4v-2zm10 0v2h4v-2zm-4 4v4h2v-4z\"/></svg>",
  "MeshInstance3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M4.73 2A2 2 0 1 0 2 4.73v6.541A2 2 0 1 0 4.73 14h6.541A2 2 0 1 0 14 11.27V4.729A2 2 0 1 0 11.27 2Zm.683 2h5.857a2 2 0 0 0 .729.73v5.856L5.412 4zM3.999 5.414 10.584 12H4.727a2 2 0 0 0-.729-.73V5.414z\"/></svg>",
  "NavigationRegion2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4.885a2.118 2.118 0 0 1 .133-.744l3-8a2.118 2.118 0 0 1 3.964 0L15 8.969V2a.992.992 0 0 0-1-1zm10 6-3 8 3-2 3 2z\"/></svg>",
  "Node": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><circle cx=\"8\" cy=\"8\" r=\"5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/></svg>",
  "Node2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><circle cx=\"8\" cy=\"8\" r=\"5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/></svg>",
  "Node3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><circle cx=\"8\" cy=\"8\" r=\"5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/></svg>",
  "OptionButton": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm7.293 3.307a1 1 0 0 1 1.424 1.414l-3 3a1 1 0 0 1-1.414 0l-3-3a1 1 0 0 1 1.414-1.414L8 8.6z\"/></svg>",
  "Panel": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"14\" height=\"14\" x=\"1\" y=\"1\" fill=\"currentColor\" rx=\"2\"/></svg>",
  "PanelContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h10v10H3z\"/></svg>",
  "ParallaxBackground": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"13\" height=\"13\" x=\"1.5\" y=\"1.5\" fill=\"none\" stroke=\"currentColor\" rx=\"1\"/><path fill=\"currentColor\" d=\"M7 5v6L4 8zm2 0v6l3-3z\"/></svg>",
  "ParallaxLayer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm4 4v6L4 8zm2 0 3 3-3 3z\"/></svg>",
  "Path2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M13 1a2 2 0 0 0-1.15 3.633c-.193.885-.554 1.34-.987 1.642-.644.451-1.713.606-2.963.73s-2.681.221-3.912 1.083c-.892.625-1.532 1.652-1.818 3.096a2 2 0 1 0 1.98.183c.193-.885.553-1.337.987-1.64.644-.451 1.713-.606 2.963-.73s2.681-.221 3.912-1.083c.892-.625 1.532-1.654 1.818-3.098A2 2 0 0 0 13 1z\"/></svg>",
  "Path3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M13 1a2 2 0 0 0-1.15 3.633c-.193.885-.554 1.34-.987 1.642-.644.451-1.713.606-2.963.73s-2.681.221-3.912 1.083c-.892.625-1.532 1.652-1.818 3.096a2 2 0 1 0 1.98.183c.193-.885.553-1.337.987-1.64.644-.451 1.713-.606 2.963-.73s2.681-.221 3.912-1.083c.892-.625 1.532-1.654 1.818-3.098A2 2 0 0 0 13 1z\"/></svg>",
  "PointLight2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M6 10.576V13h4v-2.42a5 5 0 1 0-4 0zM8 3a3 3 0 0 1 0 6 3 3 0 0 1 0-6zM7 14v1h2v-1z\"/></svg>",
  "Polygon2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" stroke=\"currentColor\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M14 14H2V2h12L8 8z\"/></svg>",
  "ProgressBar": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 2h10v6H3zm1 1v4h1V6zm2 0v4h1V6zm2 0v4h1V6z\"/></svg>",
  "RayCast2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m7 1v9h-3l4 5 4-5h-3v-9z\"/></svg>",
  "RemoteTransform2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M8 1a8 8 0 0 0-6.928 4 1 1 0 0 0 1.733 1 6 6 0 0 1 10.39 0 1 1 0 0 0 1.733-1A8 8 0 0 0 8 1zm0 4a4 4 0 0 0-3.863 2.965 1 1 0 0 0 1.931.517 2 2 0 0 1 3.864 0 1 1 0 0 0 1.931-.517A4 4 0 0 0 8 5zm0 4a1 1 0 0 0-1 1v1H4a4 4 0 0 0 8 0H9v-1a1 1 0 0 0-1-1z\"/></svg>",
  "RichTextLabel": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m1 1v2h8v-2zm12 0-3 3h2v8h-2l3 3 3-3h-2v-8h2zm-12 4v2h2v-2zm4 0v2h4v-2zm-4 4v2h8v-2zm0 4v2h4v-2zm6 0v2h2v-2z\"/></svg>",
  "RigidBody2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M8 1a7 7 0 0 0 0 14A7 7 0 0 0 8 1zm1.951 1.334A6 6 0 0 1 14.001 8h-7a2 2 0 0 0-.95-1.7c1.346-2.029 2.604-3.263 3.9-3.967zm-6.828 2.18c.146.65.358 1.283.684 1.884A2 2 0 0 0 3 8H2a6 6 0 0 1 1.123-3.486zM3.8 9.6a2 2 0 0 0 2.4 0c1.472 2.027 2.728 3.264 3.8 4a6 6 0 0 1-7.15-2.5c.25-.6.5-1 .95-1.5z\"/></svg>",
  "RigidBody3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M8 1a7 7 0 0 0 0 14A7 7 0 0 0 8 1zm1.951 1.334A6 6 0 0 1 14.001 8h-7a2 2 0 0 0-.95-1.7c1.346-2.029 2.604-3.263 3.9-3.967zm-6.828 2.18c.146.65.358 1.283.684 1.884A2 2 0 0 0 3 8H2a6 6 0 0 1 1.123-3.486zM3.8 9.6a2 2 0 0 0 2.4 0c1.472 2.027 2.728 3.264 3.8 4a6 6 0 0 1-7.15-2.5c.25-.6.5-1 .95-1.5z\"/></svg>",
  "ScrollContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h10v10H3zm5 1L4 8l4 4 4-4zm2 2v4H6V6z\"/></svg>",
  "Skeleton2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M6 2a4 4 0 0 0-2 7.453V13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9.453A4 4 0 0 0 10 2zM5 5a1 1 0 0 1 0 2 1 1 0 0 1 0-2zm6 0a1 1 0 0 1 0 2 1 1 0 0 1 0-2zM7 7h2v1H7zM5 9h1v1h1V9h2v1h1V9h1v4h-1v-1H9v1H7v-1H6v1H5V9z\"/></svg>",
  "SpinBox": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h7V3zm10 1-2 3h4zM3 5h5v6H3zm8 4 2 3 2-3z\"/></svg>",
  "Sprite2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M5 1a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V5a4 4 0 0 0-4-4zM3 7a1 1 0 0 1 2 0v2a1 1 0 0 1-2 0zm10 2a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0zm-2.172 3.828a4 4 0 0 1-5.656 0 1 1 0 0 1 1.414-1.414 2 2 0 0 0 2.828 0 1 1 0 0 1 1.414 1.414z\"/></svg>",
  "Sprite3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M5 1a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V5a4 4 0 0 0-4-4zM3 7a1 1 0 0 1 2 0v2a1 1 0 0 1-2 0zm10 2a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0zm-2.172 3.828a4 4 0 0 1-5.656 0 1 1 0 0 1 1.414-1.414 2 2 0 0 0 2.828 0 1 1 0 0 1 1.414 1.414z\"/></svg>",
  "StaticBody2D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H3zm0 1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm0 1v2h2V3zm8 0v2h2V3zm-8 8v2h2v-2zm8 0v2h2v-2z\"/></svg>",
  "StaticBody3D": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H3zm0 1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm0 1v2h2V3zm8 0v2h2V3zm-8 8v2h2v-2zm8 0v2h2v-2z\"/></svg>",
  "SubViewport": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.25\"><rect width=\"12.75\" height=\"10.75\" x=\"1.625\" y=\"2.625\" rx=\"1.5\"/><rect width=\"6.75\" height=\"6.75\" x=\"4.625\" y=\"4.625\" rx=\"1.5\"/></g></svg>",
  "TabContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h5v4h5v6H3zm7 0h3v2h-3z\"/></svg>",
  "TextEdit": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h10v10H3zm1 1v4h1V4z\"/></svg>",
  "TextureButton": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M8 1v2h6v10h-4v2h6V1zM3 2v3.133l-1.445-.965-1.11 1.664 3 2a1 1 0 0 0 1.11 0l3-2-1.11-1.664L5 5.133V2zm7 4v1H9v1H8v1h1v2h4V9h-1V7h-1V6zm-7.5 4A1.5 1.5 0 0 0 1 11.5V13H0v2h8v-2H7v-1.5A1.5 1.5 0 0 0 5.5 10z\"/></svg>",
  "TextureRect": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m1 1v14h14v-14zm2 2h10v10h-10zm6 3v1h-1v1h-2v1h-1v1h-1v1h2 2 2 2v-2h-1v-2h-1v-1z\"/></svg>",
  "TileMap": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M1 1v2h2V1zm3 0v2h2V1zm3 0v2h2V1zm3 0v2h2V1zm3 0v2h2V1zM1 4v2h2V4zm3 0v2h2V4zm3 0v2h2V4zm3 0v2h2V4zm3 0v2h2V4zM1 7v2h2V7zm3 0v2h2V7zm3 0v2h2V7zm3 0v2h2V7zm3 0v2h2V7zM1 10v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zM1 13v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2z\"/></svg>",
  "TileMapLayer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M8 2 6.25 3.375 8 4.75l1.75-1.375zm2.624 2.062-1.75 1.375 1.75 1.375 1.75-1.375Zm2.626 2.063L11.5 7.5l1.75 1.375L15 7.5ZM5.376 4.062l-1.75 1.375 1.75 1.375 1.75-1.375zM8 6.124 6.25 7.499 8 8.874l1.75-1.375zm2.626 2.063-1.75 1.375 1.75 1.375 1.75-1.375ZM2.75 6.125 1 7.5l1.75 1.375L4.5 7.5Zm2.624 2.062-1.75 1.375 1.75 1.375 1.75-1.375ZM8 10.25l-1.75 1.375L8 13l1.75-1.375z\"/></svg>",
  "Timer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a1 1 0 0 0-1 1c0 1.5.967 2.625 1.873 3.66.76.87 1.416 1.643 1.875 2.34-.459.697-1.114 1.472-1.875 2.342C2.967 11.377 2 12.5 2 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1c0-1.5-.967-2.623-1.873-3.658-.76-.87-1.416-1.645-1.875-2.342.459-.697 1.114-1.47 1.875-2.34C13.033 4.625 14 3.5 14 2a1 1 0 0 0-1-1zm8.412 2c-.238.44-.305.79-.789 1.342-.844.964-1.898 1.972-2.518 3.21A1 1 0 0 0 8 8a1 1 0 0 0-.106-.447c-.619-1.239-1.673-2.247-2.517-3.211-.484-.553-.551-.901-.79-1.342z\"/></svg>",
  "Tween": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m7 1v2h6v6h2v-8zm-1 4 1.793 1.793-4.793 4.793v-4.5859h-2v8h8v-2h-4.5859l4.793-4.793 1.793 1.793v-5h-5z\"/></svg>",
  "VBoxContainer": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"M3 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 2h10v2H3zm0 4h10v2H3zm0 4h10v2H3z\"/></svg>",
  "Window": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><path fill=\"currentColor\" d=\"m3 1c-1.1046 0-2 .8954-2 2v1h14v-1c0-1.1046-.89543-2-2-2zm9 1h1v1h-1zm-11 3v8c0 1.1046.89543 2 2 2h10c1.1046 0 2-.8954 2-2v-8z\"/></svg>",
  }
  /* @godot-icons:end */

  /** Subscribe to one settings scope snapshot with plain React. */
  function useScopeSnapshot(scope) {
    const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot())
    React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])
    return snapshot
  }

  /** One labeled field: label column + (control + hint) + status chip column. */
  function Field(props) {
    return React.createElement(
      'div',
      { className: 'godot-field' },
      React.createElement('label', { className: 'godot-label', htmlFor: props.id }, props.label),
      React.createElement('div', null, props.control,
        props.hint !== undefined ? React.createElement('div', { className: 'godot-hint' }, props.hint) : null),
      ...props.chips,
    )
  }

  /** The godot settings card: editor path, formatter path, format mode, timeout. */
  function GodotCard(props) {
    const scope = props.scope
    const snapshot = useScopeSnapshot(scope)
    const value = snapshot.value ?? {}
    const committed = {
      executable: value.executable ?? '',
      gdformatExecutable: value.gdformatExecutable ?? '',
      formatBackend: value.formatBackend ?? 'gdformat',
      timeoutMs: value.timeoutMs !== undefined ? String(value.timeoutMs) : '',
    }
    const [form, setForm] = React.useState(committed)
    const setField = (field, next) => setForm((prev) => ({ ...prev, [field]: next }))
    const dirty = form.executable !== committed.executable
      || form.gdformatExecutable !== committed.gdformatExecutable
      || form.formatBackend !== committed.formatBackend
      || form.timeoutMs.trim() !== committed.timeoutMs
    // Follow external settings changes (another surface saved) while the form is clean.
    React.useEffect(() => {
      if (!dirty) setForm(committed)
    }, [snapshot])
    const timeoutValid = form.timeoutMs.trim() === '' || /^\d+$/.test(form.timeoutMs.trim())
    const disabled = snapshot.status !== 'ready' || !snapshot.writable
    const user = snapshot.user !== null && typeof snapshot.user === 'object' ? snapshot.user : {}
    const overridden = (field) => Object.prototype.hasOwnProperty.call(user, field)
    const resetField = (field) => { void scope.unset(field).catch(() => {}) }
    const save = () => {
      const ops = []
      const applyText = (field, next, prev) => {
        if (next === prev) return
        ops.push(next === '' ? scope.unset(field) : scope.set(field, next))
      }
      applyText('executable', form.executable, committed.executable)
      applyText('gdformatExecutable', form.gdformatExecutable, committed.gdformatExecutable)
      if (form.formatBackend !== committed.formatBackend) ops.push(scope.set('formatBackend', form.formatBackend))
      if (form.timeoutMs.trim() !== committed.timeoutMs) {
        const t = form.timeoutMs.trim()
        ops.push(t === '' ? scope.unset('timeoutMs') : scope.set('timeoutMs', Number(t)))
      }
      void Promise.all(ops).catch(() => {})
    }
    const chipFor = (field) => overridden(field)
      ? [
        React.createElement('span', { key: 'chip', className: 'godot-chip' }, '已覆盖'),
        React.createElement('button', {
          key: 'reset', type: 'button', className: 'godot-reset', disabled,
          onClick: () => resetField(field),
        }, '重置'),
      ]
      : []
    return React.createElement(
      'li',
      { className: 'godot-card' },
      React.createElement('div', { className: 'godot-head' },
        React.createElement('span', { className: 'godot-name' }, 'Godot'),
        snapshot.status === 'loading' ? React.createElement('span', { className: 'godot-note' }, '加载中…') : null,
        snapshot.status === 'unavailable' ? React.createElement('span', { className: 'godot-note' }, '此宿主未提供 godot 命名空间') : null,
        snapshot.status === 'ready' && !snapshot.writable ? React.createElement('span', { className: 'godot-note' }, '只读') : null,
      ),
      React.createElement('div', { className: 'godot-desc' },
        '告诉助手本机的 Godot 装在哪里，助手在运行、检查、格式化 Godot 项目时会使用这里的配置。保存后，下一次操作即按新配置执行。'),
      React.createElement(Field, {
        id: 'godot-executable', label: 'Godot 编辑器路径', chips: chipFor('executable'),
        hint: 'Godot 程序在本机的完整位置，例如 D:\\软件\\Godot\\Godot_v4.7.exe；也可以填已加入系统 PATH 的命令名。留空则使用默认命令 godot。',
        control: React.createElement('input', {
          id: 'godot-executable', className: 'godot-control', value: form.executable, disabled,
          placeholder: 'godot',
          onChange: (e) => setField('executable', e.target.value),
        }),
      }),
      React.createElement(Field, {
        id: 'godot-gdformat', label: 'gdformat 工具路径', chips: chipFor('gdformatExecutable'),
        hint: '可选。gdformat 是专门给 GDScript 代码排版的命令行工具，需单独安装；没有安装时，可把下方「代码格式化方式」切换为内置。',
        control: React.createElement('input', {
          id: 'godot-gdformat', className: 'godot-control', value: form.gdformatExecutable, disabled,
          placeholder: 'gdformat',
          onChange: (e) => setField('gdformatExecutable', e.target.value),
        }),
      }),
      React.createElement(Field, {
        id: 'godot-backend', label: '代码格式化方式', chips: chipFor('formatBackend'),
        hint: '整理 GDScript 代码缩进和排版时使用哪种工具。',
        control: React.createElement('select', {
          id: 'godot-backend', className: 'godot-control', value: form.formatBackend, disabled,
          onChange: (e) => setField('formatBackend', e.target.value),
        },
        React.createElement('option', { value: 'gdformat' }, 'gdformat（效果更好，需单独安装）'),
        React.createElement('option', { value: 'builtin' }, '内置格式化器（无需安装任何东西）')),
      }),
      React.createElement(Field, {
        id: 'godot-timeout', label: '单次操作超时', chips: chipFor('timeoutMs'),
        hint: '助手执行每个 Godot 相关操作最多等待多久，超过即中止并报告（单位：毫秒，默认 60000 即 60 秒）。',
        control: React.createElement('input', {
          id: 'godot-timeout', className: 'godot-control', value: form.timeoutMs, disabled,
          placeholder: '60000', inputMode: 'numeric', 'data-invalid': !timeoutValid || undefined,
          onChange: (e) => setField('timeoutMs', e.target.value),
        }),
      }),
      React.createElement('div', { className: 'godot-actions' },
        React.createElement('button', {
          type: 'button', className: 'godot-btn godot-btn-primary',
          disabled: disabled || !dirty || !timeoutValid,
          onClick: save,
        }, '保存'),
        React.createElement('button', {
          type: 'button', className: 'godot-btn',
          disabled: !dirty,
          onClick: () => setForm(committed),
        }, '放弃')),
    )
  }

  /**
   * Narrow the tool result's structured card view (T20). Defensive: any shape
   * violation — missing field, wrong array type, unknown version — yields null
   * and the card falls back to the plain text report (adversarial review H3).
   * @param meta - the opaque replayed tool metadata (`block.meta`).
   * @returns the structured view, or null for the text fallback.
   */
  function parseDebugView(meta) {
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
    const view = meta.view
    if (view === null || typeof view !== 'object' || Array.isArray(view) || view.version !== 1) return null
    if (typeof view.stopCount !== 'number' || !Array.isArray(view.stops)) return null
    for (const stop of view.stops) {
      if (stop === null || typeof stop !== 'object' || typeof stop.index !== 'number' || !Array.isArray(stop.frames)) return null
      if (stop.varsLines !== undefined && !Array.isArray(stop.varsLines)) return null
      if (stop.sceneTree !== undefined
        && (stop.sceneTree === null || typeof stop.sceneTree !== 'object' || !Array.isArray(stop.sceneTree.lines))) return null
    }
    if (view.outputTail !== undefined && !Array.isArray(view.outputTail)) return null
    if (view.errors !== undefined && !Array.isArray(view.errors)) return null
    if (view.expansion !== undefined
      && (view.expansion === null || typeof view.expansion !== 'object' || !Array.isArray(view.expansion.entries))) return null
    if (view.edits !== undefined
      && (view.edits === null || typeof view.edits !== 'object' || !Array.isArray(view.edits.results))) return null
    return view
  }

  /** Workspace path for a frame's file, when the run was launched with a
   *  project path; attach runs have no project mapping, so frames are not
   *  clickable there (adversarial review M3). */
  function frameOpenPath(frame, args) {
    if (typeof args.path !== 'string' || args.path === '') return undefined
    const file = frame.file
    if (typeof file !== 'string' || !file.startsWith('res://')) return undefined
    return args.path.replace(/[\\/]+$/, '') + '/' + file.slice('res://'.length)
  }

  /**
   * 内联类图标（T20-opt）：SVG 由 gen-icons.mjs 从 docs/godot-icons/ 注入，
   * 固定色已替换为 currentColor（主题自适应）；未命中的类名（含脚本路径
   * 类 res://…）回退通用 Node 图标。
   */
  function iconForClass(className) {
    return GODOT_ICONS[className] ?? GODOT_ICONS['Node']
  }

  /** 一个 16px 内联 SVG 图标 span。 */
  function IconSpan(className) {
    return React.createElement('span', {
      className: 'godot-icon',
      dangerouslySetInnerHTML: { __html: iconForClass(className) },
    })
  }

  /**
   * 场景树行解析：renderSceneTree 格式 = 2 空格/深度缩进 + `name [class]
   * (id)`（class 可为脚本路径 res://…）+ 可选尾部场景文件路径。
   */
  const SCENE_LINE_RE = /^(\s*)([^\s]+)\s+\[([^\]]+)\]\s*\(([^)]+)\)(.*)$/

  /**
   * 渲染展开树（带类图标的行 + 属性行灰字缩进）。entry 对象是生成器的
   * 结构化产物（view.expansion.entries，含递归 children）。
   */
  function renderExpansionTree(entries, indent) {
    const children = []
    entries.forEach((entry, index) => {
      const value = entry.repr !== undefined ? entry.repr : 'Object<' + entry.id + '>'
      children.push(React.createElement('div', {
        key: 'exp-' + index + '-' + indent,
        className: 'godot-exp-line',
        style: { paddingLeft: 18 * indent },
      },
      IconSpan(entry.className),
      React.createElement('span', { className: 'godot-tree-name' }, entry.name + ' = ' + value),
      React.createElement('span', { className: 'godot-tree-class' }, '[' + entry.className + ']')))
      if (Array.isArray(entry.rows) && entry.rows.length > 0) {
        const rows = entry.rows.map(row => ' '.repeat(indent * 2 + 2) + row.name + ' = ' + row.value).join('\n')
        children.push(React.createElement('div', {
          key: 'exp-rows-' + index + '-' + indent,
          className: 'godot-exp-rows',
        }, rows))
      }
      if (Array.isArray(entry.children)) children.push(...renderExpansionTree(entry.children, indent + 1))
    })
    return children
  }

  /** One edit's outcome line (parity with the tool's text report). */
  function editLine(result) {
    const status = result.ok ? 'ok' : 'failed: ' + (result.detail ?? 'unknown')
    return result.target + '.' + result.property + ' = ' + JSON.stringify(result.requested)
      + ' [' + result.type + '] ' + status
  }

  /** The structured card body: one collapsible section per stop. */
  function renderStructuredStops(view, state, owner, args) {
    const children = []
    for (const stop of view.stops) {
      const frame = stop.frames[0]
      const where = frame !== undefined ? frame.file + ':' + frame.line + ' @ ' + frame.func : '<无帧>'
      const reason = stop.reason === '' ? 'break' : stop.reason
      const thread = stop.threadId !== 1 ? ' · 线程 ' + stop.threadId : ''
      const body = []
      if (stop.frames.length > 1) {
        body.push(React.createElement('div', { key: 'frames-head', className: 'godot-sub' }, '调用栈'))
        for (const f of stop.frames) {
          const path = frameOpenPath(f, args)
          body.push(React.createElement('div', { key: 'frame-' + f.line, className: 'godot-frame' },
            path !== undefined
              ? React.createElement('span', {
                className: 'godot-frame-link',
                onClick: () => owner.openFile(path),
              }, f.file + ':' + f.line)
              : f.file + ':' + f.line,
            ' @ ' + f.func))
        }
      }
      if (stop.varsLines !== undefined && stop.varsLines.length > 0) {
        body.push(React.createElement('div', { key: 'vars-head', className: 'godot-sub' }, '变量'),
          React.createElement('pre', { key: 'vars-lines', className: 'godot-lines' }, stop.varsLines.join('\n')))
      }
      if (view.expansion !== undefined && view.expansion.stopIndex === stop.index && view.expansion.entries.length > 0) {
        body.push(React.createElement('div', { key: 'exp-head', className: 'godot-sub' },
          '展开对象 (' + view.expansion.expandedObjects + ')'),
        React.createElement('div', { key: 'exp-lines', className: 'godot-lines' },
          ...renderExpansionTree(view.expansion.entries, 0)))
      }
      if (view.edits !== undefined && view.edits.stopIndex === stop.index && view.edits.results.length > 0) {
        body.push(React.createElement('div', { key: 'edits-head', className: 'godot-sub' },
          '编辑 (' + view.edits.results.length + ')'),
        React.createElement('pre', { key: 'edits-lines', className: 'godot-lines' },
          view.edits.results.map(editLine).join('\n')))
      }
      if (stop.sceneTree !== undefined && stop.sceneTree.lines.length > 0) {
        const treeRows = stop.sceneTree.lines.map((line, li) => {
          const m = SCENE_LINE_RE.exec(line)
          if (m === null) {
            return React.createElement('div', { key: 'tl-' + li, className: 'godot-tree-line' },
              React.createElement('span', { className: 'godot-tree-name' }, line))
          }
          return React.createElement('div', {
            key: 'tl-' + li,
            className: 'godot-tree-line',
            style: { paddingLeft: 18 * Math.floor(m[1].length / 2) },
          },
          IconSpan(m[3]),
          React.createElement('span', { className: 'godot-tree-name' }, m[2]),
          React.createElement('span', { className: 'godot-tree-class' }, '[' + m[3] + ']'),
          React.createElement('span', { className: 'godot-tree-id' }, '(' + m[4] + ')'),
          m[5].trim() !== '' ? React.createElement('span', { className: 'godot-tree-class' }, m[5].trim()) : null)
        })
        body.push(React.createElement('div', { key: 'tree-head', className: 'godot-sub' },
          '场景树 (' + stop.sceneTree.lines.length + ' 节点)'),
        React.createElement('div', { key: 'tree-lines', className: 'godot-lines' }, ...treeRows))
      }
      children.push(React.createElement('details', {
        key: 'stop-' + stop.index,
        className: 'godot-stop',
        open: state === 'error' || undefined,
      },
      React.createElement('summary', null, '停顿 ' + stop.index + ' · ' + where + ' [' + reason + thread + ']'),
      body))
    }
    if (view.outputTail.length > 0) {
      children.push(React.createElement('details', { key: 'output', className: 'godot-stop', open: state === 'error' || undefined },
        React.createElement('summary', null, '输出 (' + view.outputTail.length + ' 行' + (view.outputTruncated ? '，已截断' : '') + ')'),
        React.createElement('pre', { className: 'godot-lines' }, view.outputTail.join('\n'))))
    }
    if (view.errors.length > 0) {
      children.push(React.createElement('details', { key: 'errors', className: 'godot-stop', open: state === 'error' || undefined },
        React.createElement('summary', null, '错误 (' + view.errors.length + ')'),
        React.createElement('pre', { className: 'godot-lines godot-tool-head-error' }, view.errors.join('\n'))))
    }
    return children
  }

  /** The godot_debug tool call card: identity row + structured report. */
  function GodotDebugCard(owner) {
    const block = owner.block
    const done = block !== null && typeof block === 'object' && typeof block.kind === 'string'
    const argsRaw = done
      ? (block.call != null ? block.call.argsRaw : '')
      : (block != null ? block.argsRaw : '')
    let args = {}
    if (typeof argsRaw === 'string' && argsRaw !== '') {
      try {
        const parsed = JSON.parse(argsRaw)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed
      } catch (_ignored) { args = {} }
    }
    const attach = args.mode === 'attach'
    const mode = attach ? '附加' : '启动'
    const target = attach
      ? (typeof args.port === 'number' ? ':' + args.port : '运行中的游戏')
      : (typeof args.scene === 'string' && args.scene !== '' ? args.scene : '主场景')
    const bpCount = Array.isArray(args.breakpoints) ? args.breakpoints.length : 0
    let summary = mode + ' · ' + target
    if (bpCount > 0) summary += ' · ' + bpCount + ' 个断点'
    let state = 'running'
    let text = ''
    if (done) {
      state = block.isError === true ? 'error' : 'ok'
      const parts = []
      const content = Array.isArray(block.content) ? block.content : []
      for (const item of content) {
        if (item !== null && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
        else parts.push(JSON.stringify(item, null, 2))
      }
      if (parts.length === 0 && block.error != null) parts.push(block.error.name + ': ' + block.error.code)
      text = parts.join('\n')
    }
    const nl = text.indexOf('\n')
    const head = done && text !== '' ? (nl === -1 ? text : text.slice(0, nl)) : ''
    // T20: the structured view when the result carries one (else text fallback).
    const view = done ? parseDebugView(block.meta) : null
    const rowChildren = [
      React.createElement('span', {
        key: 'dot',
        className: state === 'running' ? 'godot-dot godot-dot-running' : state === 'error' ? 'godot-dot godot-dot-error' : 'godot-dot',
      }),
      React.createElement('span', { key: 'name', className: 'godot-tool-name' }, owner.toolName || 'godot_debug'),
      React.createElement('span', { key: 'summary', className: 'godot-tool-summary' }, summary),
    ]
    if (view !== null) {
      const truncated = view.viewTruncated === true || view.expansionTruncated === true || view.editsTruncated === true
        || view.sceneTreeTruncated === true || view.outputTruncated === true || view.varsTruncated === true
      const chips = [view.stopCount + ' 停顿']
      if (view.detached === true) chips.push('附加')
      if (view.sceneTreeCount > 0) chips.push(view.sceneTreeCount + ' 场景树')
      if (view.editsApplied > 0) chips.push(view.editsApplied + ' 编辑')
      if (view.expandedObjects > 0) chips.push(view.expandedObjects + ' 展开对象')
      if (truncated) chips.push('部分截断')
      for (const chip of chips) {
        rowChildren.push(React.createElement('span', { key: 'chip-' + chip, className: 'godot-chip' }, chip))
      }
    } else if (head !== '') {
      rowChildren.push(React.createElement('span', {
        key: 'head',
        className: 'godot-tool-head' + (state === 'error' ? ' godot-tool-head-error' : ''),
      }, head))
    }
    if (typeof owner.inspect === 'function') rowChildren.push(React.createElement('button', {
      key: 'inspect', type: 'button', className: 'godot-inspect', title: '查看调用详情',
      onClick: () => owner.inspect(),
    }, '⌕'))
    const row = React.createElement('div', { className: 'godot-row' }, rowChildren)
    if (!done || (text === '' && view === null)) return row
    if (view !== null) {
      return React.createElement('div', { className: 'godot-tool' }, row, ...renderStructuredStops(view, state, owner, args))
    }
    return React.createElement('div', { className: 'godot-tool' },
      row,
      React.createElement('details', { className: 'godot-report', open: state === 'error' || undefined },
        React.createElement('summary', null, '调试报告'),
        React.createElement('pre', { className: 'godot-pre' }, text)),
    )
  }

  return {
    name: 'ui-plugin-godot.client',
    inject: ['slots', 'settingsScope'],
    apply(ctx) {
      styles.insert(css)
      const scope = ctx.settingsScope.bind({ namespace: 'godot' })
      // 1. godot settings card. id satisfies list runtimes (deployed bundle,
      //    renders every card), key satisfies keyed runtimes (current source,
      //    dispatched by settings namespace).
      ctx.slots.inject('settings.plugin.item', () => {
        try {
          ctx.slots.register(
            { name: 'settings.plugin.item', key: 'godot', id: 'godot' },
            () => React.createElement(GodotCard, { scope }),
          )
        } catch (error) {
          console.warn('ui-plugin-godot: settings card registration failed', error)
        }
      })
      // 2. godot_debug tool call card — keyed by the wire tool name on both vintages.
      ctx.slots.inject('tool.call.toolview', () => {
        try {
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'godot_debug' },
            (owner) => React.createElement(GodotDebugCard, owner),
          )
        } catch (error) {
          console.warn('ui-plugin-godot: tool card registration failed', error)
        }
      })
    },
  }
}
