---
description: "The GDScript language-server provider for `ctx.lsp`: go-to-definition, references, and hover against Godot’s built-in TCP server, attach or spawn."
kind: "package-reference"
---

# @deepseek-ai/dsh-lsp-godot

English | [中文](README.zh.md)

The **Godot GDScript language-server provider** for the LSP capability seam (`ctx.lsp`). One plugin registers the `godot` provider (`.gd` → `gdscript`) so the model-facing `lsp` tool serves `goToDefinition`, `findReferences`, and `hover` against Godot's built-in TCP language server — attached to a running editor (`127.0.0.1:6005` by default) or spawned as a headless editor (`godot --path <dir> --editor --headless --no-window --lsp-port <p>`). `goToImplementation` is rejected by capability negotiation because Godot never advertises it (T0 facts recorded from Godot 4.7).

Source entry: [`src/index.ts`](src/index.ts) — provider registration and connect-mode wiring.

Godot-specific protocol cleaning lives here: hover markdown cleaning (leading-tab strip plus the source plugin's bbcode-residue floor) and URI normalization (`file:///D%3A/...` → `file:///D:/...`, matching the fs providers' `pathToFileURL` form). Framing, capability negotiation, and result normalization are reused from `@deepseek-ai/dsh-lsp-stdio`.

```ts ignore-check
// A deployment attaches to a running editor (default), or spawns one:
await ctx.plugin(ToolGodotLsp, { connectMode: 'attach', ports: [6005] })
await ctx.plugin(ToolGodotLsp, { connectMode: 'spawn', spawnExecutable: 'C:\\Godot\\godot.exe' })
```

## Summary

Give the model GDScript navigation in a Godot project: jump to a definition, find every reference, and read hover documentation for `.gd` files through the same `lsp` tool it already uses for other languages. It attaches to a running editor’s language server by default, or spawns a headless editor when none is open. Godot-specific cleanup — hover markdown and URI form — happens here; framing and capability negotiation come from the generic stdio provider.

## Table of Contents

