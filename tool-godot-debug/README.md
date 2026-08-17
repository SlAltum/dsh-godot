# @deepseek-ai/dsh-tool-godot-debug

English | [中文](README.zh.md)

The **`godot_debug` tool** runs one bounded, scripted debug session against a Godot project: the model sets breakpoints (`res://` path or absolute file path + line), the tool launches the project headless with `--remote-debug`, snapshots the stack and locals/members/globals at each stop, auto-continues up to `maxStops`, then returns a structured report with the game's output and errors — no print-statements needed to probe runtime state. Object variables are expanded in place on the first stop (properties under `expanded objects`, with nested objects expanded recursively up to `maxExpandDepth`), the model can **edit object properties while paused** (`edits`: set a property on a top-level object variable, each write verified against the engine and reported `ok`/`failed`), and the **scene tree** (current node hierarchy) is snapshotted on every frame-bearing stop. A second mode, `mode: "attach"`, joins a game the user already started with `--remote-debug tcp://127.0.0.1:<port>`: breakpoints are sent dynamically after connect, and the game keeps running after detach.

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

In **attach mode** the tool only binds the port and waits: the user starts the game themselves (`godot --path <root> --remote-debug tcp://127.0.0.1:<port>`), the tool sends the breakpoints dynamically after `set_pid` (the only attach source — CLI `--breakpoints` is launch-only), optionally pauses once with `break` (`pauseOnAttach`), runs the same stop loop, then detaches: best-effort breakpoint removal + continue + disconnect. The game is never killed and keeps running; the report carries `detached: true` and no `exit` facts. Pinned attach facts (`.context/t4/facts.md`): a game already paused when it connects re-sends `debug_enter`; a `break` pause reports an empty reason with `isUserBreakpoint=true` and an empty engine stack; detaching never leaves the game paused (it resumes) and leftover breakpoints are ignored without a debugger; **Godot does not retry a failed connection** — the game must start AFTER the tool call (or the port must already be listening). Editor-debugger coexistence is pinned (`.context/t11/facts.md`): an idle Godot editor binds **no** debug port — a game started externally with `--remote-debug` pointing at the editor's default port (6007) prints `Remote Debugger: Unable to connect` once and runs on — and attach alongside an idle editor is completely unaffected (full stop loop + detach, the editor keeps running untouched). A game has exactly ONE debug target: when several `--remote-debug` arguments are passed the LAST one wins, and a game already dialing another target never connects to the attach port — the run times out with the start-order guidance above. Games the editor itself launches (F5) are debugged by the editor's own server and cannot be attached.

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
| `maxExpandedObjects` | `10` | Max objects expanded via `scene:inspect_object` on the first stop that has a frame; `0` disables expansion. |
| `maxExpandedProps` | `100` | Max property rows kept per expanded object. |
| `maxExpandDepth` | `2` | Max expansion depth: `1` = top-level objects only, `2` = nested objects inside property values (direct/array/dictionary) expand recursively. |
| `maxEdits` | `10` | Max `scene:set_object_property` edits applied on the first stop that has a frame; `0` disables edits. |
| `maxTreeNodes` | `200` | Max scene-tree nodes parsed/rendered per frame-bearing stop; `0` disables scene-tree snapshots. |

## Tool

| Tool | Arguments | Behavior |
|---|---|---|
| `godot_debug` | `path?`, `mode?` (`launch` \| `attach`), `port?`, `scene?`, `breakpoints?` (`[{file, line}]`), `pauseOnAttach?`, `edits?` (`[{target, property, value, type?}]`), `maxStops?` (default 10, cap 50), `args?`, `timeoutMs?` | One bounded debug run. `launch` (default): validate project (a breakpoint file outside the project root is `GODOT_PARSE_ERROR`), verify `--version` ≥ 4.2, pick a free port, spawn the game headless, wait for `set_pid` (threadId readiness), then loop: wait for a stop (breakpoint hit or script error), snapshot stack + vars, snapshot the scene tree, expand object variables on the first frame-bearing stop, apply the `edits` (each verified by re-inspect), continue — until `maxStops`, the game exits, or the budget ends. Returns `{ stops, output, errors, exit, expansion?, edits?, sceneTrees?, outputTruncated?, varsTruncated? }`. `attach`: explicit `port` required (0/omitted is `GODOT_PARSE_ERROR` with startup guidance; `scene`/`args` are rejected), no version gate, no spawn — sends the breakpoints dynamically, then the same stop loop; detaches with best-effort breakpoint removal + continue and returns `{ stops, output, errors, detached: true }` (no `exit`). |

