# dsh-godot — Architecture

English | [中文](architecture.zh.md)

The full module map, data flows and protocol notes behind the [repository README](../README.md). README answers "what is this and how do I use it"; this document answers "how is it built and why".

## Module map

Godot is an optional capability, not part of the harness core: `dsh-base` and `dsh-web-app` mount none of these rows. `bundle-godot/` is the only supported install path — it is a profile bundle that inserts the five rows and carries the settings card on its Plugins page. Remove the bundle and the tools, LSP provider, debugger, sandbox, and browser surface all disappear together.

| Module | Responsibility | Start here |
|---|---|---|
| **bundle** | Optional profile layer that installs the family together and carries the settings card; no runtime code | [`bundle-godot/README.md`](../bundle-godot/README.md) · `cordis.patch.yml` |
| **tool-godot** | Headless CLI tools and the `godot` settings namespace | [`tool-godot/README.md`](../tool-godot/README.md) · [`src/index.ts`](../tool-godot/src/index.ts) |
| **lsp-godot** | GDScript language-server provider (attach / spawn / auto) | [`lsp-godot/README.md`](../lsp-godot/README.md) · [`src/index.ts`](../lsp-godot/src/index.ts) |
| **tool-godot-debug** | One bounded scripted debug run through Godot's remote-debug protocol | [`tool-godot-debug/README.md`](../tool-godot-debug/README.md) · [`src/index.ts`](../tool-godot-debug/src/index.ts) |
| **tool-godot-ego** | Persistent visual sandbox: play, observe, read, operate, stop | [`tool-godot-ego/README.md`](../tool-godot-ego/README.md) · [`src/index.ts`](../tool-godot-ego/src/index.ts) |
| **ui-godot** | Browser half: settings card on the bundle page and the sandbox watch panel | [`ui-godot/README.md`](../ui-godot/README.md) · [`src/client/index.ts`](../ui-godot/src/client/index.ts) |

Each module README is the navigation point for that module: it names the source entry, the model-facing surface, and the behavior that is easy to break. This document stays at the module boundary; the sections below describe only the flows that cross modules and the protocol facts they depend on.

The repository also keeps per-module `tests/` next to the code and `.context/` local-only development assets (probe projects, recordings, plans); both are outside this module map.

## Data flows

**CLI tools (tool-godot).** The tool layer builds argv and schema-validates arguments; `ctx.subprocess` owns spawn, process-tree termination, environment scrubbing and bounded output capture. Every call is an ordinary foreground spawn with `exec.signal` forwarded — the cooperative timeout and caller cancellation terminate the process tree. Results are bounded (`stdoutMaxBytes`/`stderrMaxBytes`, `validateMaxErrors`) and truncation is reported, never silent.

**LSP navigation (lsp-godot).** The provider speaks JSON-RPC over TCP to Godot's built-in language server. Query flow: canonicalize the workspace, read the source (bounded), ensure a connection (attach to the running editor's port, or spawn a headless editor owned by the provider), negotiate capabilities, `didOpen` transiently, send the operation request, normalize the response (Godot URI + hover cleaning), `didClose`. Per-workspace connections are pooled with serialized queues; an aborted query means disconnect (Godot ignores `$/cancelRequest`), and the next query rebuilds the connection. A `changeWorkspace` notification that does not match the query workspace fails the query (`LSP_UNAVAILABLE`).

**Debug runs (tool-godot-debug).** The harness side is the TCP **server**: it pre-picks a port, spawns `godot --headless --path <root> --remote-debug tcp://127.0.0.1:<port>`, and the game connects in. Frames are `[u32 LE length][single variant-encoded array]` where the array is `[command, threadId, params]` (Godot ≥ 4.2). The run pipeline: wait for `set_pid` (threadId readiness), then loop stop → snapshot → continue up to `maxStops`: on each `debug_enter` request the stack dump and frame variables, render them (bounded depth/size), then `continue`. `debug_exit` marks leaving the paused state, not game exit; a headless game without `--quit-after` keeps running, so the tool terminates the process tree and awaits it (`kill → await done`). Cancellation, timeouts and protocol failure each settle the call exactly once.

