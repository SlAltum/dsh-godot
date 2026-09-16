# dsh-godot — Godot capability family for DeepSeek Harness

English | [中文](README.zh.md)

A family of Godot Engine plugins for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent harness: headless project tooling, GDScript semantic navigation, and a scripted debugger. Maintained as an independent repository; the packages build inside the harness monorepo workspace.

## Features

| Package | Role | DSH seam |
|---|---|---|
| `tool-godot/` | Headless CLI tools: `godot_validate`, `godot_run_scene`, `godot_format`, `godot_inspect`, `godot_editor_script` | `ctx.tools` |
| `lsp-godot/` | GDScript navigation (`goToDefinition` / `findReferences` / `hover`) via Godot's built-in TCP language server, attach or spawn | `ctx.lsp` |
| `tool-godot-debug/` | `godot_debug`: one bounded scripted debug run — breakpoints, headless launch, per-stop stack/variable snapshots, structured report | `ctx.tools` |
| `ui-godot/` | Web settings card for the `godot` namespace (persistent client package, `dsh.client` row) | browser slots |

The capabilities were migrated from **godot-vscode-plugin** (Godot Tools v2.7.1, ~700k installs), keeping the pure-logic cores; the migration is pinned by protocol facts recorded against a real Godot 4.7 instance. See [docs/architecture.md](docs/architecture.md) for the module map and protocol-fact pointers.

## Prerequisites

- **Godot 4.2+.** The CLI tools and the debugger require a Godot 4.2 or newer build with `--headless` support (spawn-mode LSP's version gate also accepts 3.6+).
- **Host binaries, resolved at call time.** godot (and gdformat for the default `godot_format` backend) are host installs, never bundled; a missing executable surfaces as the structured `GODOT_UNAVAILABLE` error at call time, never at load time.
- **One-time project import.** Headless game mode does not auto-import; run `godot --headless --editor --path <root> --import --quit` once per project, or expect a slower first run.
- **Writable game user data.** The game's `user://` directory must be writable; game mode otherwise crashes with signal 11.

## Installation

Mount like any harness plugin — one line in a `cordis.yml` composition, or `ctx.plugin()` in-process:

```ts
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'
import * as GodotLsp from '@deepseek-ai/dsh-lsp-godot'
import * as ToolGodotDebug from '@deepseek-ai/dsh-tool-godot-debug'

// A deployment points at its godot install; the default resolves `godot` on PATH.
export async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodot, { executable: 'C:\\Godot\\godot.exe' })
  await ctx.plugin(GodotLsp, { connectMode: 'spawn', spawnExecutable: 'C:\\Godot\\godot.exe' })
  await ctx.plugin(ToolGodotDebug, { executable: 'C:\\Godot\\godot.exe' })
}
```

## Configuration

Every key has a default; per-package details live in each package's README.

| Package | Notable config | Defaults that matter |
|---|---|---|
| `tool-godot` | `executable`, `gdformatExecutable`, `formatBackend: 'gdformat' \| 'builtin'`, `timeoutMs` | `executable: godot`; `timeoutMs: 60000` |
| `lsp-godot` | `connectMode: attach \| spawn \| auto`, `ports`, `spawnExecutable`, `spawnPort`, `spawnReadyTimeoutMs` | `connectMode: auto`; `ports: [6005]` |
| `tool-godot-debug` | `executable`, `debugPort` (0 = auto-pick), `connectWaitMs`, `idleTimeoutMs`, `maxOutputBytes` | `debugPort: 0`; `connectWaitMs: 20000`; `maxStops` capped at 50 per call |

## Model-facing tools

| Tool | Package | Purpose |
|---|---|---|
| `godot_validate` | tool-godot | Project/script validation via the headless editor (structured issues). |
| `godot_run_scene` | tool-godot | Run a scene headless, capture output. |
| `godot_format` | tool-godot | Format a `.gd` file (gdformat or builtin backend); read-only, returns text. |
| `godot_inspect` | tool-godot | Pure parse of `project.godot` / `.tscn` / `.tres` structure. |
| `godot_editor_script` | tool-godot | Run a `res://` EditorScript in the headless editor. |
| `lsp` | (tool-lsp) | `.gd` navigation: `goToDefinition` / `findReferences` / `hover` via the Godot provider. |
| `godot_debug` | tool-godot-debug | One scripted debug run: breakpoints, headless launch, per-stop snapshots, auto-continue, structured report. |

## How it works

- **LSP.** Godot ships a TCP language server (EditorSettings `network/language_server/remote_port`, default 6005). `lsp-godot` attaches to a running editor, or spawns a headless one (`--lsp-port`) and pools providers per workspace; `.gd` queries (`goToDefinition` / `findReferences` / `hover`) are served through the harness `ctx.lsp` seam.
- **Debugger.** Godot's remote debugger speaks a custom binary protocol over `--remote-debug` — not DAP. Frames are `[u32 LE length][variant-encoded array]` of `[command, threadId, params]` (Godot 4.2+). `godot_debug` binds a pre-picked free port, spawns the game headless, snapshots the stack and locals/members/globals at each stop, and auto-continues up to `maxStops`.
- **Scope.** `godot_debug` v1 is a launch-only scripted run that owns its game process; attach-mode debugging and stateful sessions are future work.

## Deployment notes

- Spawn modes write `.godot/` import artifacts and may exceed the 60 s tool budget on large-project cold start (raise `timeoutMs` / `spawnReadyTimeoutMs`).
- Attach modes require the matching project open in a running Godot editor (LSP: the editor's language server on `127.0.0.1:6005`).
- `godot_debug` terminates its game process on every path; a crashed harness can still orphan it.

## Building from source

- The packages depend on `@deepseek-ai/dsh-*` workspace packages and build/test against the harness monorepo workspace (Node.js ^22.19 or >= 24, pnpm).
- To build fully standalone, switch those dependencies to the published npm versions (all required packages are public on npm) and provide your own test/lint/tsconfig setup.

## Repository layout

- `tool-godot/`, `lsp-godot/`, `tool-godot-debug/`, `ui-godot/` — the four packages above (see [architecture](docs/architecture.md) for the module map).
- `docs/` — architecture documentation.

## Testing

Tested on:

- **OS**: Windows 11 (build 26200)
- **Shell**: PowerShell 7 (7.6.3)
- **Godot**: 4.7 stable (console build)
- **Node.js**: 24 (v24.19.0)
- **DSH**: 0.1.0-rc.5 (harness monorepo workspace)

Run the unit suites from the monorepo root: `pnpm exec vitest run packages/godot/lsp-godot packages/godot/tool-godot-debug`. Real-Godot integration suites (e.g. the debugger smoke) are opt-in via `GODOT_EXE`.

## Known limitations and deferred work

- Attach-mode debugging, dynamic breakpoints, scene-tree snapshots, multi-thread stops, lazy object expansion and variable editing are future work (the pinned protocol facts keep those paths open).
- The builtin formatter's whitespace rules follow godot-vscode-plugin, not gdformat.
- `godot_format` is read-only by design; the model applies changes through the file-policy surface.
- Breakpoints need a debug-capable binary; exported release builds may not deliver stops.
- A crashed harness can orphan a spawned godot process.
- Variable rendering follows the source plugin's display precision (`toFixed(1)` math types, `toFixed(5)` floats).

## License

Released under the MIT License. See [LICENSE](LICENSE) for the full text.
