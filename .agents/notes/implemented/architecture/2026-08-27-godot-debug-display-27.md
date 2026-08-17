# Agent Note: Godot debug 2.7.0 display upgrade (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-27-godot-debug-display-27.zh.md)

## Problem

The source plugin's 2.7.0 release (godot-vscode-plugin PR #944, commit e99adb0) overhauled its debugger variable display: `__repr__` display names, `&'StringName'` representation, quoted strings, category-tracked property names, and value previews for arrays. Our port had only the pre-2.7.0 surface (v1 simplifications), plus a latent encoder crash for object ids above 2^63-1 discovered while pinning.

## Decision

Port the 2.7.0 display surface into the one-shot architecture (user confirmed: follow the mature reference behavior, no invented rules — `.context/plans/godot-debugger-display-27计划.md`):

- **Category-tracked property names** (`parseInspectProps`, aligned with `server_controller.ts` L464-485): a usage-128 marker names the group of the following bare props (`Node/process_mode`, `Node/script`, `Node/Process = null` — group headers stay visible); `Members/`/`Constants/` prefixes strip; baked prefixes (`Node/path`) keep. Pinned on Godot 4.7 (`.context/t13/facts.md` facts 4/7/8).
- **`__repr__` display names**: `expandObjects` is now TWO-PHASE — fetch all objects retaining raw props (same budget/dedup/skip semantics), then render with a repr index (`Members/__repr__` → raw value, fact 1/2). Entry heads show `<repr> [class]`; references to expanded objects (property values, array previews) resolve their repr; `Object<id>` stays for everything else. Divergence (documented): the source plugin resolves lazily via its VariablesManager; the one-shot tool resolves only what it expanded.
- **Display rules** (`renderValue`/`renderPreview`): StringNames `&'x'` (values and dict-key paths — the old `String(key)` produced `[object Object]` for StringName keys, fact 3); array preview items render their ACTUAL values — math types BARE (`(2) [(11, 12), (21, 22)]`), reprs resolved, primitives as usual; top-level math values keep `Vector2(10, 20)`.
- **Edit contract** (fact 5): the engine SILENTLY rejects non-`Members/` prefixed write labels (`Node/process_priority` pinned rejected). `findPropRow` matches exact → `Members/`/`Constants/`-insensitive → category-prefix-stripped; a single-segment edit with a category prefix resolves its RAW label via one live inspect before the set (bare/`Members/` names keep the pinned no-pre-inspect Phase 6 shape — t6 fixture byte-identical).
- **Encoder fix** (fact 6): bigint variants write two's-complement UINT64 bits (`writeBigUInt64LE` for non-negative) — RefCounted ids above 2^63-1 (t13 pinned 9223372064000312793) previously threw RangeError and truncated the expansion.

## Protocol facts (recorded from Godot 4.7, `.context/t13/facts.md`)

- `__repr__` arrives as `Members/__repr__` (usage 4100), value String.
- StringName dict keys decode as StringName instances.
- Group-header rows: `Process`(64), `Thread Group`(256), `Physics Interpolation`(64), `Auto Translate`(64), `Editor Description`(64) — null values, NOT usage-128 markers.
- Engine label acceptance: bare ✓, `Members/` ✓ (T6 re-verified), `Node/` ✗ silent.
- RefCounted object ids can exceed 2^63-1; the engine echoes their two's-complement bits.

## Source-plugin alignment and deviations

Category tracking and display rules match the 2.7.0 code paths verbatim. Deviations (documented in the README): (a) group headers and category prefixes render per the 2.7.0 rules on 4.7 payloads (the source plugin's CI Godot era encoded them differently — the mechanism is the same); (b) scope-level ObjectIds keep `Object<id>` (resolving class names would need a fetch per value — outside the one-shot budget); (c) dict-key display `&'k'` as standalone key rows is deferred to T16 (paths keep the raw value so edit round-trips are unchanged).

## Testing

- Real-machine probe `.context/t13/run-t13.mjs` (tsc-compiled build): raw facts + shipped `runDebug` — 8/8 display assertions on Godot 4.7 (`thing = Thing(hero)`, `(2) [Thing(a), Thing(b)]` preview, `&'hero'`, `Node/process_mode`/`Node/script`/`Node/Process` rows, `sn_key_dict["snkey"]` child path, `Node/process_priority` edit ok via raw label, 6 objects expanded untruncated — the encoder fix).
- Unit: category tracking, repr resolution (two-phase fetch→render), key display, preview rules, findPropRow prefix matching, prefixed single-segment edit flow, encoder uint64 round-trips.
- e2e: fixture replays unchanged (t3/t5/t6/t8/t10/t14 — zero fixture edits); snapshots re-recorded (4).
- 174 tests green (3 smoke-real skips), lint 0, tsc 0.

## Consequences

- The model sees the same 2.7.0 display surface as the source plugin's users: readable object names, `&'x'` StringNames, real array previews, grouped property names — and can edit grouped properties without hitting the engine's silent label rejection.
- The encoder now handles unsigned-high ids, which previously truncated expansions on long-running games.
- Leftovers: dict key expansion & `&'k'` key names (T16), scene-tree node linkage (T15), cross-stop dedup (T13), scope-level ObjectId class names (documented divergence).
