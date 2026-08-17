# Agent Note: Godot debug nested object expansion (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-23-godot-debug-nested-expand.zh.md)

## Problem

Phase 5 expansion rendered only top-level object values: `expanded objects` showed `self`/`player` rows, but an `Object<id>` property value stayed a placeholder — the model could see `player = Object<27061650910> [Node]` without its properties. The source plugin recurses freely with `get_sub_values` (helpers.ts L36-72: arrays → index children, maps → key children, GDObject → member children, then recursion). That unbounded UI-driven recursion does not fit a one-shot tool call.

## Decision

Upgrade the expansion to a **bounded recursive expansion** (no new package; protocol facts pinned in `.context/t8/facts.md`):

- Top-level selection is unchanged; when `maxExpandDepth > 1` (default 2, config `maxExpandDepth`, 1 = exact Phase 5 behavior), ObjectIds found inside property values recurse with the same serial/id-matched protocol: direct properties, array elements (`arr[i]`), dictionary values (`dict["k"]`). Dictionary KEYS are not expanded (source-plugin rule, T8.0 fact 1); `RawObject` (inline-decoded objects, a Map subclass) is not traversed either.
- **Top-level wins for dedup**: every selected top-level id is pre-reserved, so a top-level object that also appears inside a property (e.g. `self.player` == top-level `player`, T8.0 fact 2) expands once, at top level; nested children carry location-path names.
- `ExpandedEntry` gains optional recursive `children` (existing fields unchanged — backward compatible). The render recurses with deeper indentation; the `expanded objects (N):` head counts ALL expansions (top level + children).
- Bounds: expansion budget `min(remaining run budget − settle margin, maxExpandedObjects × maxExpandDepth × idleTimeoutMs)`; per-object waits `min(idleTimeoutMs, remaining)`. Failure taxonomy unchanged (per-object skip + flag / disconnect run-level / cancel).
- The output schema declares `children` as `items: json` (the schema cannot recurse); the execute() return casts the expansion carrier to the schema shape (the runtime values are plain JSON — entry ids are already strings).

## Protocol facts (recorded from Godot 4.7, `.context/t8/facts.md`)

- Container shapes confirmed: `Members/arr` (typeCode 28) decodes to `[ObjectId]`, `Members/dict` (typeCode 27) to `{k: ObjectId}` — collectNestedIds walks Array elements and Map values.
- Same-id overlap is NORMAL: a top-level var and a property of self can reference the same object (dedup is correctness, not an optimization).
- Three-level chains are invisible at the protocol level: Node properties do not expose child-node ObjectIds (no natural depth-3 payload) — the depth cap is a product policy, exercised by unit tests with synthetic data.
- Nested responses match the requested id exactly (same as T5.0 fact 1); round-trips 13-21 ms like top level.

## Source-plugin alignment and deviations

The traversal rules match `get_sub_values` (arrays/maps/GDObject members; keys rendered not recursed). Deviations: unbounded recursion becomes `maxExpandDepth`-bounded (default 2); the source plugin's interactive expansion is one-shot serial; children are rendered inline with indentation instead of a UI tree; `RawObject` is skipped (its members are the object's own properties, already rendered as rows).

## Testing

- `inspect.spec.ts`: collectNestedIds (direct/array/dict paths, RID/null/primitive skip, dictionary keys not recursed, RawObject skip), recursive expansion against the real-Godot `t8-nested` fixture (5 expansions: self + member_a + player top-level, arr[0]/dict["k"] children; top-level dedup), depth 1 == Phase 5.
- runDebug nested tests (recursion with location paths, depth 1 no recursion) + REAL-composition test with snapshot (indented children, `arr[0]`/`dict["k"]` lines) + regression: full pre-Phase-8 suite green (136 tests incl. real smoke).
- Keyless fixture `t8-nested.bin`/`t8-nested.json` (20 frames, 9724 bytes; 5 inspect round-trips).
- **Two product bugs found during the phase**: ① `expandedObjects` counted only top-level `entries.length` (children expansions were lost) — the expansion carrier now carries the real count and the schema/render use it; ② RawObject (Map subclass) was being traversed as a container, requesting ids with no fixture responses — now skipped.

## Consequences

- `maxExpandDepth` default 2 changes the default report: nested object properties render with children rows (bounded by the depth × objects × props caps); `maxExpandDepth: 1` restores the exact Phase 5 output.
- The dedup rule (top level wins) means an object that is both a top-level var and a property appears once, at top level.
- Nested children are the natural place for future per-child editing (T14) and scene-tree-node linkage (T15) to attach.
