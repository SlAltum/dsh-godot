---
description: "The optional Godot bundle: one profile row that installs the five Godot packages together and withdraws them together."
kind: "package-bundle"
---

# @deepseek-ai/dsh-godot-bundle

English | [中文](README.zh.md)

One optional install for the Godot family. DSH does **not** ship Godot: `dsh-base` and `dsh-web-app` carry no Godot rows, so a profile adds this bundle only when a project actually uses Godot. Removing the bundle withdraws every Godot tool, the LSP provider, the debugger, the sandbox, and the browser surface together.

The icon is the Godot logo (© Godot Foundation, CC BY 4.0), taken from `godot-vscode-plugin`'s `resources/godot_icon.svg`.

Source entry: [`cordis.patch.yml`](cordis.patch.yml) is the bundle layer; [`src/index.ts`](src/index.ts) is a no-op module.

## Summary

Install every Godot surface with one row instead of five: headless project tools, the GDScript language server, the debugger, the visual sandbox, and the browser settings card. Removing the row withdraws all of them together, so a profile that stops using Godot leaves no trace. Use it when a deployment works on Godot projects; skip it when Godot is irrelevant, because `dsh-base` and `dsh-web-app` carry no Godot rows.

## Table of Contents

- [What it adds](#what-it-adds)
- [Install](#install)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="what-it-adds"></a>
## What it adds

| Row | Package | Surface |
|---|---|---|
| `tool-godot` | [`dsh-tool-godot`](../tool-godot/README.md) | headless runs, screenshots, project inspection, settings form on this bundle's page |
| `lsp-godot` | [`dsh-lsp-godot`](../lsp-godot/README.md) | GDScript language server (attach, spawn, or auto) |
| `tool-godot-debug` | [`dsh-tool-godot-debug`](../tool-godot-debug/README.md) | launch/attach debugging through the DAP |
| `tool-godot-ego` | [`dsh-tool-godot-ego`](../tool-godot-ego/README.md) | the zero-mutation visual sandbox and its watch panel |
| `ui-godot` | [`dsh-ui-godot`](../ui-godot/README.md) | browser half: settings card and watch panel |

<a id="install"></a>
## Install

From a checkout of this repository, install the bundle into the active profile, either through the Plugins page or on the command line:

```bash
dsh plugin install link:D:/source_code/deepseek-harness/packages/godot/bundle-godot
```

Or declare it in the profile's `package.json` and add it to `dsh.profile.bundles`:

```json
{
  "dependencies": { "@deepseek-ai/dsh-godot-bundle": "link:D:/source_code/deepseek-harness/packages/godot/bundle-godot" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-godot-bundle"] } }
}
```

Run `pnpm install` in the profile and restart `dsh web`. The bundle card appears under **Installed plugins**; its page carries the `tool-godot` settings form (executable, gdformat, format backend, timeouts). Every row keeps its own defaults, so a machine with `godot` on `PATH` needs no configuration.

A local `link:` install does not install the linked package's dependencies. Link the five row packages into the profile as well; an npm install hoists them automatically. The profile in this checkout does both.

<a id="model-experience"></a>
## Model Experience

### Composed Godot tools

#### What the model sees

Nothing from the bundle itself: its rows contribute the `godot_*` tool schemas and their system-prompt sections, documented by `tool-godot`, `tool-godot-debug`, and `tool-godot-ego`.

#### Token effect

The sum of those rows. The bundle adds no prompt text or tool schema of its own.

#### KV Cache effect

None from the bundle; each row's prompt section stays stable and is cached like any other tool section.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle is all-or-nothing at install time. A profile that wants only the headless tools can insert the individual packages instead of this bundle, or disable rows in its own patch after installing it.
- `lsp-godot` and the sandbox default to `godot` on `PATH`; override `spawnExecutable` or `executable` when the binary lives elsewhere.
- The browser surface needs a `dsh web` deployment. Headless deployments still get the tools and the LSP provider.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`cordis.patch.yml` is the whole layer; `src/index.ts` is a deliberate no-op module so the package resolves as a plugin. The bundle icon is the Godot logo (© Godot Foundation, CC BY 4.0) taken from `godot-vscode-plugin` and declared in the manifest rather than drawn here.

</details>
