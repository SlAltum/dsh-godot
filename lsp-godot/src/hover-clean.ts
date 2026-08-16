/**
 * Godot hover markdown cleaning. Godot's LSP returns pre-rendered markdown
 * that (a) leads every line with a tab — a markdown code-block hazard — and
 * (b) historically carried bbcode residue tags (`br`, `codeblocks`,
 * `gdscript`, `csharp`) and unstripped `#` heading hashes. The cleaning order
 * and tag replacements follow the source plugin's `response_filter`
 * (godot-vscode-plugin `GDScriptLanguageClient.ts`), plus the tab strip this
 * package adds. Godot 4.7 zh_CN docs are already clean apart from the tab;
 * the bbcode paths are kept as a compatibility floor for older versions and
 * English docs (T0 facts, `.context/t0/facts.md`).
 * @module @deepseek-ai/dsh-lsp-godot/hover-clean
 */

/**
 * Clean one Godot hover markdown value for model consumption.
 * @param value - the raw hover `contents` string from Godot.
 * @returns the cleaned markdown.
 */
export function hoverClean(value: string): string {
  let out = value
  // Godot prepends a tab to every hover line; a leading tab opens a markdown
  // code block, so strip line-leading tabs before any rendering.
  out = out.replace(/^\t/gm, '')
  // The source plugin's hack for unstripped heading hashes in pre-rendered
  // markdown (docstrings rendered as titles).
  out = out.replace(/\n[#]+/g, '\n')
  // bbcode residue compatibility floor, in the source plugin's order.
  out = out.replaceAll('`br`', '\n\n')
  out = out.replace('`codeblocks`', '')
  out = out.replace('`/codeblocks`', '')
  out = out.replace('`gdscript`', '\nGDScript:\n```gdscript')
  out = out.replace('`/gdscript`', '```')
  out = out.replace('`csharp`', '\nC#:\n```csharp')
  out = out.replace('`/csharp`', '```')
  return out
}
