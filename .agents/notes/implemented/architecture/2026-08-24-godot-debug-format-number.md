# Agent Note: Godot debug number rendering precision (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-24-godot-debug-format-number.zh.md)

## Problem

Two display paths lost float precision: `snapshot.ts renderValue` used `toFixed(5)` (`0.1234567` → `0.12346`), and the math types' `stringify_value` used the source plugin's `toFixed(1)` UI rounding (`0.123456` → `0.1`) — a debugger showing `0.1` for a 0.123456 coordinate is misleading.

## Decision

Replace fixed-decimal rounding with **significant digits** (no protocol change, no new package):

- `variants.ts` exports `formatNumber(value, maxSignificantDigits = 7)`: integers render verbatim (`String(value)`); non-integers keep up to 7 significant digits via `toPrecision(7)` + `parseFloat` (drops trailing zeros).
- `clean_number` (math types) becomes a thin wrapper; `renderValue`'s number branch calls `formatNumber` directly.
- 7 digits round-trip any float32 losslessly; float32 wire artifacts (`0.10000000149011612` — the 0.1-as-float32 decode) normalize back to `0.1` for free. Very large/small magnitudes fall through to JS exponential form (`1e+21`, `1e-7`).
- Display lengths stay bounded by `maxValueLength` (unchanged); rendering a 7-digit number never approaches it.

## Design notes

- `formatNumber` lives in `variants.ts` because `snapshot.ts` already depends on it (safe direction); the 9 math-type `stringify_value` call sites are unchanged (they call `clean_number`).
- Integer fast path also covers `-0` (`String(-0)` is `"0"`) and integers beyond `MAX_SAFE_INTEGER` that happen to be `Number.isInteger` (they stringify normally until 1e21, then exponential — acceptable).
- The 7-digit cap truncates float64 high precision (`0.123456789012345` → `0.1234568`) — a deliberate debugging-display balance; full precision would need a config knob (not done).

## Testing

- `formatNumber` unit tests: integers verbatim (incl. large), 7-significant-digit truncation with trailing-zero removal, float32 artifact normalization, negative values, exponential fall-through.
- `renderValue` math-type test: `Vector2(0.123456, 2.5)` renders with precision (was `Vector2(0.1, 2.5)`).
- Snapshot assertion updated (`0.1234567` stays; was `0.12346`); real-composition snapshots re-recorded — `_delta = 0.00694` → `0.006944444` (1/144), `0.06667` → `0.06666667` (1/15), the visible precision win.
- Full suite green (141 tests + real smoke); integer-heavy assertions (`counter = 1`, `Vector2(10, 20)`) unchanged.

## Consequences

- All numeric displays in the debug report now show meaningful precision; the Known Limitations entry no longer claims source-plugin `toFixed(1)` rounding.
- `formatNumber` is exported for reuse (e.g. future scene-tree or expansion value formatting).
