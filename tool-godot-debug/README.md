# @deepseek-ai/dsh-tool-godot-debug

English | [中文](README.zh.md)

The **`godot_debug` tool** runs one bounded, scripted debug session against a Godot project: the model sets breakpoints (`res://` path or absolute file path + line), the tool launches the project headless with `--remote-debug`, snapshots the stack and locals/members/globals at each stop, auto-continues up to `maxStops`, then returns a structured report with the game's output and errors — no print-statements needed to probe runtime state.

Like the tool-godot suite, the tool is **spawn-backed and one-shot**: `godot_debug` never exposes a background job; the call returns only after the run exits, is terminated by the cooperative timeout, is aborted, or fails. The package injects `tools`, `systemPrompt`, and `subprocess` — deliberately not `fs`; only project-root validation and breakpoint-path conversion touch the filesystem, through plain `node:fs`.

```ts
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodotDebug from '@deepseek-ai/dsh-tool-godot-debug'

// A deployment points at its godot install; the default resolves `godot` on PATH.
export async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodotDebug, { executable: 'C:\\Godot\\godot.exe' })
}
```

## How it works

The Godot 4 debugger protocol is a **custom binary protocol** (not DAP): this side binds a pre-picked free port, spawns `godot --path <root> --headless --remote-debug "tcp://127.0.0.1:<port>" [--breakpoints "res://f:l,..."] [scene] [-- args]`, and the game connects in as the TCP client. Each frame is a `[u32 LE length][variant-encoded array]` where the array is `[command, threadId, params]` (Godot 4.2+). On every stop the tool requests the stack dump and frame variables, snapshots them (bounded depth), and continues. Protocol facts are pinned in `.context/t3/facts.md` (real-Godot 4.7 measurements).

## Settings

The package does **not** register a settings namespace (tool-godot owns the `godot` namespace); the executable and caps are composition-level config.

## Config

Every key has a default; a deployment only overrides what its environment needs.

| Key | Default | Meaning |
|---|---|---|
| `executable` | `godot` | godot executable path or PATH command name. |
| `executableArgs` | `[]` | Fixed argv elements inserted after the godot executable (deployment wrappers). |
| `debugPort` | `0` | Remote-debug port the game connects to; `0` = auto-pick a free port (default). A fixed port helps deployments that must allow the inbound rule. |
| `maxMessageBytes` | `16777216` | Largest single framed protocol message accepted from the game. |
| `maxOutputBytes` | `1048576` | Max bytes of game `output`/`error` content retained in one run; a lossy run marks the result `outputTruncated`. |
| `maxStderrBytes` | `1048576` | Max bytes of the spawned game's stderr retained for diagnostics. |
| `idleTimeoutMs` | `10000` | Partial-frame / response-stall budget before the connection is dropped; cannot exceed [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md). |
| `connectWaitMs` | `20000` | Budget for the game to connect after spawn (cold start + first import). |
| `graceMs` | `5000` | Terminate-escalation grace before an aborted run settles; cannot exceed `MAX_TIMER_DELAY_MS`. |
| `timeoutMs` | `60000` | Cooperative tool-call budget, enforced by the tool-call timeout policy through `exec.signal`. First-run project import may need a larger budget. |

## Tool

| Tool | Arguments | Behavior |
|---|---|---|
| `godot_debug` | `path?`, `scene?`, `breakpoints?` (`[{file, line}]`), `maxStops?` (default 10, cap 50), `args?`, `timeoutMs?` | One bounded debug run: validate project (a breakpoint file outside the project root is `GODOT_PARSE_ERROR`), verify `--version` ≥ 4.2, pick a free port, spawn the game headless, wait for `set_pid` (threadId readiness), then loop: wait for a stop (breakpoint hit or script error), snapshot stack + vars, continue — until `maxStops`, the game exits, or the budget ends. Returns `{ stops, output, errors, exit, outputTruncated?, varsTruncated? }`. |

## Errors

Failures carry the package-owned `GodotError` (a `HarnessError` subclass), surfaced as `{ name, code }` on `isError` results: `GODOT_UNAVAILABLE` (executable/version/launch/connect failures, with the version or stderr tail), `GODOT_PARSE_ERROR` (unreadable project, breakpoint outside the project, or a malformed/oversized protocol frame), and `GODOT_ABORTED` (cooperative timeout or caller cancellation). A run that completes without any stop is a successful partial result (`stops: []` with output and errors), not an error.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the independently registered godot-debug guidance below. Agent-scoped tool restrictions can hide the schemas without removing the prompt section.

##### Godot debug guidance (tool:godot-debug)

```markdown
Use godot_debug to run a Godot scene under the debugger: set breakpoints (res:// path or absolute file path plus line), the tool launches the project headless, snapshots the stack and locals/members/globals at each stop, and auto-continues up to maxStops. Returns per-stop stack frames and variable values plus the game output and errors.
```

#### Token effect

Fixed guidance cost per request while the tools are registered.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation, disposal, or editing the text may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The generated `godot_debug` schema in the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-godot-debug) describes the arguments and canonical output; the tool is registered unconditionally, so a missing host executable never changes the schema.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Results

#### What the model sees

`godot_debug` returns a generic card: a `N stops at <file>:<line> (maxStops)` head, one `#i <file>:<line> @ <function> [reason]` line per stop, the first stop's full locals/members/globals, and the output/error summary with truncation notes.

#### Token effect

Bounded by `maxStops` × the per-stop render caps (depth 3, 200 vars per scope) and `maxOutputBytes`.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

### Tool errors

#### What the model sees

Failures are normalized as `Error: <message>` with structured `GODOT_UNAVAILABLE`, `GODOT_PARSE_ERROR`, or `GODOT_ABORTED` metadata.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only.

## Known Limitations and Deferred Work

- **godot is a host install** — no binary ships with the package; a missing executable fails calls at call time (`GODOT_UNAVAILABLE`), never at load time.
- **Headless debug requires a project that was imported once** — game mode does not auto-import, and a missing `.godot` global-class cache raises a Parser Error stop instead of running; run `godot --headless --editor --path <root> --import --quit` first, or expect the first run to report it.
- **Breakpoints need a debug-capable binary** — exported release builds may not deliver stops; standard builds do.
- **`--breakpoints` values cannot escape commas** — Godot splits the argument on `,`, so a file name containing a comma cannot be targeted via CLI breakpoints (use `godot_debug`'s `args` to pass it and rely on dynamic stops instead, or rename the file).
- **The game user-data dir must be writable** — Godot's game mode crashes (signal 11) when `user://` creation fails (e.g. sandboxed/container deployments); point the environment's `APPDATA` (Windows) at a writable dir or document the deployment requirement.
- **First-run import latency** — the first headless run imports assets; the default 60 s budget may need raising via `timeoutMs` for large projects.
- **Variable rendering follows the source plugin's display precision** — math types render via `stringify_value` with `toFixed(1)` rounding (`0.123456` → `0.1`); object expansion (`scene:inspect_object`) and variable editing are deferred.
- **attach mode, dynamic breakpoints, scene-tree snapshots, and multi-thread stops are deferred** — v1 is a launch-only scripted run; the raw protocol facts (`.context/t3/facts.md`) keep those paths open.
- **A crashed harness may leave an orphaned godot process** — the tool terminates the process tree on teardown; an abrupt harness death can still orphan the spawned game.
