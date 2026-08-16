/**
 * T2.3: snapshot tests for the built-in GDScript formatter, migrated from
 * godot-vscode-plugin (MIT) `src/formatter/`. Each fixture `.gd` carries
 * `# --- CONFIG ALL ---` / `# --- CONFIG ---` / `# --- IN ---` / `# --- OUT ---`
 * / `# --- END ---` sections; formatting the IN text must reproduce OUT.
 * Drives the pure `formatGdscript` function — no VSCode, no gdformat.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatGdscript, type FormatterOptions } from '../src/gdscript-format.ts'

const SNAPSHOTS_DIR = join(import.meta.dirname, 'fixtures', 'formatter-snapshots')

/** Parse one snapshot file into (input, expected, config) test cases. */
export function parseSnapshotFile(content: string): Array<{ input: string; expected: string; config: FormatterOptions }> {
  const defaultOptions: FormatterOptions = {
    maxEmptyLines: 2,
    denseFunctionParameters: false,
    spacesBeforeEndOfLineComment: 1,
  }
  const CONFIG_ALL = '# --- CONFIG ALL ---'
  const CONFIG = '# --- CONFIG ---'
  const IN = '# --- IN ---'
  const OUT = '# --- OUT ---'
  const END = '# --- END ---'
  const MODES = [CONFIG_ALL, CONFIG, IN, OUT, END]

  const tests: Array<{ input: string; expected: string; config: FormatterOptions }> = []
  let mode = ''
  let defaultConfig: Record<string, unknown> | null = null
  let defaultConfigLines: string[] = []
  let configLines: string[] = []
  let inLines: string[] = []
  let outLines: string[] = []

  const flush = () => {
    if (inLines.length === 0) return
    const config: FormatterOptions = { ...defaultOptions, ...(defaultConfig ?? {}), ...buildConfig(configLines) }
    let input = inLines.join('\n')
    let expected = outLines.length > 0 ? outLines.join('\n') : input
    input = input.trimEnd()
    expected = expected.trimEnd()
    tests.push({ input, expected, config })
    configLines = []
    inLines = []
    outLines = []
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (MODES.includes(line)) {
      if (line === CONFIG || line === IN) flush()
      if (defaultConfigLines.length > 0) {
        defaultConfig = buildConfig(defaultConfigLines)
        defaultConfigLines = []
      }
      mode = line
      continue
    }
    if (mode === CONFIG_ALL) defaultConfigLines.push(line)
    if (mode === CONFIG) configLines.push(line)
    if (mode === IN) inLines.push(line)
    if (mode === OUT) outLines.push(line)
  }
  flush()
  return tests
}

/** Parse a JSON config block (tolerant: invalid blocks are ignored). */
function buildConfig(lines: string[]): Record<string, unknown> {
  try {
    const parsed = JSON.parse(lines.join('\n')) as Record<string, unknown>
    return parsed ?? {}
  } catch {
    return {}
  }
}

describe('built-in GDScript formatter snapshots (from godot-vscode-plugin)', () => {
  const files = readdirSync(SNAPSHOTS_DIR).filter(name => name.endsWith('.gd'))
  expect(files.length).toBeGreaterThan(0)

  for (const file of files) {
    it(`formats ${file}`, async () => {
      const content = readFileSync(join(SNAPSHOTS_DIR, file), 'utf8')
      const cases = parseSnapshotFile(content)
      expect(cases.length).toBeGreaterThan(0)
      for (const testCase of cases) {
        const actual = await formatGdscript(testCase.input, testCase.config)
        expect(actual).toBe(testCase.expected)
      }
    })
  }
})
