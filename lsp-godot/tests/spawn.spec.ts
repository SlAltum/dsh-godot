/**
 * S7: spawn-mode editor orchestration. `verifyGodotVersion` enforces the
 * headless-LSP version gate (Godot 4.2+ / 3.6+, source plugin's
 * verify_godot_version), `pickFreePort` pre-selects a concrete port for
 * `--lsp-port` (never port 0, plan D6), and `spawnGodotLsp` orchestrates
 * version probe → port pick → editor spawn through an injected spawner and
 * version probe, so the orchestration is testable without a real Godot
 * binary (real process wiring lands in the plugin assembly).
 */

import { describe, expect, it, vi } from 'vitest'
import { verifyGodotVersion, pickFreePort, spawnGodotLsp, type EditorSpawner, type SpawnedEditor } from '../src/spawn.ts'

describe('verifyGodotVersion', () => {
  it('accepts Godot 4.2+ for a 4.x project', () => {
    expect(verifyGodotVersion('4.2.stable.official.0000', '4')).toEqual({ ok: true, version: '4.2' })
    expect(verifyGodotVersion('4.7.stable.mono.official.5b4e0cb0f', '4')).toEqual({ ok: true, version: '4.7' })
  })

  it('rejects Godot below 4.2 for a 4.x project', () => {
    expect(verifyGodotVersion('4.1.4.stable.official', '4')).toEqual({ ok: false, version: '4.1' })
  })

  it('accepts Godot 3.6+ for a 3.x project and rejects older', () => {
    expect(verifyGodotVersion('3.6.stable.official', '3')).toEqual({ ok: true, version: '3.6' })
    expect(verifyGodotVersion('3.5.3.stable.official', '3')).toEqual({ ok: false, version: '3.5' })
  })

  it('rejects an unknown project major with the version still reported', () => {
    expect(verifyGodotVersion('4.7.stable', '5')).toEqual({ ok: false, version: '4.7' })
  })

  it('rejects an unparsable version line', () => {
    expect(verifyGodotVersion('not a version', '4')).toEqual({ ok: false, version: 'not a version' })
  })

  it('rejects a Godot major that is neither 3 nor 4', () => {
    expect(verifyGodotVersion('5.0.stable', '5')).toEqual({ ok: false, version: '5.0' })
  })
})

describe('pickFreePort', () => {
  it('returns a bindable TCP port in the ephemeral range', async () => {
    const port = await pickFreePort()
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
    // The port must actually be bindable (the race window is accepted, plan D6).
    const { createServer } = await import('node:net')
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => { resolve() })
    })
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })
})

describe('spawnGodotLsp', () => {
  const editor: SpawnedEditor = { port: 12345, close: vi.fn(), stderrTail: '', get dead() { return false } }

  function base(overrides: Partial<Parameters<typeof spawnGodotLsp>[0]> = {}) {
    const versionProbeMock = vi.fn(async () => '4.7.stable')
    const spawnEditorMock = vi.fn(async () => editor)
    const options = {
      executable: 'godot',
      spawnArgs: [] as string[],
      projectDir: 'D:/proj',
      spawnPort: 0,
      signal: new AbortController().signal,
      versionProbe: versionProbeMock,
      spawner: { spawnEditor: spawnEditorMock } satisfies EditorSpawner,
      ...overrides,
    }
    return { options, versionProbeMock, spawnEditorMock }
  }

  it('probes the version, picks a port, and spawns the editor', async () => {
    const { options, versionProbeMock, spawnEditorMock } = base()
    const result = await spawnGodotLsp(options)
    expect(result.port).toBe(12345)
    expect(result.editor).toBe(editor)
    expect(versionProbeMock).toHaveBeenCalledWith('godot')
    expect(spawnEditorMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectDir: 'D:/proj', executable: 'godot' }),
      options.signal,
    )
  })

  it('uses the configured spawn port when nonzero', async () => {
    const { options, spawnEditorMock } = base({ spawnPort: 6010 })
    await spawnGodotLsp(options)
    expect(spawnEditorMock).toHaveBeenCalledWith(expect.objectContaining({ port: 6010 }), options.signal)
  })

  it('rejects before spawning when the version gate fails', async () => {
    const { options, spawnEditorMock } = base({ versionProbe: vi.fn(async () => '4.1.stable') })
    await expect(spawnGodotLsp(options)).rejects.toThrow(/4\.2/)
    expect(spawnEditorMock).not.toHaveBeenCalled()
  })

  it('propagates a spawn failure', async () => {
    const { options } = base({ spawner: { spawnEditor: vi.fn(async () => { throw new Error('boom') }) } })
    await expect(spawnGodotLsp(options)).rejects.toThrow('boom')
  })

  it('propagates a version-probe failure', async () => {
    const { options } = base({ versionProbe: vi.fn(async () => { throw new Error('no godot binary') }) })
    await expect(spawnGodotLsp(options)).rejects.toThrow('no godot binary')
  })

  it('rejects an unparsable version probe output', async () => {
    const { options, spawnEditorMock } = base({ versionProbe: vi.fn(async () => 'garbage output') })
    await expect(spawnGodotLsp(options)).rejects.toThrow(/headless LSP requires/)
    expect(spawnEditorMock).not.toHaveBeenCalled()
  })
})