## Errors

Failures carry the package-owned `GodotError` (a `HarnessError` subclass), surfaced as `{ name, code }` on `isError` results: `GODOT_UNAVAILABLE` (executable/version/launch/connect failures, with the version or stderr tail), `GODOT_PARSE_ERROR` (unreadable project, breakpoint outside the project, or a malformed/oversized protocol frame), and `GODOT_ABORTED` (cooperative timeout or caller cancellation). A run that completes without any stop is a successful partial result (`stops: []` with output and errors), not an error.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the independently registered godot-debug guidance below. Agent-scoped tool restrictions can hide the schemas without removing the prompt section.

##### Godot debug guidance (tool:godot-debug)

```markdown
Use godot_debug to run a Godot scene under the debugger: set breakpoints (res:// path or absolute file path plus line), the tool launches the project headless, snapshots the stack and locals/members/globals at each stop, and auto-continues up to maxStops. Returns per-stop stack frames and variable values plus the game output and errors. Object variables are expanded in place on the first stop (properties under "expanded objects"; nested objects inside properties are expanded recursively, bounded by config maxExpandDepth, with location-path names like arr[0] or dict["k"]). Variable edits (edits parameter) are applied on the first stop while paused and verified against the engine: give target (a top-level variable name, e.g. self or player), property (the name shown in the expansion, Members/ prefix optional), value as a string, and type int|float|string|bool (default string). Only object properties are editable — scalar variables are not. Each edit reports ok/failed. The scene tree (current node hierarchy, "scene tree" block under each stop) is snapshotted on every stop that has a stack frame; node ids are usable for future inspect linkage.
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

`godot_debug` returns a generic card: a `N stops at <file>:<line> (maxStops)` head, one `#i <file>:<line> @ <function> [reason]` line per stop (a worker-thread pause is marked `[reason @ thread N]` — thread id 1 is the main thread and is unmarked, pinned `.context/t10/facts.md`), the first stop **that has a frame**'s full locals/members/globals (a `break` pause reports an empty engine stack and renders as `[break]`), the expanded objects of that stop (`<name> = Object<<id>> [<engine class>]` + indented `property = value` rows; nested objects render with deeper indentation and location-path names like `arr[0]` or `dict["k"]`, bounded by `maxExpandedObjects`/`maxExpandedProps`/`maxExpandDepth`), the applied edits of that same stop (`<target>.<property> = <value> [<type>] ok|failed: <detail>`, bounded by `maxEdits`, each verified against the engine by re-inspect), the scene tree of every frame-bearing stop (indented `name [class] (id)` lines + scene file, bounded by `maxTreeNodes`), and the output/error summary with truncation notes; attach results append `attached; game left running (not owned by the tool)`.

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
- **Variable rendering keeps significant digits** — numbers render with up to 7 significant digits (integers verbatim, trailing zeros removed; float32 wire artifacts like `0.10000000149011612` normalize to `0.1`); very large/small magnitudes use exponential form. The source plugin's `toFixed(1)` UI rounding (`0.123456` → `0.1`) is superseded.
- **Multi-thread pauses are attributed and addressed correctly** — a worker-thread stop (`Thread` class) is marked `[reason @ thread N]` (thread id 1 = main thread, unmarked); all commands for a stop (stack, vars, scene tree, expansion, edits, continue) are sent with the PAUSED thread id — the protocol's threadId field selects the target thread and a wrong id is answered with silence (pinned, `.context/t10/facts.md`). The game pauses globally while any thread is stopped; per-thread breakpoint filtering is not exposed by the protocol.
- **Variable edits are first-stop, top-level or nested paths, scalar-valued** — `scene:set_object_property` runs on the first stop that has a frame. `property` accepts a nested path: a plain name edits that property on the resolved object (top-level or any object reached through container members), while a container member (`arr[0]`, `dict["k"]`, `arr[0][1]`) is written by REBUILDING the whole outermost container with the change applied and setting it on the owning property (the source plugin's `changes_parent` semantics; pinned `.context/t14/facts.md` — whole-array/dict rebuilds persist, length follows the write, math-type members round-trip, StringName keys survive). Containers holding object references or NodePath/Callable/Signal values cannot be rebuilt — the engine silently rejects such writes (fact 7) — so those edits fail up front with a readable detail instead of a silent no-op. Only scalar values (`int`/`float`/`string`/`bool`) are written (scalar variables themselves carry no object id and the engine has no mechanism for them). The engine sends **no acknowledgement** for a set (pinned, `.context/t6/facts.md`), so each edit is verified by re-inspecting and comparing the value; failed writes (wrong property, read-only property, type mismatch) are silent in the protocol and surface as per-edit `failed` results with `editsTruncated`. `int` values are parsed with engine-style truncation (`12.5` → `12`) for typed properties, while untyped container members apply no coercion (fact 4). The write also works on a running game, but the tool applies edits only while paused.
- **Object expansion is first-stop, recursive, deduplicated** — `scene:inspect_object` runs on the first stop that has a frame for top-level object values; when `maxExpandDepth > 1` (default 2), ObjectIds found inside property values (direct members, array elements `arr[i]`, dictionary values `dict["k"]`) expand recursively with location-path names, and the same id appearing at top level AND nested is expanded once (top level wins). Deeper-than-`maxExpandDepth` objects stay `Object<id>` placeholders. Expansion skips objects that do not answer and marks the report `expansionTruncated` (a non-paused game answers with silence — pinned). The expanded class name is the ENGINE class (`get_class()`, e.g. `Node` for a `class_name Player` script), not the script class; script nodes render their script path.
- **Scene trees are display-only and per-frame-stop** — `scene:request_scene_tree` runs on every stop that has a stack frame; the tree is rendered as indented `name [class] (id)` lines (a script node's class is its script path, e.g. `res://main.gd`, pinned `.context/t7/facts.md`), bounded by `maxTreeNodes` per stop. Node ids are NOT linked to expansion/editing (deferred); a `break` pause reports a root-only tree (engine behavior, not an error).
- **attach requires an explicit port and the right start order** — the port must be known to the caller, and the game must start AFTER the tool call: Godot does not retry a failed debugger connection (pinned, `.context/t4/facts.md`). A `pauseOnAttach` stop gives a "what is the game doing right now" probe.
- **attach hits depend on the game re-reaching the line** — dynamic breakpoints do not rewind executed code; combine them with `pauseOnAttach` or target code that runs again.
- **attach assumes the project matches the running game** — the debug protocol has no workspace handshake; a wrong `path` yields breakpoints that never match (the run reports `stops: []`).
- **one debugger per game — attach and the Godot editor debugger do not share a game** — a game dials exactly one debug server at startup (`--remote-debug`; the last argument wins when several are passed). An idle Godot editor binds no debug port, so attach alongside it is unaffected (pinned, `.context/t11/facts.md`); a game pointed at the editor's default port (6007) prints `Remote Debugger: Unable to connect` once and runs on. Only games the editor itself launches (F5) are debugged by it, and those cannot be attached. Attaching on a port another server holds fails fast with `GODOT_UNAVAILABLE` (`could not bind port …: EADDRINUSE`).
- **multi-thread stops are deferred** — launch/attach cover the scripted per-stop snapshot; the raw protocol facts (`.context/t3/facts.md`) keep those paths open.
- **A crashed harness may leave an orphaned godot process** — the tool terminates the process tree on teardown; an abrupt harness death can still orphan the spawned game. In attach mode an abrupt death just detaches: the game resumes automatically (a disconnect never leaves it paused, pinned).
