# Agent Note: Godot interactive debug session (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-27-godot-debug-interactive-session.zh.md)

## Problem

`godot_debug` is a one-shot scripted run: the model passes breakpoints, the tool runs to completion and returns a report. Nobody can drive a debugger from the Web panel — pause/continue/step, manage breakpoints, or edit variables while the session stays alive (roadmap R16; the largest interaction gap vs godot-vscode-plugin's DAP toolbar).

## Decision

A long-lived attach session in the STATIC package, bridged to the UI by the dynamic plugin:

- **Architecture boundary (review H1)**: `harness.handle` is a dynamic-plugin-only primitive; the static package has no client↔host RPC channel, and the dynamic host sandbox cannot import the static codec or open TCP. → `src/session.ts` (`DebugSession` state machine) + `src/session-service.ts` (`ctx.provide('godot.debugSession')`) hold the session; the dynamic host half injects the service and bridges 4 methods (`session/start|stop|poll|command`) via `harness.handle`; a missing service falls back to an in-sandbox fake session (demo path).
- **Polling is the only channel (review H2)**: client `ctx.remote.$on` keys are a fixed whitelist (no godot key) and the dynamic host has no `ctx.emit` — no push. `poll` returns a full snapshot + monotonic `version` (no since-cursor: multiple consumers cannot eat each other's events); the client polls with `ctx.interval` at the apply layer (client closures throw on timers).
- **Session semantics**: single session per host process (a game dials exactly ONE debugger, T11.0); `start` binds and returns `{sessionId, connecting}` immediately (connection window is session-level, H6); commands run through one serial queue (send-only complete immediately, wait commands own the queue); every pause is snapshotted ONCE into the T20 `structuredDebugView` (versioned, H4); idle = commands only (polls never count), timeout detach runs the T4 teardown (best-effort breakpoint removal + continue).
- **Model + UI coexistence (C4)**: `godot_debug_session` tool (action=start/command/stop) and the panel drive the same session; edits reuse `applyEdits` (display-name labels like `Node/process_priority` pre-resolve to the raw label — the engine silently rejects `Node/`-prefixed write labels, pinned T13.0).

## Facts (real machine, Godot 4.7, `.context/t21/facts.md`, 24/24 asserts)

- A `break` pause reports an EMPTY engine stack (T4.0 re-pinned) — no frame/vars/tree; the full snapshot only appears on a dynamic-breakpoint hit (`main.gd:25 @ _process`, vars + tree).
- `step`/`next` complete INTO a pause (step-into lands on `@implicit_new`, next advances a line) — they are not "run".
- Edits with the display-name label `Node/process_priority` apply successfully through the session (pre-inspect label resolution path verified live).
- `stop` → `detached` (reason `stop`); the game keeps running.

## Deployment boundary

This deployment does NOT mount tool-godot-debug (host Service catalog has no `godot.debugSession`; profile bundles are only `dsh-base`+`dsh-web-app`). The real service was validated by a tsc-precompiled probe driving `createDebugSessionService` directly against a live game (`.context/t21/run-t21.mjs`); the UI real-routing (pkg-18 `real: true`) waits for a deployment with the package mounted — same boundary recorded for T20. The leftover in-session `godot_debug_session` demo tool (fake session) is unrelated session-level state.

## Testing

- Unit 17/17 (scripted-game fixture): all-stop/continue/step/next, breakpoint add/remove, edits failure paths (success kept for the real machine), disconnect, timeout, stop teardown, EADDRINUSE, single-session, port validation, unknown/busy, output-error tails, scene-tree flat format; full package 212 green; tsc 0.
- Real machine: probe sequence start→running→pause→step→next→breakpoint→continue(hit)→edits(ok)→stop→detached, game left running.

## Consequences

- The model AND the Web panel can drive one live attach session (pause/continue/step/next, breakpoints, paused-state edits); the snapshot view is identical to the one-shot card.
- Leftover: T21.8 launch-mode sessions (spawn + version gate + terminate) are deferred; `step_out` is not offered (no standalone protocol command; the source plugin emulates it with next+flag).
