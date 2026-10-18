#!/usr/bin/env node
// Fake godot/gdformat CLI for tests: behavior driven by fake-godot-input.json
// in the spawn working directory (JSON fields: stdout, stderr, exit,
// gdformatOutput, delayMs, calls). In gdformat mode (first argv ends with .gd)
// the stub writes gdformatOutput into that file, emulating in-place
// formatting.
//
// `calls` is an optional array of per-invocation overrides consumed in order:
// invocation N merges `calls[N]` (tracked through a `.fake-godot-call` counter
// in the same directory), which lets a test drive a tool that spawns more than
// once — e.g. project-mode validation's import pass followed by its GDScript
// sweep — and assert which pass produced which diagnostic. The counter is only
// written in a directory that holds an input file: a run spawned from the
// repository root (no agent cwd) has no `calls` to consume, and must not leave
// an artifact there.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let input = { stdout: '', stderr: '', exit: 0, gdformatOutput: undefined, delayMs: 0 }
let hasInput = false
try {
  const parsed = JSON.parse(readFileSync(join(process.cwd(), 'fake-godot-input.json'), 'utf8'))
  input = { ...input, ...parsed }
  hasInput = true
} catch {
  // No input file: behave as a silent successful run.
}

if (hasInput) {
  const counterPath = join(process.cwd(), '.fake-godot-call')
  let invocation = 0
  try {
    invocation = Number(readFileSync(counterPath, 'utf8')) || 0
  } catch {
    // First invocation in this directory.
  }
  writeFileSync(counterPath, String(invocation + 1))
  if (Array.isArray(input.calls) && input.calls[invocation] !== undefined) {
    input = { ...input, ...input.calls[invocation] }
  }
}

const args = process.argv.slice(2)
if (args.length > 0 && args[0].endsWith('.gd') && input.gdformatOutput !== undefined) {
  writeFileSync(args[0], input.gdformatOutput, 'utf8')
}
if (typeof input.delayMs === 'number' && input.delayMs > 0) {
  await new Promise(resolve => setTimeout(resolve, input.delayMs))
}
if (input.stdout !== '') process.stdout.write(input.stdout)
if (input.stderr !== '') process.stderr.write(input.stderr)
process.exit(typeof input.exit === 'number' && Number.isInteger(input.exit) ? input.exit : 0)
