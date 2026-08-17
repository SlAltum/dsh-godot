# Agent Note: Godot debug multi-thread threadId semantics (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-25-godot-debug-threads.zh.md)

## Problem

All protocol messages and commands carry a threadId field, but the implementation captured only `set_pid`'s value and echoed it for every command — which is exactly right for single-threaded games and exactly wrong for multi-threaded ones. The source plugin never implemented real threads (`threadsRequest` returns a fake single thread, debug_session.ts L190-193), so there was no reference to follow.

## Decision

Pin the real protocol behavior with a multi-thread probe project, then fix (no new package; protocol facts pinned in `.context/t10/facts.md`):

- **Threads are distinguishable**: `debug_enter`'s message-level threadId equals its `params[3]` and both identify the PAUSED thread (main = 1, worker = 46 in the probe). Error pauses distinguish threads too.
- **The threadId field selects the command's target thread**: with the paused thread id, `get_stack_dump`/`continue` work (worker stack at `_worker_loop`, `debug_exit` follows); with the `set_pid` id they are answered with SILENCE — the pre-fix implementation could not fetch a worker stop's stack nor continue past it.
- **Fix**: `DebugController.waitForStop` now captures the paused thread id (`msg[1]`) into a `pausedThreadId` state; `send` uses the paused id while a stop is active, falling back to `set_pid`'s id before the first stop. `StopInfo` gains `threadId`; `DebugStop` carries it through; the report marks worker stops `[reason @ thread N]` (thread 1 = main, unmarked) and the card meta/schema carry `threadId` per stop.
- The game pauses globally while any thread is stopped (observed), but command responses belong to the threadId used — using the paused id is always correct.

## Protocol facts (recorded from Godot 4.7, `.context/t10/facts.md`)

- `debug_enter` msg[1] === params[3] === paused thread id (main 1 / worker 46); `set_pid`'s threadId is the main thread id.
- Commands with the wrong thread id → silence (not an error message) — before the fix, a worker stop showed up as a snapshot timeout / `varsTruncated`, not a clear failure.
- `stack_dump` responses carry the threadId used in the request (attribution is deterministic).
- Worker-thread error pauses (`Division by zero`) carry the worker id; `params[3]` is stable (unlike `params[2]`, which T5.0 recorded as unstable and which remains meaningless).
- Single-thread scenarios are unchanged (threadId 1 everywhere — zero regression).

## Source-plugin alignment and deviations

The source plugin's fake single-thread `threadsRequest` is not ported (we do not expose DAP threads); the protocol's real per-pause threadId is used instead. Everything else (stop loop, snapshot, expansion, edits, scene tree) is unchanged.

## Testing

- controller.spec: `waitForStop` returns `threadId: 1` on the t3 single-thread fixture (assertions updated).
- tool.spec: worker-thread fixture (`t10-worker.bin`, real recording: debug_enter 46 → stack at `res://main.gd:18 @ _worker_loop` → vars) — the fixed path fetches the worker stack; main-thread fixture asserts `threadId === 1` everywhere.
- REAL-composition: worker stop renders `[Breakpoint @ thread 46]`; card meta carries `threadId: 46`.
- Real-Godot smoke: the t10 project's worker breakpoint is hit, `threadId !== 1`, frame at the worker loop line.
- Full suite green (147 tests incl. smoke); single-thread snapshots unchanged.

## Consequences

- Multi-threaded games now debug correctly: worker stops get their stack, vars, scene tree and continue work — previously they silently produced empty snapshots.
- The report tells the model which thread paused (marker only for non-main threads, keeping single-thread output identical).
- Per-thread breakpoint filtering is not exposed by the protocol (documented Known Limitation); `--single-threaded-scene` remains a deployment option from the source plugin's argv (not ported).
