# Agent Note: persist the godot settings card as a client package (ui-godot)

Status: implemented

English | [中文](2026-08-28-godot-ui-card.zh.md)

## Problem

After the de-intrusion work, the godot settings card lived in the DYNAMIC Cordis plugin (`docs/ui-plugin-godot.js`). A dynamic plugin is process-memory state in the dsh web runtime: it survives page refreshes and new sessions, but a dsh web process restart loses it. On 2026-08-19 two restarts made the card disappear (the host-side `godot` namespace and its data were intact; only the browser-side UI registration was gone). The user ruled out tool-cordis (an in-process plugin re-definition tool) as the reload mechanism — the trust surface of an agent permanently defining plugins in-process was rejected — and chose a persistent client plugin package instead.

## Decision

New package `packages/godot/ui-godot` (`@deepseek-ai/dsh-ui-godot`), a browser-only client package registered as a `dsh.client` row (survives restarts by construction). v1 ports ONLY the settings card (`settings.plugin.item`, keyed `godot`) from the dynamic plugin — the debug tool cards (`godot_debug` / `godot_debug_session`) depend on an unmounted `tool-godot-debug` in this deployment and stay with the dynamic plugin. Zero host code: the `godot` namespace is owned by `tool-godot`; the card reads/writes it through `ctx.settingsScope.bind({ namespace: 'godot' })`.

Structure: `godot-card-form.ts` (self-contained staged form — the reference `CardForm` lives package-private in `ui-settings-plugins` and cannot be imported), `godot-card-controller.ts` (scope → form → `hooks.godotCard` snapshot store), `GodotCard.tsx` (four-share props + own chrome, `--dsw-*` tokens), `locales.ts` (zh copy verbatim from dynamic plugin v2.3 + en mirror). Registration goes through `ctx.slots.inject('settings.plugin.item', ...)` with the keyed-only option `{ key: 'godot' }` — the key+id double-write bridge of the dynamic plugin is a compat measure for deployed bundles lagging the workspace source; a package built from the same tree needs only the current keyed contract.

Three registration faces, all required: root `tsconfig.client.json` references entry; `packages/bundle/web-app/cordis.patch.yml` browser-roster row (`- id: ui-godot` / `name: '@deepseek-ai/dsh-ui-godot'`); `packages/bundle/web-app/package.json` dependency (`workspace:^`). `pnpm-workspace.yaml` already globs `packages/*/*`.

## Notes

- The `settings.plugin.item` SlotMap entry is declared by its declarer (`ui-settings-plugins/src/client/slot-contract.ts`); the package pulls the merge with a type-only import from `@deepseek-ai/dsh-client-ui-settings-plugins/client` — no value import crosses the client bundle purity gate (type-only imports are erased).
- The card renders nothing while the namespace is unavailable, matching the plugin-card chrome; loading and read-only notes come from the form shell (`available` / `loading` / `writable`).
- `selectField` requires a non-empty tuple type (`readonly [string, ...string[]]`) so the fallback value is total without a non-null assertion (oxlint bans `!`).
- The dynamic plugin's settings card registration degrades gracefully when `ui-godot` is also composed (same key → its own try/catch); docs advise keeping only one.

## Testing

- 44 tests across 5 specs: staged-form semantics (22), component behavior under jsdom (12), real tsdown bundle shape incl. mounted registration on a real SlotRegistry ring (3), apply wiring + teardown (4), invariant companion (1).
- Coverage 100% on the package source (the only ignored arm is the defensive no-hint render path, with reason).
- Client aggregate `tsc -b tsconfig.client.json` green; oxlint 0; `verify-cordis-config` 122 files passed; README pairing verified with local `.context/verify-pairing.mjs` (tsx wrapper is EPERM in the sandbox).
- End-to-end visual check requires a dsh web restart (module table is composed at startup) — deployment-side step, recorded in the plan.
