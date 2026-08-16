#!/usr/bin/env node
// Fake godot/gdformat CLI for tests: behavior driven by fake-godot-input.json
// in the spawn working directory (JSON fields: stdout, stderr, exit,
// gdformatOutput, delayMs). In gdformat mode (first argv ends with .gd) the
// stub writes gdformatOutput into that file, emulating in-place formatting.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let input = { stdout: '', stderr: '', exit: 0, gdformatOutput: undefined, delayMs: 0 }
try {
  const parsed = JSON.parse(readFileSync(join(process.cwd(), 'fake-godot-input.json'), 'utf8'))
  input = { ...input, ...parsed }
} catch {
  // No input file: behave as a silent successful run.
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