**Visual sandbox (tool-godot-ego).** The host binds `127.0.0.1:0`, writes a boot `SceneTree` and a bridge node to a temporary directory outside the project, and spawns `godot --path <root> --script <boot.gd> --windowed`. The temporary main loop injects the bridge, then changes to the main scene or to `DSH_EGO_SCENE` when `godot_play` passed a scene; `project.godot` and `res://` stay untouched. The bridge connects back through the environment-provided port and token, keeps `process_mode = PROCESS_MODE_ALWAYS` so a paused game still answers, captures frames into memory, computes `shotdiff` metrics inside the engine, reads node properties through `get_property_list`, and pushes input through `Viewport.push_input`. One workspace owns at most one session; dispose closes the socket, terminates the process, and removes the temporary scripts. The `ui-godot` browser half registers a `shell.overlay` watch ball, polls `/api/godot/sessions`, streams `/api/godot/view`, and forwards frame clicks to `/api/godot/input`.

## Protocol facts

Pinned against a real Godot 4.7 (the probe facts are local-only assets; the essential facts below are what the code and tests encode):

- **LSP**: `textDocumentSync` is `{ change: 1, openClose: true }`; `positionEncoding` defaults to utf-16; project mismatch is announced by `gdscript_client/changeWorkspace` before the initialize response; `$/cancelRequest` is ignored; hovers carry a leading tab (and bbcode residue on older versions); URIs are `%3A`-encoded.
- **Debugger**: the game connects in; frames are single-array variants (flat top-level variants are rejected by the game's `_read_in`); commands need `threadId` from `set_pid`; `debug_enter` params are `[isUserBreakpoint, reason, true, 1]` (`reason === 'Breakpoint'` for user stops, an error description for script errors); `stack_dump` lines are 1-based; `output` messages carry `PackedStringArray` (type 34); `stack_frame_var` has a fifth `className` element the source plugin ignores.

## Source-plugin bugs fixed during porting

- `encode_String` used UTF-16 `str.length` as the byte length — non-ASCII paths corrupted. Fixed with `Buffer.byteLength`; tested with a Chinese `res://` path.
- `encode_variant` wrote zero bytes for `undefined` while `size_variant` reserved 4 — size-mismatched frames. The encoder throws on `undefined`.
- `PACKED_FLOAT64_ARRAY` decoded with the 32-bit reader. The branch now reads 64-bit.

## Testing

The test suites are keyless: codec, framing and controller tests replay **recorded real-Godot bytes** (`t3-breakpoints.bin`, `t3-error.bin`, `t3-norun.bin` in `tool-godot-debug/tests/fixtures/`; lsp transcripts in `lsp-godot/tests/fixtures/t0-responses.json`), so CI needs no Godot binary. REAL-composition tests boot the full in-process chain (tool → subprocess seam → fake godot executable → fake game/server) and assert model-visible output, snapshots and HMR disposal. A `GODOT_EXE`-gated real-machine smoke runs the debug tool against a real Godot 4.7 (two breakpoints, stack/vars, output). Verified on Windows 11, PowerShell 7, Godot 4.7, Node.js 24, DSH 0.1.0-rc.5 (see README "Testing environment").

### Deployment-environment notes

- **`user://` must be writable.** Game mode crashes (signal 11 / 0xC0000005) when the user-data dir cannot be created; sandboxed/container deployments must redirect `APPDATA` to a writable dir.
- **Headless game mode does not auto-import.** A project without a `.godot` global-class cache raises a Parser Error stop instead of running; import once first (`--headless --editor --import --quit`).
- **First-run import latency.** Headless editor/game cold start imports assets and can exceed the 60 s tool budget on large projects (config `timeoutMs` / `spawnReadyTimeoutMs`).
- **`--breakpoints` values cannot escape commas** (Godot splits on `,`).
- **Cancellation semantics.** The game ignores `$/cancelRequest` (LSP) — cancellation means disconnect; the next query rebuilds the connection. For the debugger, cancellation means terminating the game process tree and awaiting it.
