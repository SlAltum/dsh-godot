/**
 * gen-icons — Godot 类图标生成器（T20-opt）
 *
 * 读取 `docs/godot-icons/*.svg`，把每个图标内联进 `docs/ui-plugin-godot.js`
 * 的 `GODOT_ICONS` 区块（`/* @godot-icons:start *​/ ... /* @godot-icons:end *​/` 之间），
 * 并把 SVG 的固定 fill/stroke 色替换为 `currentColor`——卡片用主题色
 * （`var(--dsw-alias-*)`）着色，浅色/深色主题自适应。
 *
 * 动态插件没有 bundler，资源只能随代码分发；本生成器把「内嵌」自动化，
 * 与社区静态包的构建期资源注入同构。新增图标类 = 把 SVG 放进
 * `docs/godot-icons/` 后重跑本脚本，不手写常量。
 *
 * 用法：`node gen-icons.mjs [iconsDir] [target]`（默认 iconsDir =
 * 同目录 godot-icons/，target = 同目录 ui-plugin-godot.js）
 *
 * 图标来源：Godot 官方编辑器图标集（godot-vscode-plugin 的
 * `resources/godot_icons/dark/`，类名与引擎 `get_class()` 一致）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(here, process.argv[2] ?? 'godot-icons')
const target = join(here, process.argv[3] ?? 'ui-plugin-godot.js')
const START = '/* @godot-icons:start */'
const END = '/* @godot-icons:end */'

const files = readdirSync(iconsDir).filter((f) => f.endsWith('.svg')).sort()
if (files.length === 0) {
  console.error(`gen-icons: no SVG files in ${iconsDir}`)
  process.exit(1)
}

const entries = files.map((file) => {
  const name = file.slice(0, -'.svg'.length)
  let svg = readFileSync(join(iconsDir, file), 'utf8').trim()
  // 主题自适应：固定色 → currentColor（fill 与 stroke 都处理）。
  svg = svg
    .replace(/fill="#[0-9a-fA-F]+"/g, 'fill="currentColor"')
    .replace(/stroke="#[0-9a-fA-F]+"/g, 'stroke="currentColor"')
  return `  ${JSON.stringify(name)}: ${JSON.stringify(svg)},`
})

const block = `${START}\n  const GODOT_ICONS = {\n${entries.join('\n')}\n  }\n  ${END}`
const source = readFileSync(target, 'utf8')
const startIdx = source.indexOf(START)
const endIdx = source.indexOf(END, startIdx)
if (startIdx === -1 || endIdx === -1) {
  console.error(`gen-icons: marker block missing in ${target} (need ${START} / ${END})`)
  process.exit(1)
}
const out = `${source.slice(0, startIdx)}${block}${source.slice(endIdx + END.length)}`
writeFileSync(target, out)
console.log(`gen-icons: injected ${entries.length} icons (${files.length} files) into ${target}`)
