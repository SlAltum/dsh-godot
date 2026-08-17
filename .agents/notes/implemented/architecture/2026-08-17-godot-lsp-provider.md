# Agent Note: Godot GDScript LSP provider (dsh-lsp-godot)

Status: implemented

English | [中文](2026-08-17-godot-lsp-provider.zh.md)

## Problem

The harness had headless Godot tooling (`tool-godot`) but no semantic navigation for GDScript: the `ctx.lsp` seam's four operations had no Godot provider, and tool-godot documented the gap as deferred. The VSCode ecosystem's mature integration (godot-vscode-plugin, 700k installs) proved Godot's built-in TCP language server (default `127.0.0.1:6005`) is the stable channel — no game-side autoload, no editor addon.

## Decision

Add `@deepseek-ai/dsh-lsp-godot` at `packages/godot/lsp-godot`: a `ctx.lsp` provider (id `godot`, `.gd` → `gdscript`) serving `goToDefinition` / `findReferences` / `hover` through transient `didOpen` queries, with two connect modes plus auto:

- **attach** — connect the running editor's LSP (`ports` list, default `[6005]`); the provider does not own the server, so cancellation means disconnect-and-reconnect (Godot does not recognize a reconnected client, source plugin issue #844).
- **spawn** — launch `godot --path <dir> --editor --headless --no-window --lsp-port <p>` with a pre-picked port (never port 0), a version gate (Godot 4.2+ / 3.6+, from the source plugin's `verify_godot_version`), a bounded TCP-ready wait with early-exit detection and stderr tail; the spawned editor is owned by the provider and terminated when the connection closes.
- **auto** — probe attach with a bounded connect, fall back to spawn.

Reuse from `dsh-lsp-stdio` is limited to the pure-function layer (`encodeMessage`, `MessageDecoder`, `normalizeLocations`, `normalizeHover`, `requestMethod`, `supportsOperation`, `supportsTransientOpen`, `negotiatePositionEncoding`, `canonicalizeWorkspace`, `readHostSource`). The TCP JSON-RPC endpoint (id pairing, notification routing, partial-frame idle timeout), `CLIENT_CAPABILITIES`, per-workspace connection pool with serialized queues, and the connect-mode orchestration are package-owned — `lsp-stdio`'s `LspInstance` assumes process ownership, which attach mode violates.

## Godot-specific protocol facts (recorded from Godot 4.7, `.context/t0/facts.md`)

- `textDocumentSync` is advertised as `{ change: 1, openClose: true, ... }` — the standard `supportsTransientOpen` check applies; an early probe recording that claimed it was absent was a probe-side field-level bug and was corrected before implementation relied on it.
- `positionEncoding` is omitted (defaults to utf-16).
- A project mismatch is announced by `gdscript_client/changeWorkspace` + `window/showMessage` *before* the initialize response; matching roots send nothing. The workspace-match rule is "client workspace is the server project root or a subfolder of it" (source plugin `check_workspace`). The seam's `LSP_UNAVAILABLE` fails the query when the server project does not match.
- `$/cancelRequest` is ignored: the request completes anyway. Cancellation therefore means best-effort cancel + disconnect; the next query rebuilds the connection.
- Hover returns pre-rendered markdown with a leading tab per line (a code-block hazard) and, on older versions/English docs, bbcode residue tags; the package cleans it (`hover-clean.ts`) before `normalizeHover`.
- Location URIs are URL-encoded (`file:///D%3A/...`) while DSH fs providers emit WHATWG form (`file:///D:/...`); `normalizeGodotUri` aligns them so `tool-lsp`'s workspace-relative rendering works.
- `gdscript/capabilities` notifications carry a large native-class table; the endpoint routes them but the provider ignores the body.
- `goToImplementation` is never advertised; the seam's capability negotiation rejects it with `LSP_UNSUPPORTED_OPERATION` with no special casing.

## Package and ownership boundaries

The plugin registers the provider through `ctx.effect()` and tears the pool down on disposal (HMR-safe: registration disappears and connections close). Connection establishment is injectable (`createConnectDeps`, `EditorSpawner`, version probe) so the spawn pipeline is testable without a Godot binary; the real wiring runs over `ctx.subprocess`. The spawn executable resolves lazily at first spawn (attach-only deployments need no Godot binary). Timers and byte caps validate at load (aligning `lsp-stdio`'s `assertTimer`/`assertPositiveInteger`).

## Alternatives considered

- **Reusing `lsp-stdio`'s `LspInstance` wholesale** — it assumes the provider owns the server process (shutdown/exit/SIGKILL), which attach mode violates; only the pure-function layer is shared, the TCP endpoint and per-workspace pool are package-owned.
- **Adding exports to `lsp-stdio`** (CLIENT_CAPABILITIES, Wire types, per-workspace serialization) — widening an established package's surface for one consumer; the local copies keep the blast radius to the new package.
- **attach-only provider** — spawn mode (headless editor) removes the "user must open the project in Godot" precondition for automated environments; both modes shipped with auto.
- **GDScript Language Server over a subprocess instead of Godot's TCP LSP** — the language-server channel Godot ships is the TCP one the editor and the source plugin both use; a third-party server would drift from the project's actual parse behavior.
- **Relying on the initialize response for the project root** — the protocol carries no root there (T0 pinned); the `changeWorkspace` notification is the only authoritative project-mismatch signal.

## Consequences

Attach mode's correctness depends on the user opening the matching project in Godot; the provider fails loud (`LSP_UNAVAILABLE`) on a detected mismatch but cannot switch Godot's project. Disconnects can leave a stale open document on the server (best-effort `didClose` mitigates; the next `didOpen` overwrites). Spawned editors write `.godot/` import artifacts and cold start can exceed the `lsp` tool's 60 s budget on large projects. A harness crash can orphan a spawned headless editor (subprocess seam cleans up only on the normal lifecycle).

## Testing

- 123 tests across 13 files, 100% per-file coverage: pure-function cleaning (real T0 samples), endpoint behavior against a real `node:net` fake server (framing, pairing, idle timeout, cancellation, malformed frames), pool serialization/eviction, config validation, connect-mode orchestration, the real editor spawner against a fake subprocess seam, a REAL composition (tool-lsp + seam + provider + fake server) asserting model-visible rendered output and disposal, and a keyless replay of the T0 transcript (real Godot 4.7 responses) — no Godot binary required in CI.
