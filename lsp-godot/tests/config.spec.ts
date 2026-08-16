/**
 * S5: plugin configuration schema and load-time validation, aligned with
 * lsp-stdio's assertTimer/assertPositiveInteger conventions. Ports must be
 * valid TCP ports (spawnPort 0 = provider-picked), timers must fit Node's
 * scheduling range, and byte caps must be positive integers.
 */

import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Config, validateConfig, type ConnectMode } from '../src/config.ts'

describe('lsp-godot Config schema', () => {
  it('fills defaults for every optional key', () => {
    const resolved = Config({})
    expect(resolved.host).toBe('127.0.0.1')
    expect(resolved.ports).toEqual([6005])
    expect(resolved.connectMode).toBe('auto')
    expect(resolved.connectTimeoutMs).toBe(1500)
    expect(resolved.idleTimeoutMs).toBe(10_000)
    expect(resolved.spawnExecutable).toBe('godot')
    expect(resolved.spawnArgs).toEqual([])
    expect(resolved.spawnPort).toBe(0)
    expect(resolved.spawnReadyTimeoutMs).toBe(120_000)
    expect(resolved.maxDocumentBytes).toBe(4_000_000)
    expect(resolved.maxMessageBytes).toBe(16_000_000)
    expect(resolved.maxStderrBytes).toBe(1_000_000)
    expect(resolved.killGraceMs).toBe(2_000)
  })

  it('accepts explicit values', () => {
    const resolved = Config({
      host: '192.168.1.5',
      ports: [6005, 6008],
      connectMode: 'spawn',
      spawnExecutable: 'C:/Godot/godot.exe',
      spawnPort: 6010,
    })
    expect(resolved.host).toBe('192.168.1.5')
    expect(resolved.ports).toEqual([6005, 6008])
    expect(resolved.connectMode).toBe('spawn')
    expect(resolved.spawnPort).toBe(6010)
  })

  it('rejects a non-connect-mode value', () => {
    // The union is enforced at runtime by schemastery; the type cast simulates
    // a hostile or stale config value.
    expect(() => Config({ connectMode: 'detach' as ConnectMode })).toThrow()
  })
})

describe('validateConfig', () => {
  it('accepts a fully defaulted config', () => {
    expect(() =>{  validateConfig(Config({})) }).not.toThrow()
  })

  it('rejects an empty ports list', () => {
    expect(() =>{  validateConfig(Config({ ports: [] })) }).toThrow(/ports/i)
  })

  it('rejects ports outside 1..65535', () => {
    expect(() =>{  validateConfig(Config({ ports: [0] })) }).toThrow(/port/i)
    expect(() =>{  validateConfig(Config({ ports: [6005, 70000] })) }).toThrow(/port/i)
    expect(() =>{  validateConfig(Config({ ports: [-1] })) }).toThrow(/port/i)
  })

  it('rejects a spawnPort outside 0..65535', () => {
    expect(() =>{  validateConfig(Config({ spawnPort: -1 })) }).toThrow(/spawnPort/i)
    expect(() =>{  validateConfig(Config({ spawnPort: 70000 })) }).toThrow(/spawnPort/i)
  })

  it('accepts spawnPort 0 (provider-picked) and a valid port', () => {
    expect(() =>{  validateConfig(Config({ spawnPort: 0 })) }).not.toThrow()
    expect(() =>{  validateConfig(Config({ spawnPort: 6010 })) }).not.toThrow()
  })

  it('rejects timer values above MAX_TIMER_DELAY_MS', () => {
    expect(() =>{  validateConfig(Config({ connectTimeoutMs: MAX_TIMER_DELAY_MS + 1 })) }).toThrow(/connectTimeoutMs/i)
    expect(() =>{  validateConfig(Config({ idleTimeoutMs: MAX_TIMER_DELAY_MS + 1 })) }).toThrow(/idleTimeoutMs/i)
    expect(() =>{  validateConfig(Config({ killGraceMs: MAX_TIMER_DELAY_MS + 1 })) }).toThrow(/killGraceMs/i)
    expect(() =>{  validateConfig(Config({ spawnReadyTimeoutMs: MAX_TIMER_DELAY_MS + 1 })) }).toThrow(/spawnReadyTimeoutMs/i)
  })

  it('rejects non-positive byte caps', () => {
    expect(() =>{  validateConfig(Config({ maxDocumentBytes: 0 })) }).toThrow(/maxDocumentBytes/i)
    expect(() =>{  validateConfig(Config({ maxMessageBytes: -5 })) }).toThrow(/maxMessageBytes/i)
    expect(() =>{  validateConfig(Config({ maxStderrBytes: 0 })) }).toThrow(/maxStderrBytes/i)
  })

  it('rejects non-integer timers and byte caps', () => {
    expect(() =>{  validateConfig(Config({ connectTimeoutMs: 1.5 })) }).toThrow(/connectTimeoutMs/i)
    expect(() =>{  validateConfig(Config({ maxMessageBytes: 100.5 })) }).toThrow(/maxMessageBytes/i)
  })
})
