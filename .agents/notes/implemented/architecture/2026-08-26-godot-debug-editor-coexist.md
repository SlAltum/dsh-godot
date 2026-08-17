# Agent Note: Godot debug attach vs editor debugger coexistence (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-26-godot-debug-editor-coexist.zh.md)

## Problem

Phase 4 left a Known Limitation: "a second client when the Godot editor is already connected" was untested (it needs a running editor, deemed expensive). The coexistence question — can `godot_debug` attach share a game with the editor debugger? — had no recorded answer. The source plugin documents only the editor's default debug port (`"port": 6007` in its launch example); it has no explicit coexistence handling, so the behavior is engine-side and had to be measured.

## Decision

Pin the real behavior with a probe that runs a real Godot 4.7 editor (headless) alongside real attach flows (`.context/t11/facts.md`), then update the docs. No product code changed (user-scoped decision: pure verification + documentation; the EADDRINUSE-message suggestion was recorded as a leftover instead):

- **An idle editor binds NO debug port.** A fully-initialized headless editor holds zero listening sockets (netstat), and a game launched externally with `--remote-debug tcp://127.0.0.1:6007` prints `Remote Debugger: Unable to connect. Status: 1.` once and runs on (no retry, pinned T4.0 fact 11). The editor only acts as a debug server for games IT spawns (F5), which carry its own debug arguments.
- **One debugger per game.** A game's remote-debug client dials exactly one target: with two `--remote-debug` arguments the LAST one wins (measured: the DSH side received `set_pid`), and a game already dialing another target never connects to the attach port — attach times out with the existing start-order guidance. Attaching while an idle editor runs is completely unaffected in both directions (full stop loop + detach works; the editor process keeps running untouched).
- **Docs updated** (`one debugger per game` Known Limitation + attach usage note): a game pointed at the editor's default port fails its dial (nothing serves it), only editor-spawned (F5) games are editor-debugged, and those cannot be attached.

## Protocol facts (recorded from Godot 4.7, `.context/t11/facts.md`)

- Idle headless editor: 0 listening TCP sockets after full init (`[ DONE ] loading_editor_layout`); port 6007 bindable by anyone.
- Game → 6007 with idle editor running: stderr `ERROR: Remote Debugger: Unable to connect. Status: 1.` at `_try_connect (core/debugger/remote_debugger_peer.cpp:190)`, printed once; game keeps running and ticking.
- Two `--remote-debug` args (`tcp://…6007` then `tcp://…<dsh>`): the game connects to the LAST argument's target (`set_pid` arrives on the DSH side; no connection to 6007).
- Attach timeout surface (shipped tool): `GODOT_UNAVAILABLE`, message `godot_debug: game did not connect to tcp://127.0.0.1:<port> within <ms>ms. Start the game with --remote-debug tcp://127.0.0.1:<port> AFTER this call — Godot does not retry a failed connection (pinned, T4.0).`
- Port-conflict surface (shipped tool): `GODOT_UNAVAILABLE`, message `godot_debug: could not bind port <port>: listen EADDRINUSE: address already in use 127.0.0.1:<port>` — no hint about who holds the port (recorded suggestion, not implemented).
- While connected to a debugger the game's window title reports `(DEBUG)` (side observation, no behavioral impact).

## Source-plugin alignment and deviations

The source plugin has no coexistence handling to port (its attach/launch flows were already aligned in Phase 4). One deviation was re-confirmed: the source plugin's launch example suggests `"port": 6007` (the editor's default), which this tool intentionally does not default to in attach mode (explicit port required — Phase 4 decision D2), so an accidental collision with an idle editor cannot happen (it holds nothing anyway).

## Testing

- Probe `.context/t11/run-t11.mjs` (node; the tool chain is precompiled with tsc into `tool-godot-debug/.build-t11` because tsx/esbuild cannot spawn their service under the harness sandbox — EPERM; tsconfig at `.context/t11/tsconfig.json`), scenarios: S0 editor-idle (init, socket scan, game-dial 6007), S1 raw attach with editor running (break + dynamic breakpoint stops, snapshots, detach, game keeps running, editor alive), S1b shipped-tool attach with editor running (`detached: true`, 3 stops), S2 game dialing 6007 + tool attach timeout (message asserted), S2b DSH-first + game → editor port (no connection), S3 EADDRINUSE surface (tool attach on a held port), S4 double `--remote-debug` (last wins).
- Evidence: `out/<scenario>/summary.json`, `events.json`, netstat snapshots, stdout/stderr; facts table `.context/t11/facts.md`.
- README pair (EN/ZH) re-verified with `.context/verify-pairing.mjs` (structure + md-wrap; hashes re-recorded in `README.i18n.yaml`).

## Consequences

- The Phase 4 Known Limitation is closed with recorded facts: an idle editor can never be the "second client" (it binds nothing); editor-debugged games are F5-spawned only and cannot be attached (one debug target per game, last `--remote-debug` wins).
- attach guidance is unchanged (start the game AFTER the tool call) — the timeout message the model sees in coexistence scenarios is now pinned verbatim.
- Leftover: the EADDRINUSE message could hint at a probable holder (editor debug session, another attach); deferred by user decision.
