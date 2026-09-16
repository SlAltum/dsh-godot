# @deepseek-ai/dsh-ui-godot

English | [中文](README.zh.md)

The **Godot settings card** for the Web Plugins configuration surface (`设置 → Plugins`). The browser plugin registers one localized `settings.plugin.item` contribution keyed `godot`; the Plugins section owns the card slot and chrome. The card edits the `godot` settings namespace through the client settings scope — the namespace itself is owned by the host-plane [`tool-godot`](../tool-godot/README.md) package, so this package carries zero host code and renders nothing when a deployment does not compose it.

This package is the **persistent** replacement for the settings card that the dynamic UI plugin (`docs/ui-plugin-godot.js`) used to provide: as a `dsh.client` row of the deployment composition it survives dsh web process restarts, which a process-memory dynamic plugin cannot. The dynamic plugin's debug tool cards (keyed `godot_debug` / `godot_debug_session`) remain out of scope; only the settings card moved here.

## Settings

The card edits four fields of the `godot` namespace:

| Field | Meaning |
|---|---|
| `executable` | Godot editor path or PATH command name; blank uses the default `godot`. |
| `gdformatExecutable` | gdformat tool path or PATH command name (used when the backend is `gdformat`). |
| `formatBackend` | `godot_format` backend: `gdformat` or `builtin`. |
| `timeoutMs` | Cooperative tool-call budget in milliseconds (digits only; blank uses the default). |

A card stages what the user types and writes it only on **Save**; the Host is the only authority on acceptance, and a save that did not land keeps its drafts for correction. Fields the user layer carries show an **Overridden** chip and a **Reset** control; clearing a field re-inherits the composition layer. The card renders nothing while the namespace is unavailable, shows a loading note before the first section arrives, and disables its controls on a read-only document.

## Model Experience

None: the card only edits browser-facing settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Deployment

Add a `dsh.client` row to the deployment composition:

```yaml
- id: ui-godot
  name: '@deepseek-ai/dsh-ui-godot'
```

Requires the host to serve the `godot` settings namespace (the `tool-godot` package registers it); the tab dispatches the card only for namespaces the Host actually serves.

## Known Limitations and Deferred Work

- **Settings card only** — the debug tool cards stay with the dynamic UI plugin (`docs/ui-plugin-godot.js`); porting them is deferred until a deployment mounts `tool-godot-debug`.
- **No host code** — the namespace, its schema, and its defaults are owned by `tool-godot`; this package cannot change what the Host serves.
