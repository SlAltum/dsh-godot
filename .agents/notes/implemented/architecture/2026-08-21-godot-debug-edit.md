# Agent Note: Godot debug variable editing (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-21-godot-debug-edit.zh.md)

## Problem

After Phase 5 the model could read object properties (expansion) but not write them — a debug loop of "change a value → continue → observe the effect" was impossible. The source plugin edits values through the inspector UI (`edit_value` in `debugger.ts` L332-397): it reads the current value's JS type, parses the input box string, sends `scene:set_object_property [id, label, value]`, and refreshes the inspector to verify. That UI interaction does not fit a one-shot tool call.

## Decision

Add a **bounded direct editing** step to `godot_debug` (no new package; protocol facts pinned in `.context/t6/facts.md`):

- On the FIRST stop that has a frame (same stop as expansion/full-scope render), while still paused, apply the model's `edits` requests: `[{ target, property, value, type }]` — `target` is a top-level object variable name (`self`, `player`), resolved from the stop's raw vars to its `ObjectId` (RID excluded, scalar variables rejected — the engine has no mechanism for them, pinned). `value` is a raw string parsed per `type` (`int`/`float`/`string`/`bool`, default `string`); `int` parses with engine-style truncation (`12.5` → `12`, matching the engine's coercion of float values into int properties).
- **Verification is a re-inspect**: the engine sends NO acknowledgement for `set_object_property` (pinned fact 1) and failures are silent (fact 5: nonexistent/read-only properties and invalid ids are no-ops with no error message). Each edit therefore re-requests `scene:inspect_object` for the object (id-matched like Phase 5), finds the property (bare or `Members/`-prefixed name — both forms work, fact 2), and compares the decoded value with the parsed request value. Unchanged → `failed: value unchanged`; missing property → `failed: property not found`.
- Bounds: `maxEdits` (default 10, `0` disables; allowZero validation), an edit budget of `min(remaining run budget − settle margin, worst-case cap)`, per-edit waits of `min(idleTimeoutMs, remaining budget)`.
- Failure taxonomy (aligned with expansion): per-edit parse/target/timeout/mismatch = record the failure + `editsTruncated`; disconnect = run-level end (partial results); external cancel = `GODOT_ABORTED`.
- Result fields: `edits` (stopIndex + results with target/property/requested/type/ok/detail), `editsApplied`, `editsTruncated` — normalized in the execute() return (null → omitted) and synced in the output schema and card meta.
- `findEditTarget` matches `stack_frame_var` names bare (they carry no `Members/` prefix; a caller-supplied prefix is stripped on both sides).

## Protocol facts (recorded from Godot 4.7, `.context/t6/facts.md`)

- `scene:set_object_property [id, label, value]` has **no ack**; unrelated noise messages (output/error/window:title) may arrive in the window — never treat any-message as a confirmation.
- Bare (`counter`) and prefixed (`Members/counter`) labels both work; int (int32)/float (float32)/string/bool values all land.
- Type coercion: int property ← float value truncates (`12.5` → `12`); string property ← int value is silently ignored; read-only and nonexistent properties are silent no-ops; invalid ids (0, −1) are silent and do not disconnect the game.
- **A running game also accepts the write** (unlike inspect, which is silent when unpaused) — the tool still applies edits only while paused (the model needs the expansion to decide what to change).
- Edits persist across stops: continue → next stop's re-inspection shows the new values; the change is real game state, not protocol-only.

## Source-plugin alignment and deviations

The send shape matches `server_controller.ts` L145-147 and the parse rules follow `edit_value`'s current-type parsing (int/float/bool forms). Deviations: value types are explicit in the tool arguments (the model cannot infer int vs float from the toFixed(1) render), verification is per-edit re-inspect (the plugin refreshes the whole inspector once), and the `changes_parent` path (array/dictionary/nested-object members, `get_changed_value` container rebuild) is NOT ported — it needs whole-container value encoding and belongs after the Phase-8 nested-expansion work.

## Testing

- `edit.spec.ts` 15 tests: parseEditValue (truncation/strict float/bool forms/passthrough), findEditTarget (bare/prefixed/scalar-RID-null rejection), valueEquals, findPropValue (bare/prefixed/missing), applyEdits against the real-Godot `t6-edit` fixture (four typed edits verified, parse/target failures without sending, maxEdits cap, budget exhaustion, disconnect/cancel propagation).
- runDebug edit tests (launch, attach, maxEdits=0) + REAL-composition test with snapshot (`edits (4):` block with per-edit outcomes) + real-Godot smoke: editing `self.counter` to 777 at the line-10 pause makes the next print output `counter=779` — direct engine-side evidence the write landed.
- Keyless fixture `t6-edit.bin`/`t6-edit.json` (45 frames, 20840 bytes); **FakeGame now dispatches `scene:inspect_object` responses by per-id request SEQUENCE** (`inspect:<id>` first, `inspect:<id>:2` second, ...) because the before/after-edit response bytes for the same object differ.
- Launch/attach regression: the full pre-Phase-6 suite still passes (114 tests green + smoke).

## Consequences

- The render guard for the expansion/edits carriers uses `!= null` (the execute() normalization drops null carriers, so `value.edits` may be `undefined` when nothing was edited) — Phase 5's `!== null` had the same latent shape.
- `edits` only ever targets top-level object properties with scalar values; the docs carry the Known Limitations (scalar variables not editable, nested/container members deferred, engine-silent failures surfaced per-edit).
