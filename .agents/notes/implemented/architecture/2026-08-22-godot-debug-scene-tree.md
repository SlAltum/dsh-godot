# Agent Note: Godot debug scene-tree snapshots (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-22-godot-debug-scene-tree.zh.md)

## Problem

The model could read stack/variables (Phases 1-5) and edit object properties (Phase 6), but had no view of the current scene's node hierarchy — "what nodes exist in the scene right now, with their classes and scene files" is a key debugging dimension. The source plugin requests the tree on every `debug_enter` and `stack_dump` (`server_controller.ts` L416/L518), parses the response with `parse_next_scene_node` (helpers.ts L6-20), and renders it into VSCode's Scene Tree panel; clicking a node links to the inspector (`debugger.ts` L282-307).

## Decision

Add a **bounded direct consumption** step to `godot_debug` (no new package; protocol facts pinned in `.context/t7/facts.md`):

- On EVERY stop that has a stack frame (aligning with the source plugin's debug_enter/stack_dump double-trigger), while paused, request `scene:request_scene_tree` (no parameters), parse the flat recursive response, and render indented lines into the report under `scene tree` per stop.
- Parsing follows the pinned layout: each node is `[childCount, name, className, id, sceneFilePath, viewFlags, ...children depth-first]`; ids are non-negative INT64 bigints in the SAME id space as `scene:inspect_object` (tree node ids are inspectable — verified in the probe, T7.0 fact 8). `className` is the engine class for engine nodes and the script path (`res://main.gd`) for script nodes; `viewFlags` (0/14) are dropped.
- Bounds: `maxTreeNodes` (default 200, `0` disables; allowZero validation), a per-stop tree budget of `min(remaining run budget − settle margin, maxTreeNodes × 50 ms)`, per-stop waits of `min(idleTimeoutMs, budget)`.
- Failure taxonomy (aligned with expansion/edits): per-stop timeout/malformed = skip the tree + `sceneTreeTruncated`; disconnect = run-level end (partial results); external cancel = `GODOT_ABORTED`.
- Result fields: `sceneTrees` (stopIndex + parsed root + rendered lines), `sceneTreeCount`, `sceneTreeTruncated` — the execute() return drops the bigint-carrying root (only `lines` cross the JSON boundary), synced in the output schema and card meta.
- The tree runs BEFORE expansion/edits on the same stop (fast, no id-match complexity; expansion and edits consume inspect responses, trees consume scene_tree responses — the predicates never collide).

## Protocol facts (recorded from Godot 4.7, `.context/t7/facts.md`)

- Response: `scene:scene_tree` params are a flat array consumed as `[childCount, name, className, id, sceneFilePath, viewFlags, ...children]` — childCount FIRST, then 5 scalar fields, then the children recursively (source `parse_next_scene_node` fully confirmed).
- **A running game also answers** (9 ms, full tree) — unlike inspect's silence when unpaused (T5.0 fact 4); the tool still requests only while paused (the model looks at the tree at stops).
- Every request answers (~13 ms); a static scene returns a byte-identical tree across stops (T7.0 fact 5) — the per-stop snapshot is the semantics, not a change signal.
- **A `break` pause reports a root-only tree** (`childCount 0`) — engine behavior, not an error; break stops have no stack frame anyway, so the product skips them (the fact matters for future stop types).
- Tree node ids ARE inspectable (root Window → `scene:inspect_object` returned 134 props) — linkage is feasible but deferred (v1 is display-only).
- Non-ASCII node names (`Leaf中文`) decode intact (probe codec, no misalignment).

## Source-plugin alignment and deviations

The request/parse shape matches `server_controller.ts` L127-128 + L433-437 and `helpers.ts` L6-20 exactly. Deviations: the VSCode TreeDataProvider UI is replaced by bounded indented lines; the plugin's click-to-inspect linkage is not ported (display-only, v1); the `window:title`-style noise around the response is ignored like other endpoints. The probe's tree-stats walker had a counting bug (harmless — the raw params were recorded field-by-field; the product parser consumes the flat array correctly).

## Testing

- `scene-tree.spec.ts` 8 tests: parseSceneTree (flat recursive layout, script-path className, non-ASCII names, root-only tree, non-array/zero-budget defense, node budget cap), renderSceneTree (indent/class/id/file lines, root-only single line, maxNodes cap, null root).
- runDebug scene-tree tests (per-stop snapshots with identical-tree assertion, maxTreeNodes=0 disabled, attach mode) + REAL-composition test with snapshot (`scene tree (8 nodes):` block, `Leaf中文` line) + real-Godot smoke asserting the root `Window` line and an indented child.
- Keyless fixture `t7-tree.bin`/`t7-tree.json` (18 frames, 15548 bytes); **FakeGame now dispatches `scene:scene_tree` responses by REQUEST SEQUENCE** (`scene_tree` first, `scene_tree:2` second, ...) because the pipeline must not replay the same frame for every request.
- Launch/attach regression: the full pre-Phase-7 suite still passes (129 tests green incl. smoke).

## Consequences

- `maxTreeNodes` bounds per-stop render lines; a static scene yields identical trees per stop (semantics: the tree at that stop point, not a diff).
- The scene-tree root carries bigint ids — the execute() normalization strips it (`sceneTrees` = `{stopIndex, lines}[]`), so the output schema never sees bigints.
- Tree node ids are in the inspect id space — a future "inspect/expand a tree node" feature can reuse `scene:inspect_object` directly (candidate source for the Phase-8 nested-expansion work).
