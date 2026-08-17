# Agent Note: Godot debug tool (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-17-godot-debug-tool.zh.md)

## Problem

The harness could validate, run and format Godot projects headless (`tool-godot`) and navigate GDScript (`lsp-godot`), but probing runtime state meant instrumenting the game with `print` statements. The VSCode ecosystem's debugger client (godot-vscode-plugin) proved Godot's game-side remote debugger (`--remote-debug`, a custom binary protocol — not DAP; `--dap-port` is the editor-side path the plugin does not use) is the stable channel for breakpoints, stack dumps and variable snapshots.

## Decision

Add `@deepseek-ai/dsh-tool-godot-debug` at `packages/godot/tool-godot-debug`: the `godot_debug` tool runs one bounded, scripted debug session — CLI breakpoints (`--breakpoints "res://f:l,..."`, single-colon form), headless launch (`godot --headless --path <root> --remote-debug tcp://127.0.0.1:<port>`), per-stop stack/variable snapshots, auto-continue up to `maxStops`, then a structured report with the game output and errors. The call settles only when the run ends or the budget/cancellation fires; the game process tree is terminated on every path.

## Protocol facts (recorded from Godot 4.7, `.context/t3/facts.md`)

- Connection direction: the harness side is the TCP **server** (pre-picked port); the game connects in. Frames are `[u32 LE len][single ARRAY variant]` where the array is `[command, threadId, params]` — flat top-level variant frames are rejected by the game's `_read_in` (observed twice).
- `threadId` is required on commands (Godot ≥ 4.2, from `set_pid`); commands before `set_pid` fail.
- `debug_enter` params: `[isUserBreakpoint, reason, true, 1]` — `reason === 'Breakpoint'` for user stops, an error description for script-error stops (e.g. integer division by zero); the first flag separates the two reliably.
- `stack_dump` params: `[N, file, line, func, ...]` with `N` = total frame-triplet items; lines are **1-based** (matches `godot_validate` output, no conversion).
- `stack_frame_vars` announces a remaining count, then that many `stack_frame_var [name, scope(0|1|2), type, value, className]` — the fifth `className` element is unused by the source plugin.
- `debug_exit` is the "left the paused state" event paired with `continue`, **not** a game-exit signal; a headless game without `--quit-after` keeps running, so the tool terminates the process after the run.
- `output` messages carry `PackedStringArray` (type 34) with trailing NUL and multi-line entries; `error` messages carry 10 fixed fields plus a stack triplet list.
- CLI breakpoints work headless; the game does **not** auto-import — a project without a `.godot` global-class cache raises a Parser Error stop instead of running.

## Source-plugin bugs fixed during porting (do not reintroduce)

- `encode_String` used UTF-16 `str.length` as the byte length: non-ASCII paths corrupted (truncated writes, desynced padding). Fixed with `Buffer.byteLength`; test with a Chinese `res://` path.
- `encode_variant` wrote zero bytes for `undefined` while `size_variant` reserved 4: size-mismatched frames. The encoder now throws on `undefined`.
- `PACKED_FLOAT64_ARRAY` decoded with the 32-bit reader (dead-code `decodePackedFloat64Array`). The branch now reads 64-bit.

## Cancellation and ownership semantics

- v1 is launch-only, so the harness owns the game process: cancellation (tool-call timeout / caller signal) = `exec.signal` → terminate the process tree, then await the process (`kill → await done`, Windows-safe against orphans). Attach mode was delivered later ([2026-08-18-godot-debug-attach.md](2026-08-18-godot-debug-attach.md)): there the tool never owns or kills the game — teardown is best-effort breakpoint removal + continue + disconnect.
- All protocol waits are bounded (`idleTimeoutMs`) and signal-aware; a stop wait that elapses means "no more stops" (partial result with output), not an error. A snapshot wait that elapses marks `varsTruncated` and keeps the stop with empty scopes.
- Output/error collection is byte-capped (`maxOutputBytes`) with an `outputTruncated` flag; per-scope variable caps (200) with `scopeTruncated`; value length caps.
- The game's user-data dir must be writable: game mode crashes (signal 11) when `user://` creation fails (observed under the harness sandbox; `APPDATA` redirect is the workaround in tests).
- Reuse is limited to lsp-godot's already-exported `verifyGodotVersion` and `pickFreePort`; the codec, framing, controller and tool pipeline are package-owned (no new exports added to tool-godot/lsp-godot).

## Alternatives considered

- **DAP layer over the editor's `--dap-port`** — Godot's editor-side DAP server is a separate path from the game-side `--remote-debug` channel the source plugin ships with; speaking Godot's binary protocol directly removes a translation layer and matches the proven client (`vscode-debugadapter` was not ported).
- **Attach-first tool** — a break→snapshot→continue probe on a user-launched game needs a pre-arranged port and a running game, which a one-shot call cannot guarantee; launch-first owns the process and the budget. Attach was delivered later with an explicit-port + start-after-call contract ([2026-08-18-godot-debug-attach.md](2026-08-18-godot-debug-attach.md)).
- **Stateful session tools** (start/continue/query across calls) — conflicts with the tool suite's no-background-job principle and needs new session infrastructure; the scripted run covers the model-visible need.
- **Extending `tool-godot`** — the codec/controller/tool pipeline (~2000 lines) would double that package and force cross-package config coupling; a sibling package keeps the tool family's cohesion (`tool-godot` covers CLI workflows, this covers debug runs) without new exports from existing packages.
- **Lazy object expansion** (`scene:inspect_object` round-trips like the source plugin's VariablesManager) — a one-shot tool cannot afford interactive expansion; bounded direct rendering of the per-stop variable list is deterministic and budget-safe. Object variables render as `Object<id>`.
- **Dynamic `breakpoint` commands** — the CLI `--breakpoints` form is pinned by T3.0 and avoids post-connect handshakes; dynamic stops were delivered with attach ([2026-08-18-godot-debug-attach.md](2026-08-18-godot-debug-attach.md)).

## Consequences

- Breakpoints need a debug-capable binary; exported release builds may not deliver stops.
- `--breakpoints` values cannot escape commas (Godot splits on `,`).
- Variable rendering follows the source plugin's display precision (`toFixed(1)` math types, `toFixed(5)` floats); lazy object expansion (`scene:inspect_object`) and variable editing are deferred, so object variables render as `Object<id>`.
- A harness crash can orphan the spawned game (subprocess seam cleans up only on the normal lifecycle).

## Testing

- 66 unit/integration tests (7 files), all keyless: codec anchored to the real-Godot byte fixture (`t3-breakpoints.bin`/`t3-error.bin`/`t3-norun.bin` recordings from `.context/t3/`), framing (short-prefix safety), controller against a fake game replaying the recording (threadId, stops, snapshots, output caps, timeouts, cancellation, disposal), snapshot rendering, the run pipeline (version gate, project/breakpoint validation, no-stop runs, early exit), a REAL composition (tool → subprocess seam → fake godot executable → fake game) asserting model-visible output, snapshot and HMR disposal, and a real-Godot smoke (`GODOT_EXE`-gated) that hits two breakpoints against Godot 4.7.
