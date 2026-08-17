# Agent Note: Godot debug attach mode + dynamic breakpoints (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-18-godot-debug-attach.zh.md)

## Problem

The v1 `godot_debug` tool (see [2026-08-17-godot-debug-tool.md](2026-08-17-godot-debug-tool.md)) was launch-only: the harness spawned the game and owned the process, CLI `--breakpoints` were the only breakpoint source, and the tool killed the game on teardown. Debugging a game the user already started — or setting breakpoints after connect — was impossible, which kept the source plugin's attach capability out of reach.

## Decision

Add an attach mode and dynamic breakpoints to the existing tool (no new package, no protocol-layer changes — `DebugController` already is the TCP server side):

- `mode: 'attach'` (tool arg; default `'launch'`): the tool binds an **explicit** port (arg `port` or config `debugPort`; 0/omitted → `GODOT_PARSE_ERROR` with startup guidance — an auto-picked port is useless inside an atomic call) and waits for the caller-started game to connect. No spawn, no `--version` gate (no binary owned; the game needs 4.2+ for the threadId protocol field, documented), no kill.
- Dynamic breakpoints: `breakpoint [res://path, line, true]` sent after `set_pid`; the **only** attach breakpoint source (CLI `--breakpoints` is launch-only). Optional `pauseOnAttach` sends `break` once for an immediate "what is the game doing right now" probe stop.
- Detach teardown (try/finally on every path, incl. cancel): best-effort `breakpoint [path, line, false]` per sent breakpoint → best-effort `continue` → `controller.dispose()`. The result carries `detached: true` and no `exit` (the game is not owned).
- The fork point sits after project validation / breakpoint `res://` conversion and **before** `resolveExecutable` — attach never touches the godot binary or the subprocess seam (`subprocess.spawns` stays empty in tests).
- Attach rejects `scene`/`args` (`GODOT_PARSE_ERROR`) and `pauseOnAttach` outside attach mode. `EADDRINUSE`/listen errors map to `GODOT_UNAVAILABLE` inside the attach branch only (launch's error surface is unchanged).

## Protocol facts (recorded from Godot 4.7, `.context/t4/facts.md`)

- A game already paused when it connects (script-error stop, un-imported Parser Error) **re-sends `debug_enter`** after `set_pid` — no extra "probe the paused state" command is needed; the controller's history consumption handles it.
- `break` pauses with `debug_enter [true, "", true, 1]`: `isUserBreakpoint=true`, reason is the **empty string** (renders as `[break]`), and the stack dump is **empty** (engine stack, `N=0`) — the render layer already defends (empty frame list); full scopes then render on the first stop that has a frame.
- Detach while paused: the game **resumes automatically** (a disconnect never leaves it paused). Leftover dynamic breakpoints without a debugger are **ignored** (the game keeps running). Both make the teardown continue/removal defensive, not required.
- **Godot does not retry a failed debugger connection**: a game started before the port listens never connects. The attach guidance therefore says: start the game AFTER the tool call, with `--remote-debug tcp://127.0.0.1:<port>`.
- A detached game does not reconnect to a second attach on the same port (one connection per game run).

## Source-plugin alignment

The design was verified against the source plugin's mature implementation (`godot-vscode-plugin/src/debugger/godot4/server_controller.ts`): attach = `server.listen(port)` with no spawn/version/kill (L360-393); attach socket close does not abort the controller (L368-378); `terminateRequest` stops only launch mode (debug_session.ts L181-188); `breakpoint [path, line, true|false]` and `break` command shapes match (L93-121); empty stack dumps are ordinary stops (L724-728). Deviations are DSH-specific: one-shot call semantics (dispose vs retained session) and defensive detach cleanup.

## Testing

- 11 new unit/integration tests (tool.spec.ts attach suite: full fixture replay with `detached`, no-spawn assertion, missing-port/scene/args/pauseOnAttach validation, connect timeout guidance, port-occupied, abort+dispose; toResPath hardening: cross-drive paths and backslash escapes) + a REAL-composition attach test with its snapshot + a real-Godot smoke (GODOT_EXE-gated) that attaches, hits a dynamic breakpoint and verifies the game survives detach.
- Keyless replay fixture `t4-attach.bin`/`t4-attach.json` (19 frames, 2316 bytes) generated from the real-Godot recording by `.context/t4/gen-fixture.mjs`; the `break`-triggered `debug_enter` is tagged `trigger: "break"` so FakeGame replays it on the `break` command.
- Launch path regression: the whole pre-Phase-4 suite still passes unchanged (66 tests), plus the T3.0 real-Godot smoke.

## Alternatives considered

- **Stateful session tools / interactive breakpoints** — conflicts with the tool suite's one-shot principle; dynamic breakpoints + `pauseOnAttach` cover the model-visible need in one call.
- **Auto-picked attach port with the port reported in the error** — an atomic call cannot hand the port to the user in time; explicit port + documented start order is the usable contract.
- **TCP liveness probing to detect the tool's listener** (test-time idea) — the controller treats an accepted-and-dropped probe as a game disconnect and aborts the run; the smoke test instead waits a fixed beat after the call (bind is synchronous-fast).
- **Removing the best-effort continue/breakpoint-removal on detach** — pinned facts say detaching is harmless without them, but they stay as cheap insurance against engine-version differences.

## Consequences

- `DebugRunResult` gained `detached: boolean` (launch always `false`); `execute()` normalizes it in BOTH branches (attach always takes the null-exit branch).
- Render: empty reason labels `[break]`; full scopes render on the first stop with a frame; attach results append `attached; game left running (not owned by the tool)`.
- `toResPath` hardened for cross-drive absolute paths (Windows `path.relative` returns an absolute path for other drives — previously a silently never-matching breakpoint) and backslash `res://` escapes (pre-existing defects, fixed for both modes).
- Attach deployments need no godot binary at all (like lsp-godot's attach-only path).
- README known limitations updated: attach start order (Godot no-retry), attach hit semantics (no rewind), project-match assumption (no workspace handshake in the debug protocol), harness crash in attach = harmless detach.
