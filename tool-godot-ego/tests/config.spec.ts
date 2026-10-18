/**
 * Config defaults and load-time validation: every key optional, every default
 * documented, every bad budget rejected at load.
 */

import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveConfig, validateConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('fills every default', () => {
    const c = resolveConfig({})
    expect(c.executable).toBe('godot')
    expect(c.executableArgs).toEqual([])
    expect(c.allowEval).toBe(false)
    expect(c.offscreen).toBe(false)
    expect(c.maxFps).toBe(60)
    expect(c.fixedFps).toBe(0)
    expect(c.importTimeoutMs).toBe(120_000)
    expect(c.timeoutMs).toBe(60_000)
    expect(c.requestTimeoutMs).toBe(20_000)
    expect(c.graceMs).toBe(5_000)
    expect(c.maxNodes).toBe(200)
    expect(c.maxProps).toBe(40)
    expect(c.maxWidth).toBe(1280)
  })

  it('keeps disable sentinels (0) intact', () => {
    const c = resolveConfig({ fixedFps: 0, maxNodes: 0, maxWidth: 0, maxFps: 0 })
    expect(c.fixedFps).toBe(0)
    expect(c.maxNodes).toBe(0)
    expect(c.maxWidth).toBe(0)
    expect(c.maxFps).toBe(0)
  })

  it('rejects a blank executable', () => {
    expect(() => resolveConfig({ executable: '   ' })).toThrow(/executable/)
  })

  it('rejects a non-integer frame cap', () => {
    expect(() => resolveConfig({ maxFps: 59.5 })).toThrow(/maxFps/)
  })

  it('rejects a timer above the Node ceiling', () => {
    expect(() => resolveConfig({ graceMs: MAX_TIMER_DELAY_MS + 1 })).toThrow(/graceMs/)
  })

  it('rejects a zero timer', () => {
    expect(() => resolveConfig({ requestTimeoutMs: 0 })).toThrow(/requestTimeoutMs/)
  })

  it('rejects an oversized preview width', () => {
    expect(() => resolveConfig({ maxWidth: 9000 })).toThrow(/maxWidth/)
  })

  it('rejects a zero property budget', () => {
    expect(() => resolveConfig({ maxProps: 0 })).toThrow(/maxProps/)
  })
})

describe('validateConfig', () => {
  it('accepts the resolved defaults', () => {
    expect(() => { validateConfig(resolveConfig({})) }).not.toThrow()
  })
})
