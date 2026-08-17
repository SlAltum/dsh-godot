# Agent Note: lsp-godot spawn retry cooldown (dsh-lsp-godot)

Status: implemented

English | [中文](2026-08-27-godot-lsp-spawn-cooldown.zh.md)

## Problem

A broken project/environment can prevent Godot's LSP from starting at all (the server does not initialize when the project has errors — godotengine/godot#103313). Spawn mode cold-started a headless editor on EVERY query and burned the 60 s tool budget each time, with no backoff.

## Decision

Add a per-workspace spawn retry cooldown (`spawnRetryCooldownMs`, default 60 s, `0` disables): after a FAILED spawn the same workspace fails fast with `LSP_UNAVAILABLE` (with a retry hint) instead of re-spawning; a SUCCESSFUL spawn clears the cooldown. Implemented as a wrapper around `spawnEditor` in `createConnectDeps` (index.ts) keyed by `workspace.canonicalPath` — attach-only mode never enters the wrapper, so a missing editor is not cooled down; auto mode's attach-fail-then-spawn path is covered because the fallback goes through the same spawnEditor.

## Notes

- T17-B (a `completion` LSP operation) was REJECTED by the user: it requires extending the shared lsp seam (lsp / lsp-stdio / tool-lsp — the closed `LspOperation`/`LspQueryResult` unions), which violates the D3 no-blast-radius decision. All cross-package edits were rolled back via git checkout; the idea is parked for a separate project that owns the seam change.

## Testing

- New e2e (real-composition.spec.ts): failure arms the cooldown → a second call fails fast with `LSP_UNAVAILABLE` and spawns NOTHING → after the cooldown elapses a retry succeeds and clears it → the next call spawns again. Failure is injected with an editor that exits immediately against an unlistened port (the readiness probe wins the race against the exited-process check when the port answers — the test server port would defeat the injection).
- 125 lsp-godot tests green; lint/tsc clean; README pair + config-catalog regenerated (the zh mirror also picked up the historically missing tool-godot-debug config fields).