- [Deployment requirement](#deployment-requirement)
- [Settings](#settings)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="deployment-requirement"></a>
## Deployment requirement

- **attach mode** needs a running Godot editor with its LSP enabled (Editor → Editor Settings → Network → Language Server; the editor listens on `127.0.0.1:6005` by default, configurable). The opened project must match the queried workspace (same root or a parent of it) — Godot's LSP only indexes the project it opened, and the server announces a mismatch through `gdscript_client/changeWorkspace` during the initialize handshake, which the provider honors by failing the query with `LSP_UNAVAILABLE`.
- **spawn mode** needs a Godot 4.2+ (or 3.6+) executable (headless LSP has a version gate); the provider resolves it lazily at first spawn and verifies `--version`. Spawned editors write `.godot/` import artifacts and take over a port the provider pre-picks; cold start plus first import can exceed the `lsp` tool's 60 s default budget on large projects (raise `timeoutMs` on `tool-lsp` or pre-warm).

<a id="settings"></a>
## Settings

The package does not register a settings namespace; `host`, `ports`, `connectMode`, and the spawn options live in the plugin config (composition entry). The `godot` settings namespace belongs to `@deepseek-ai/dsh-tool-godot`.

<a id="config"></a>
## Config

Every key has a default; a deployment only overrides what its environment needs.

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | LSP server host for attach mode. |
| `ports` | `[6005]` | Ports to probe in order when attaching. |
| `connectMode` | `auto` | `attach` (running editor), `spawn` (owned headless editor), or `auto` (probe attach, fall back to spawn). |
| `connectTimeoutMs` | `1500` | TCP connect budget per attach probe. |
| `idleTimeoutMs` | `10000` | Partial-frame stall budget before the connection is dropped. |
| `spawnExecutable` | `godot` | Godot executable for spawn mode (resolved lazily at first spawn). |
| `spawnArgs` | `[]` | Extra argv inserted after the executable. |
| `spawnPort` | `0` | 0 = provider pre-picks a free port; otherwise the explicit port. |
| `spawnReadyTimeoutMs` | `120000` | Budget for the spawned editor's LSP port to accept connections. |
| `maxDocumentBytes` | `4000000` | Largest source document opened in one query. |
| `maxMessageBytes` | `16000000` | Largest single framed message accepted from the server. |
| `maxStderrBytes` | `1000000` | Largest spawned-editor stderr tail retained for diagnostics. |
| `killGraceMs` | `2000` | Cancel-grace and terminate-escalation budget for spawned processes. |
| `spawnRetryCooldownMs` | `60000` | Cooldown after a FAILED spawn: further spawn attempts for the same workspace fail fast with `LSP_UNAVAILABLE` until it elapses (a broken project may never start its LSP — the server does not initialize when the project has errors); a successful spawn clears it. `0` disables the cooldown. |

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

The package registers no system-prompt section; the `lsp` tool's guidance (`tool-lsp`) covers operation semantics. The provider only makes Godot queries possible; it does not change what the model sees.

##### Godot LSP guidance (provider)

```markdown
No provider guidance: the lsp tool's operation semantics are covered by tool-lsp.
```

#### Token effect

The provider registers no prompt section; the fixed `lsp` tool guidance (`tool-lsp`) is unchanged by this package.

#### KV Cache effect

Prefix-stable while the `tool-lsp` guidance is unchanged; provider registration adds no prompt tokens of its own.

### Results

#### What the model sees

`goToDefinition`/`findReferences` return locations rendered by `tool-lsp` as workspace-relative `path:line:character` entries (Godot URIs are normalized to the fs form first); `hover` returns cleaned markdown (leading tabs stripped, bbcode residue compatibility floor). Empty hovers (`contents: []`, which Godot returns on type positions) normalize to a successful no-result.

#### Token effect

Bounded by `tool-lsp`'s result caps; connection state is never model-visible.

#### KV Cache effect

Append-only; query results follow the reusable request prefix.

### Tool errors

#### What the model sees

Failures are normalized as `LspError` codes: `LSP_UNAVAILABLE` (no server on the configured ports, spawn version gate failure, spawn early exit, connection loss mid-query, or a project mismatch), `LSP_UNSUPPORTED_OPERATION` (`goToImplementation` — Godot never advertises it — or a server without transient-open support), and the seam's `LSP_MALFORMED_RESPONSE` for unparseable server payloads.

#### Token effect

Only a failing query adds these retained tokens.

#### KV Cache effect

Append-only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **attach requires a matching running editor** — Godot's LSP indexes only the project it opened; the provider fails queries when the server's `changeWorkspace` path does not match the query workspace (same root or parent). There is no attach-side way to switch Godot's project.
- **Godot ignores `$/cancelRequest`** — an aborted query is canceled by disconnecting; the next query establishes a fresh connection (the server does not recognize a reconnected client, source plugin issue #844).
- **An abrupt disconnect may leave a stale open document on the server** — the provider sends a best-effort `didClose` before dropping an aborted connection; the next `didOpen` overwrites server-side state.
- **spawn needs Godot 4.2+ / 3.6+** — older binaries silently skip LSP startup; the provider fails loudly with the reported version instead.
- **Spawned editors are owned by the provider** — connection close terminates the editor process; a harness crash can leave an orphan headless editor (the subprocess seam cleans up only on the normal lifecycle).
- **A failed spawn arms a per-workspace retry cooldown** (`spawnRetryCooldownMs`, default 60 s) — the server may not initialize when the project has errors (godotengine/godot#103313), so a broken project is not cold-started on every query; inside the cooldown queries fail fast with `LSP_UNAVAILABLE` and the retry hint. A successful spawn clears the cooldown.
- **A spawned editor cold start writes `.godot/` import artifacts** and can exceed the `lsp` tool's 60 s budget on large projects.
- **`gdscript/capabilities` notifications are ignored** — the native-class table is large and not part of the seam's four operations.
- **No formatting or rename** — the seam exposes only the four semantic operations; Godot's LSP formatting/rename surface is out of scope (see `tool-godot` for headless formatting).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Godot’s server is a TCP service, not stdio, so the provider owns the connect modes (`attach`, `spawn`, `auto`) and reuses one provider per workspace. `goToImplementation` stays rejected because Godot never advertises it; the recorded 4.7 capability facts are the authority before widening the operation set.

</details>
