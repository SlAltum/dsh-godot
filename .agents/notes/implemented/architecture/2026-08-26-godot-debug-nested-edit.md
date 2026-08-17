# Agent Note: Godot debug nested/container property edits (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-26-godot-debug-nested-edit.zh.md)

## Problem

Phase 6 delivered `scene:set_object_property` edits for TOP-LEVEL object properties with scalar values only; array/dictionary members and nested-object properties were deferred (the source plugin's `changes_parent` path). Phase 8's expansion exposed the location paths (`arr[0]`, `dict["k"]`) — the natural mount point — but nothing could write through them.

## Decision

Extend `edits.property` to accept a nested path and implement the source plugin's changes_parent semantics with explicit bounds (`.context/t14/facts.md`):

- **Path grammar**: a leading property name (bare or `Members/`-prefixed), then any sequence of `[index]`, `["key"]` (with escapes) and `.property` segments: `arr[0]`, `dict["k"]`, `arr[0].x`, `arr[0][1]`. A single-segment path is the Phase 6 flow unchanged (no extra inspect — the t6 request shape is preserved, verified by the t6 fixture regression).
- **Resolution** (`resolveEditPath`): live inspect chain — each `.property` segment inspects the current object; `[index]`/`["key"]` descend into decoded containers; nested ObjectIds hop to their own id. A path ending in a plain property edits that property on the resolved object; a path ending in a container member rebuilds the WHOLE outermost container (deep clone, member replaced) and writes it back to the owning property — the engine has no per-element set (facts 1/2: whole-array/dict rebuilds persist, length follows the write).
- **Rebuild gate** (`rebuildReason`): containers holding ObjectId/RawObject/NodePath/Callable/Signal fail the edit UP FRONT with a readable detail — the engine SILENTLY rejects whole-container writes carrying object references (fact 7), so the gate is mandatory, not an optimization.
- **Encoder extension** (user-scoped: math types included): the variant encoder now writes the math types the decoder produces (Vector2/2i/3/3i/4/4i, Rect2/2i, Basis, AABB, Transform2D/3D, Plane, Quat, Projection, Color — float32, symmetric with the decoder), so containers holding math values rebuild correctly (fact 6: Vector2 members round-trip).
- **Value comparison**: StringName-typed properties echo as StringName — `valueEquals` compares them against the requested plain string (fact 3).

## Protocol facts (recorded from Godot 4.7, `.context/t14/facts.md`)

- Whole-array rebuild write: accepted + persists, including nested-array members; the array LENGTH follows the rebuilt value.
- Whole-dict rebuild: accepted + persists; StringName keys survive the round-trip.
- Untyped container members apply NO coercion (`12.5` stays) — unlike typed properties' truncation.
- Typed containers: `PackedInt32Array` accepts a plain all-int Array (converted); a typed `Array[int]` rejects the whole write on a wrong-typed element (silent, value unchanged).
- Containers holding ObjectIds: the engine silently rejects the whole write.
- Nested-object property edits via their own id work like top-level edits; StringName-typed properties echo as StringName.
- The game's `window:title` reports `(DEBUG)` while connected (side observation).

## Source-plugin alignment and deviations

The changes_parent mechanics (walk up to the outermost container, rebuild, set on the owner) match `debugger.ts` `edit_value` + `inspector_provider.ts` `get_changed_value`. Deviations: (a) our gate fails object-reference containers explicitly instead of silently mis-encoding them (the source encoder has no ObjectId branch either — de facto the same boundary, but explicit); (b) math-type encoding is symmetric with OUR decoder; (c) verification stays re-inspect-based (the engine sends no set acknowledgement, T6.0 fact 1).

## Testing

- Real-machine pipeline probe `.context/t14/run-t14-pipeline.mjs`: runs the SHIPPED runDebug through a recording TCP proxy (fake subprocess seam rewrites the spawn's `--remote-debug` to the proxy) — the run result IS the real-machine smoke (4/4 nested edits ok on Godot 4.7) and the recorded bytes become the keyless FakeGame fixture (`t14-edit.bin/json`, 33 frames, per-id inspect sequences incl. path-walk requests).
- Unit: `parseEditPath` (grammar/escapes/malformed), `findMapEntry` (string/StringName/numeric keys), `rebuildReason` gate, `rebuildContainer` (clone isolation, nested application, length growth), `valueEquals` StringName, encoder math-type round-trips.
- e2e: `applyEdits` and `runDebug` against the t14 fixture (member rebuilds + nested-object property edits, gate/descend/out-of-range/missing-key failure details).
- Full suite green (165 tests incl. the t6/launch/attach regressions; snapshots unchanged); lint/tsc clean.

## Consequences

- The model can now edit array elements, dictionary values, nested-array members and nested-object properties with the rendered expansion paths — completing the Phase 6 edit story up to the engine's own bounds (object references in containers, typed-container element types).
- The t6 top-level edit path is byte-for-byte unchanged (single-segment paths add no inspect), so all prior fixtures and tests still pass.
- Leftovers: container KEY edits (T16), scene-tree node linkage (T15), multi-stop edits (T13).
