# Agent Note: Godot debug variable expansion (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-19-godot-debug-inspect.zh.md)

## Problem

Every stop snapshot rendered object variables as an `Object<id>` placeholder (snapshot.ts's GDObject branch) — the model could not see an object's internal state, which was the largest information gap in the debug report. The source plugin fetches object properties lazily via `scene:inspect_object` with a VariablesManager/GodotObjectPromise machinery, but that is UI-driven (mapper/promise plumbing) and does not fit a one-shot tool call.

## Decision

Add a **bounded direct expansion** to `godot_debug` (no new package; protocol facts pinned in `.context/t5/facts.md`):

- After the FIRST stop that has a frame (same stop as the full-scope render), while still paused, serially send `scene:inspect_object [id]` for the stop's top-level `ObjectId` values (RID excluded — its inspect returns an empty response, pinned) and render the returned property tuples into the report under `expanded objects`.
- Matching is by ID: the response id (INT64, non-negative in practice; negative values are +2^64-normalized defensively) must equal the requested UINT64 bigint. Serial requests alone cannot prevent a late response from a timed-out wait from being consumed by the next request (controller history consumes matching messages first) — the id predicate is the guard.
- Bounds: `maxExpandedObjects` (default 10, `0` disables; allowZero validation), `maxExpandedProps` (default 100), an expansion budget of `min(remaining run budget − settle margin, worst-case cap)`, per-object waits of `min(idleTimeoutMs, remaining budget)`.
- Failure taxonomy: per-object timeout/malformed = skip + `expansionTruncated`; disconnect = run-level end (the stop loop returns the partial result); external cancel = `GODOT_ABORTED`. Malformed frames surface as `GODOT_UNAVAILABLE` through the controller's failProtocol path, not as a parse error.
- New controller surface: public `waitForMessage(pred, timeoutMs, signal)` (the private `waitFor` was not reachable from the tool layer); `route` is unchanged.
- Result fields: `expansion` (stopIndex + entries with name/id/className/rows), `expandedObjects`, `expansionTruncated` — normalized in the execute() return (null → omitted) and synced in the output schema and card meta.

## Protocol facts (recorded from Godot 4.7, `.context/t5/facts.md`)

- Response: `scene:inspect_object [id, className, props]`; `id` arrives as a non-negative INT64 equal to the requested UINT64 (12-21 ms round-trips). Property tuples are `[name, typeCode, hint, hintString, usage, value]` — the second element is a Variant TYPE CODE (a number), not a class name; `usage === 128` marks category grouping elements (skipped; following properties carry their group prefix already). `Members/`/`Constants/` prefixes are stripped; other prefixes (`Node/`) are kept.
- The response `className` is the ENGINE class (`get_class()`, e.g. `Node` even for a `class_name Player` script), not the script class.
- A non-paused (running) game answers with silence — expansion must run while paused. RID inspect returns an empty response (excluded from selection); freed objects already decode as `null` in the var list (no id to inspect).
- Break-pause stops have an empty stack and no object vars — the expansion naturally skips them.

## Source-plugin alignment and deviations

The response parsing follows server_controller.ts L438-504 (six-tuple, usage=128 categories, prefix stripping). Deviations: the interactive GodotObjectPromise/get_sub_values machinery is replaced by serial bounded waits; category prefixes are kept as-is instead of the plugin's `${category}/${name}` re-join (the 4.7 protocol already embeds the group in the name); the `+2^64` id conversion is defensive only.

## Testing

- 13 unit/integration tests in `inspect.spec.ts` (selection/dedup/RID exclusion, tuple parsing incl. malformed-tuple defense, id normalization, expandObjects success against the real-Godot `t5-inspect` fixture, unmatched-id timeout skip, budget exhaustion, disconnect and cancel propagation, stale-response id mismatch) + 3 runDebug expansion tests (launch, attach, disabled) + a REAL-composition test with snapshot + the real-Godot smoke asserts `self` expansion.
- Keyless fixture `t5-inspect.bin`/`t5-inspect.json` (19 frames, 5412 bytes); FakeGame now dispatches `scene:inspect_object` responses by the REQUESTED id (manifest trigger `inspect:<id>`) so serial multi-object expansions replay correctly.
- **Encoder bug found and fixed**: `sizeVariant` sized bigints as 8 bytes while the INT64 write needs 12 — every bigint command (i.e. every inspect request) overflowed the buffer with a RangeError. Regression test added.
- Launch/attach regression: the whole pre-Phase-5 suite still passes (95 tests green).

## Consequences

- `VariantEncoder.sizeVariant` bigint fix is a correctness fix for the existing codec, not just Phase 5.
- Expansion adds model-visible rows bounded by `maxExpandedObjects × maxExpandedProps`; skipped/unanswered objects keep `Object<id>` with `expansionTruncated`.
- The class name shown is the engine class — document that script class names are not in the response.
