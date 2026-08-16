/**
 * GDScript TextMate tokenizer for the built-in formatter: a lazily-loaded
 * single grammar instance over `vscode-textmate` + `vscode-oniguruma`
 * (maintained Microsoft packages, usable in plain Node). The grammar JSON is
 * embedded (gdscript-grammar.ts); the oniguruma WASM is resolved from the
 * installed `vscode-oniguruma` package at runtime.
 *
 * Both packages are CJS. Node's ESM static analysis does not see their named
 * exports (vitest's vite interop masks this), so they are loaded through
 * `createRequire` — the same path under vitest, tsx source-launch, and the
 * built lib.
 * @module @deepseek-ai/dsh-tool-godot/gdscript-tokenizer
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type * as VsctmTypes from 'vscode-textmate'
import type * as OnigTypes from 'vscode-oniguruma'
import { GDSCRIPT_GRAMMAR_JSON } from './gdscript-grammar.ts'

const require = createRequire(import.meta.url)
const vsctm = require('vscode-textmate') as typeof VsctmTypes
const oniguruma = require('vscode-oniguruma') as typeof OnigTypes

let grammarPromise: Promise<VsctmTypes.IGrammar> | undefined

/**
 * The single lazily-loaded GDScript grammar. The promise is cached, so the
 * WASM load and grammar parse happen once per process.
 * @returns the ready grammar.
 */
export function getGrammar(): Promise<VsctmTypes.IGrammar> {
  grammarPromise ??= loadGrammar()
  return grammarPromise
}

/** Build the registry and load `source.gdscript`. */
async function loadGrammar(): Promise<VsctmTypes.IGrammar> {
  const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm')
  const wasmBin = readFileSync(wasmPath).buffer
  const registry = new vsctm.Registry({
    onigLib: oniguruma.loadWASM(wasmBin as unknown as Parameters<typeof oniguruma.loadWASM>[0]).then(() => ({
      createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
      createOnigString: s => new oniguruma.OnigString(s),
    })),
    loadGrammar: (scopeName) => {
      /* v8 ignore start -- this registry only requests source.gdscript; the other-scope arm is the Registry contract's fallback. */
      return scopeName === 'source.gdscript'
        ? Promise.resolve(vsctm.parseRawGrammar(GDSCRIPT_GRAMMAR_JSON, 'gdscript.tmLanguage.json'))
        : Promise.resolve(undefined)
      /* v8 ignore stop */
    },
  })
  const grammar = await registry.loadGrammar('source.gdscript')
  /* v8 ignore next -- a null grammar means the embedded resource failed to parse, which the cached promise surfaces as a reject instead. */
  if (grammar === null) throw new Error('GDScript TextMate grammar failed to load')
  return grammar
}

export type { ITokenizeLineResult } from 'vscode-textmate'
