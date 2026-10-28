---
description: "The Godot browser surface: the settings card for the `godot` namespace and a floating watch panel streaming the sandbox’s live frame."
kind: "package-reference"
---

# @deepseek-ai/dsh-ui-godot

English | [中文](README.zh.md)

The **Godot browser surface**: a settings card on the Godot bundle's Plugins page and a floating watch panel for the running game. The card registers one localized `plugins.bundle.config` contribution keyed `@deepseek-ai/dsh-godot-bundle`; the watch panel registers a `shell.overlay` ball that streams the sandbox's live frame. Both live in the browser half; the host seams are owned by [`tool-godot`](../tool-godot/README.md) (settings namespace) and [`tool-godot-ego`](../tool-godot-ego/README.md) (`/api/godot` endpoints). The package is installed by the optional [`dsh-godot-bundle`](../bundle-godot/README.md), not by `dsh-web-app`; without that bundle this client half never loads.

Source entry: [`src/client/index.ts`](src/client/index.ts) — settings card and watch panel registration.

This package is the **persistent** replacement for the settings card that the dynamic UI plugin (`docs/ui-plugin-godot.js`) used to provide: as a `dsh.client` row of the Godot bundle it survives dsh web process restarts, which a process-memory dynamic plugin cannot. The dynamic plugin's debug tool cards (keyed `godot_debug` / `godot_debug_session`) remain out of scope; only the settings card moved here.

The settings card and the watch ball use the Godot logo. The bundled `src/client/assets/godot-logo.svg` is the unmodified icon from `godot-vscode-plugin`'s `resources/godot_icon.svg`; the Godot logo is © Godot Foundation and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Summary

Edit the `godot` settings from the Plugins page and watch a running sandbox game without leaving the conversation: the card registers one localized config contribution on the Godot bundle’s page, and a floating ball opens a live frame the user can click through. Both halves ship with the optional bundle — without it this client half never loads — and the host seams behind them belong to `tool-godot` and `tool-godot-ego`.

## Table of Contents

- [Settings](#settings)
- [Watch panel](#watch-panel)
- [Deployment](#deployment)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="settings"></a>
## Settings

The card edits four fields of the `godot` namespace:

| Field | Meaning |
|---|---|
| `executable` | Godot editor path or PATH command name; blank uses the default `godot`. |
| `gdformatExecutable` | gdformat tool path or PATH command name (used when the backend is `gdformat`). |
| `formatBackend` | `godot_format` backend: `gdformat` or `builtin`. |
| `timeoutMs` | Cooperative tool-call budget in milliseconds (digits only; blank uses the default). |

A card stages what the user types and writes it only on **Save**; the Host is the only authority on acceptance, and a save that did not land keeps its drafts for correction. Fields the user layer carries show an **Overridden** chip and a **Reset** control; clearing a field re-inherits the composition layer. The card renders nothing while the namespace is unavailable, shows a loading note before the first section arrives, and disables its controls on a read-only document.

<a id="watch-panel"></a>
## Watch panel

A floating ball sits at the bottom-right of the shell (`shell.overlay`) and stays visible so a deployment can tell the sandbox is installed. Its dot reports the state: gray idle, green ready, amber lost, red endpoint error. Clicking it opens a panel with the session id and state, the live frame, and a click-to-drive surface. Both the ball and the panel are draggable (the panel by its header); their positions persist in `localStorage` and are clamped to the viewport on resize, and the panel snaps beside the ball whenever it opens.

The frame is the host's MJPEG stream (`/api/godot/view?session=...`, 640-wide JPEG every 200 ms; the host skips a frame while the client is backpressured). Clicking the frame maps its displayed rectangle onto the session's window size and posts `/api/godot/input`, so the click lands at the same game coordinates the user pointed at. The panel polls `/api/godot/sessions` every 1.5 s; that list never contacts the game. Until `tool-godot-ego` is mounted and `godot_play` started a session, the panel shows the idle note and the ball stays gray.

The `/api/godot` endpoints are guarded on the host: loopback plus same-site (`Sec-Fetch-Site`/`Origin`), or a pinned token when the deployment configures one. A same-origin browser needs no token.

<a id="deployment"></a>
## Deployment

Install the optional [`dsh-godot-bundle`](../bundle-godot/README.md); it inserts this row together with `tool-godot` and `tool-godot-ego`:

```bash
dsh plugin install link:D:/source_code/deepseek-harness/packages/godot/bundle-godot
```

A custom composition may add the row directly:

```yaml
- id: ui-godot
  name: '@deepseek-ai/dsh-ui-godot'
```

The card renders on the Godot bundle's page and needs the host to serve the `godot` settings namespace (the `tool-godot` package registers it); it appears only for namespaces the Host actually serves. The watch panel additionally needs [`tool-godot-ego`](../tool-godot-ego/README.md) mounted on the host (it serves `/api/godot/*`) and the shell to declare `shell.overlay` (owned by `dsh-client-ui-layout`); without the host plugin the ball stays idle with the endpoint-error note. Installing or removing either package needs a dsh web restart before the module table includes it.

<a id="model-experience"></a>
## Model Experience

None, as the settings card and watch panel only edit browser-facing settings and render host state; they register nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Debug tool cards stay dynamic** — `godot_debug` card views remain in `docs/ui-plugin-godot.js`; porting them is deferred until a deployment mounts `tool-godot-debug`.
- **Watch panel needs the host plugin** — the ball is always rendered by the client, but frames and click forwarding require `tool-godot-ego`; a deployment without it shows the idle/error state.
- **One preview per workspace** — the panel shows the first running session; the host enforces one session per workspace today.
- **No host code** — the settings namespace, its schema, and its defaults are owned by `tool-godot`; this package cannot change what the Host serves.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package is the persistent replacement for the settings card the dynamic UI plugin used to mount: as a `dsh.client` row it survives `dsh web` restarts. The logo ships from `src/client/assets`, so the manifest must keep the `./assets/*` export and `lib/assets` in `files` or the client bundle refuses to resolve it.

</details>
