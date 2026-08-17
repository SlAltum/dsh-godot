# Agent Note: Godot debug scene-tree node linkage (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-27-godot-debug-tree-link.zh.md)

## Problem

Phase 7 snapshots the scene tree per frame-bearing stop (`name [class] (id)` lines), and T7.0 pinned that node ids live in the SAME id space as `scene:inspect_object` — but the model could only LOOK at the tree. Nothing accepted a node id or path to expand or edit a scene node.

## Decision

Expose the linkage as tool parameters (no new protocol — inspect/set are reused):

- **`expandNodes?: string[]`** — explicit scene-tree node ids (strings: JSON cannot carry bigints losslessly; ids can exceed 2^63-1, pinned T13.0 fact 6), expanded on the first frame-bearing stop BEFORE the top-level variable selection.
- **`nodePaths?: string[]`** — scene-node paths (`Main/Player`, engine root excluded), resolved against the stop's scene tree (`resolveNodePaths` in scene-tree.ts: depth-first name-chain match below the engine root, first match wins, blank segments invalid). Requires `maxTreeNodes > 0`.
- **`edits[].target`** accepts `node:<id>` and `path:<scene path>` (path resolved in collectStops against the stop's tree into `node:<id>` form; an unresolvable path keeps its target and fails with the standard not-editable detail).
- All three sources (expandNodes, nodePaths, top-level variables) dedup against each other — a tree node id IS a stack var id when the same object is in scope.

**Design discovery (protocol reality): raw ids CANNOT be reused across calls.** Launch-mode ids are per-run random; an attached game dials exactly ONE debug server (T11.0) and never reconnects after detach (T4.0) — the two-session attach flow (tree in session 1, id reuse in session 2) was built in the probe and FAILED with "game did not connect" (the game does not re-dial). Scene PATHS are the only stable cross-call channel: scene structure is static across runs. Related pinned bounds: a `pauseOnAttach` `break` pause has an empty stack AND a root-only tree, so linkage runs on dynamic-breakpoint stops.

## Testing

- Unit: `resolveNodePaths` (nested paths, unresolvable/blank/null, first-match for duplicates), expandObjects extraIds (named, dedup, explicit-first, works with maxObjects=0), findEditTarget `node:` form.
- e2e: nodePaths wiring (t7 fixture — tree answers, inspect times out → truncated but wired), path: edit with no tree fails cleanly, node: edit on the t6 fixture.
- Real machine: `.context/t13/run-t13.mjs` tool-link — ONE attach session with a dynamic breakpoint: tree → `nodePaths:["Main"]` expands an entry NAMED `Main` (className Node) → `path:Main` edit ok. tool-run's 8 display assertions unchanged.

## Consequences

- The model can expand and edit any scene node by its stable path (`nodePaths`, `path:` targets) in both launch and attach; raw ids work within a run.
- Leftover: ObjectId dict-key repr names were deferred "with T15" — key display still uses `<id>` (recorded in T16's note).
