# Agent Note: Godot debug structured card view (dsh-tool-godot-debug + ui-plugin-godot)

Status: implemented

English | [中文](2026-08-27-godot-debug-structured-card.zh.md)

## Problem

`godot_debug` results rendered as one plain-text block (`renderDebugOutput`). The dynamic tool card (`docs/ui-plugin-godot.js`) showed only the head line plus a collapsed `<pre>` — per-stop sections, frames, variables, the expansion tree, and scene trees were all buried in one wall of text, with no structured data crossing to the browser.

## Decision

Carry a structured, JSON-safe, byte-bounded **card view** through the tool's `presentationMeta` (the vehicle is `tool/result.meta` → `ToolResultNode.meta`; `resultView` was rejected — it is recomputed per view-time by the host registry's `presentResult` and putting UI knowledge there would break D3 blast-radius):

- **`structuredDebugView(value, maxStops)`** (`src/debug-view.ts`): input = the EXECUTE-NORMALIZED result (null carriers already absent, bigint ids already strings — the view never sees bigints, so the JSON boundary is the execute layer's responsibility). Emits `version: 1` with per-stop frames, the FIRST frame-bearing stop's rendered scope lines (size parity with the text report — attach `break` empty-stack alignment uses the same `fullIdx` rule), the expansion tree, edit outcomes, per-stop scene trees, and bounded output/error tails.
- **Byte budget**: `VIEW_MAX_BYTES = 256 KiB` on the serialized view; cuts scope lines first, then scene-tree lines, flagging `viewTruncated` (the framework imposes NO meta size cap — the tool must bound itself; a runaway view would bloat session logs, the wire, and client memory).
- **`presentationMeta`** now returns `{ ...debugMeta(...), view }` — the compact DebugMeta fields stay for backward compatibility; `maxStops` is clamped with `Math.min(args.maxStops ?? 10, MAX_STOPS)` exactly like execute (was inconsistent before).
- **Card** (`docs/ui-plugin-godot.js` v2.4): `parseDebugView` narrows the opaque meta defensively — any shape violation (wrong array type, missing field, unknown version) falls back to the plain text report, so one view bug cannot break every structured card. Structured render: chips row (`N 停顿`/`M 场景树`/`K 编辑`/`展开对象`/`部分截断`), one collapsible section per stop (frames, scope lines, expansion tree, edits, scene tree), output/errors sections, frame file links when the run carried a project `path` (launch; attach has no project mapping — frames are not clickable there).

**Type note**: `DebugView` and friends must be `type` aliases, not interfaces — an interface has no implicit index signature, so `presentationMeta`'s `JsonValue` return rejects it at compile time (also `ExpandedEntry`/`EditResult` are re-declared as `DebugExpandedEntry`/`DebugEditResult` for the same reason).

## Testing

- Unit (`tests/debug-view.spec.ts`, 9 tests): full view shape, attach `break` empty-stack alignment, no-frame fallback, absent-carrier omission, **lossless JSON round-trip** (H1/H4 boundary), output/error tail bounds, both byte-budget cut stages, no false truncation under budget.
- Package regression: 195 tests green, tsc 0.
- Session e2e: a dynamic demo tool (`godot_debug` name shadowing the global, `harness.defineTool` supports `output.presentationMeta`) emitted four controlled scenarios — success (structured card), fallback (no `view`), corrupt (`view` shape violation → narrowing rejects), error (red card). The real presentationMeta shape is additionally covered by the replay fixtures in real-composition.spec.
- Deployment boundary: this deployment does not mount tool-godot-debug, so a real-machine card render awaits a deployment with the tool mounted.

## Consequences

- The card is now structured and collapsible per stop, with frame links and summary chips; old results without a `view` render exactly as before.
- Known limits kept from the plan: icon assets (T20-opt, ~700 SVG port pending a decision), per-variable structured rows (scope lines are rendered strings — the pinned render semantics stay), visual styling is text-first ("TUI-like") by choice.
