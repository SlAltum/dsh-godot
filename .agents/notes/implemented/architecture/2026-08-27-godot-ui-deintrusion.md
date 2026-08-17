# Agent Note: remove godot UI intrusion from the DSH core (ui-settings-plugins)

Status: implemented

English | [中文](2026-08-27-godot-ui-deintrusion.zh.md)

## Problem

Uncommitted work had embedded a godot-specific settings card (`GodotCard.tsx`, `godot-card-controller.ts` — both UNTRACKED) into `packages/client/ui-settings-plugins`, with tracked-file edits (`src/client/index.ts` unconditionally registering the card, `locales.ts` godot keys, three test files) referencing it. Publishing would break installs: tracked reference edits ship in the package while the untracked card file does not — `import { GodotCard }` fails after installation. The card was also a permanent godot-specific component inside the DSH core's UI regardless of whether the godot packages are installed.

## Decision

Remove the intrusion entirely (git checkout of the five tracked files + delete the two untracked ones — no broken links since referrers and referees were all uncommitted; the package's 77 tests went green again). Godot UI now ships as a DYNAMIC Cordis plugin (`docs/ui-plugin-godot.js` in the godot repo): a `settings.plugin.item` card (edits the `godot` settings namespace via `ctx.settingsScope.bind`) and a `tool.call.toolview` keyed row for `godot_debug` — zero footprint in the core, fully cohesive with the godot repo.

## Notes

- The `tool.call.toolview` keyed slot is the standard additive path for a tool's own card (bash/read/edit/web precedents); the generic card is the fallback for unclaimed keys.
- Dynamic client-face constraints: plain JS (React arrives as a closure symbol, CSS via `styles.insert`, theme via `var(--dsw-*)`), `inject: ['slots']` mandatory, registrations inside `ctx.slots.inject(key, () => ctx.slots.register(...))`, `settingsScope.bind` needs `connection` + `remote` injected.
- The dev GUI page did not answer client Inspect queries (they hang); all contracts were read from source instead (`ui-tool` toolviews + the slot-catalog dynamic-registration examples).

## Testing

- Core package restored: `ui-settings-plugins` 77/77 tests, `git status` clean.
- The dynamic plugin's UI could not be end-to-end verified in this environment (unresponsive page); its registrations follow the slot-catalog examples and the shipped card precedents verbatim.
