/**
 * ui-godot build: two artifacts, no monorepo preset.
 *
 *  1. host   — `src/index.ts` → `lib/index.js` (Node ESM). The Godot browser
 *              surface carries no host code, so this half is the empty `apply()`
 *              the profile's cordis row composes.
 *  2. client — `src/client/index.ts` → `lib/client.js`, a CJS closure handed to
 *              `window.__ModuleLoader__.load({ id, factory })`. The id MUST be
 *              the package name: the boot manifest keys rows by it, and a bundle
 *              registered under any other id is classified as "not a client row"
 *              and silently disappears.
 *
 * Two input kinds have no bundler-native form here, so each gets a small loader:
 *
 *  - `x.module.css` compiles to its scoped class map plus one injected `<style>`.
 *    Host stylesheets own bare names like `.card` and `.btn`, so every class is
 *    prefixed per file.
 *    ponytail: flat class selectors only — nesting (`&`), `composes`, and
 *    classes inside `url()` would need a real CSS compiler instead of this
 *    regex. Swap in lightningcss when a stylesheet here grows any of those.
 *  - `x.svg` becomes a `data:` URL, keeping the bundle a single file (no
 *    `lib/assets` route, no `./assets/*` export).
 */
import { cp, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { defineConfig, type TsdownPlugin, type UserConfig } from 'tsdown'

const ID = '@deepseek-ai/dsh-ui-godot'

/** Host-provided singletons: resolved from the loader module table at runtime. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  /^@deepseek-ai\/dsh-client-/,
]

const CSS_VIRTUAL_PREFIX = '\0godot-css:'
const ASSET_VIRTUAL_PREFIX = '\0godot-asset:'
/** The suffix keeps the virtual id out of tsdown's own `.css` pipeline, which matches on that ending. */
const VIRTUAL_SUFFIX = '.mjs'

/**
 * Prefix every class selector of a flat stylesheet with one per-file scope.
 * @param source - stylesheet text.
 * @param scope - unique per-file prefix.
 * @returns rewritten text and the `local` → `scoped` map the component imports.
 */
function scopeClasses(source: string, scope: string): { text: string, classes: Record<string, string> } {
  const classes: Record<string, string> = {}
  const text = source.replace(/\.([A-Za-z_][\w-]*)/g, (_match, local: string) => {
    classes[local] ??= `${scope}_${local}`
    return `.${classes[local]}`
  })
  return { text, classes }
}

/**
 * Module body that installs the stylesheet once per document and exports the class map.
 * @param text - compiled stylesheet.
 * @param classes - scoped class map.
 * @param tag - `id` of the injected style element; also the HMR-reload guard.
 */
function cssModule(text: string, classes: Record<string, string>, tag: string): string {
  return `const css = ${JSON.stringify(text)}
const tag = ${JSON.stringify(tag)}
if (typeof document !== 'undefined' && document.getElementById(tag) === null) {
  const style = document.createElement('style')
  style.id = tag
  style.dataset.plugin = 'ui-godot'
  style.textContent = css
  document.head.appendChild(style)
}
export default ${JSON.stringify(classes)}
`
}

/** Stylesheet and image loaders, both returning a virtual JS module. */
const inputs: TsdownPlugin = {
  name: 'godot-client-inputs',
  resolveId(source: string, importer: string | undefined) {
    if (!source.startsWith('.') && !source.startsWith('/')) return null
    if (source.endsWith('.module.css')) return `${CSS_VIRTUAL_PREFIX}${resolveAgainst(source, importer)}${VIRTUAL_SUFFIX}`
    if (source.endsWith('.svg')) return `${ASSET_VIRTUAL_PREFIX}${resolveAgainst(source, importer)}${VIRTUAL_SUFFIX}`
    return null
  },
  async load(virtualId: string) {
    if (virtualId.startsWith(CSS_VIRTUAL_PREFIX)) {
      const file = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)
      // The virtual id hides the real file from the watch graph.
      this.addWatchFile(file)
      const scope = `godot_${basename(file).replace(/[^\w]/g, '_')}`
      const { text, classes } = scopeClasses(await readFile(file, 'utf8'), scope)
      return cssModule(text, classes, `ui-godot:${basename(file)}`)
    }
    if (virtualId.startsWith(ASSET_VIRTUAL_PREFIX)) {
      const file = virtualId.slice(ASSET_VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)
      this.addWatchFile(file)
      const svg = await readFile(file, 'utf8')
      return `export default ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(svg)}`)}\n`
    }
    return null
  },
}

/**
 * Resolve a relative specifier against its importer, keeping the extension.
 * @param source - relative specifier.
 * @param importer - importing file, absent for an entry-level import.
 */
function resolveAgainst(source: string, importer: string | undefined): string {
  if (importer === undefined) return source
  return new URL(source, `file://${importer}`).pathname.replace(/^\/([A-Za-z]:)/, '$1')
}

/** Files under `src/client/assets` published beside the bundle for the package asset route. */
const ASSET_DIR = 'src/client/assets'
const ASSET_OUT = 'lib/assets'

/**
 * Publish package assets.
 *
 * The host serves `/plugins/<package>/assets/<path>` out of `lib/assets`, and the
 * host config cleans `lib` on every build, so the copy has to run as part of the
 * build rather than once by hand.
 */
const assets: TsdownPlugin = {
  name: 'godot-assets',
  async writeBundle() {
    await cp(join(import.meta.dirname, ASSET_DIR), join(import.meta.dirname, ASSET_OUT), { recursive: true })
  },
}

const host: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
}

const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: false,
  clean: false,
  external: CLIENT_EXTERNALS,
  plugins: [inputs, assets],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([host, client])
