/**
 * Config schema defaults and load-time validation for the godot_debug tool
 * package. The schema fills every default; validation rejects caps the
 * retention/waits would misbehave on (positive integers, timer ceilings).
 */

import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Config, validateConfig } from '../src/config.ts'

/** The schema-resolved shape (all defaults filled). */
type Resolved = Required<ReturnType<typeof Config extends z<infer T> ? () => T : never>>

function resolve(input: object): Resolved {
  return Config(input) as unknown as Resolved
}

/** Assert that validation rejects one specific input with a field-named message. */
function expectConfigRejected(input: object, message: string | RegExp): void {
  expect(() => {
    validateConfig(input)
  }, String(message)).toThrow(message)
}

describe('Config defaults', () => {
  it('fills every field with the documented default', () => {
    const c = resolve({})
    expect(c.executable).toBe('godot')
    expect(c.executableArgs).toEqual([])
    expect(c.debugPort).toBe(0)
    expect(c.maxMessageBytes).toBe(16_000_000)
    expect(c.maxOutputBytes).toBe(1_000_000)
    expect(c.maxStderrBytes).toBe(1_000_000)
    expect(c.idleTimeoutMs).toBe(10_000)
    expect(c.connectWaitMs).toBe(20_000)
    expect(c.graceMs).toBe(5_000)
    expect(c.timeoutMs).toBe(60_000)
  })

  it('keeps explicitly provided values', () => {
    const c = resolve({ executable: 'custom-godot', executableArgs: ['--x'], maxOutputBytes: 512 })
    expect(c.executable).toBe('custom-godot')
    expect(c.executableArgs).toEqual(['--x'])
    expect(c.maxOutputBytes).toBe(512)
  })
})

describe('validateConfig', () => {
  it('accepts the default config', () => {
    expect(() => {
      validateConfig(resolve({}))
    }).not.toThrow()
  })

  it('accepts explicit legal values', () => {
    const c = resolve({ maxMessageBytes: 1024, idleTimeoutMs: 100, connectWaitMs: 1000, graceMs: 2000, timeoutMs: 30_000 })
    expect(() => {
      validateConfig(c)
    }).not.toThrow()
  })

  it('rejects non-positive or non-integer byte caps', () => {
    for (const field of ['maxMessageBytes', 'maxOutputBytes', 'maxStderrBytes'] as const) {
      for (const bad of [0, -1, 1.5]) {
        expectConfigRejected(resolve({ [field]: bad }), `${field} must be a positive integer`)
      }
    }
  })

  it('rejects non-positive or non-integer timeoutMs', () => {
    for (const bad of [0, -5, 2.5]) {
      expectConfigRejected(resolve({ timeoutMs: bad }), 'timeoutMs must be a positive integer')
    }
  })

  it('rejects timers above the Node delay ceiling', () => {
    for (const field of ['idleTimeoutMs', 'connectWaitMs', 'graceMs'] as const) {
      expectConfigRejected(
        resolve({ [field]: MAX_TIMER_DELAY_MS + 1 }),
        `${field} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
      )
    }
  })

  it('rejects non-positive or non-integer timers', () => {
    for (const field of ['idleTimeoutMs', 'connectWaitMs', 'graceMs'] as const) {
      expectConfigRejected(resolve({ [field]: 0 }), `${field} must be a positive integer`)
      expectConfigRejected(resolve({ [field]: 1.5 }), `${field} must be a positive integer`)
    }
  })

  it('accepts debugPort 0 (auto-pick) and a concrete port, rejects the rest', () => {
    expect(() => {
      validateConfig(resolve({ debugPort: 0 }))
    }).not.toThrow()
    expect(() => {
      validateConfig(resolve({ debugPort: 6007 }))
    }).not.toThrow()
    for (const bad of [-1, 1.5, 65_536]) {
      expectConfigRejected(resolve({ debugPort: bad }), 'debugPort must be an integer between 0 and 65535')
    }
  })

  it('names the offending field in the message', () => {
    expectConfigRejected(resolve({ maxOutputBytes: 0 }), /tool-godot-debug: maxOutputBytes/)
  })
})
