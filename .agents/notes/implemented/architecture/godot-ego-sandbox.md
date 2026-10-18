# Agent Note: the ego-godot visual sandbox (tool-godot-ego)

Status: implemented

English | [中文](godot-ego-sandbox.zh.md)

## Problem

The Godot family could validate, format, inspect, and script-debug a project, but it could not **see** a running game. `godot_run_scene` is one-shot (run N frames, return stdout, exit), and `godot_debug` stops at breakpoints with text output. UI layout, animation feel, and physics questions therefore required editing code, running once, and guessing from `print` lines.

## Decision

Add `packages/godot/tool-godot-ego` (`@deepseek-ai/dsh-tool-godot-ego`, host-only): one persistent game process per workspace, exposed as twenty-one model tools plus a conditional `godot_eval`.

**Injection is zero-footprint.** A temporary `boot.gd` `SceneTree` replaces the project's main loop, injects a bridge node loaded from outside the project, and then changes to the main scene — or to `DSH_EGO_SCENE` when `godot_play` passed `scene?`. Port and token travel through the environment, never through argv after `--`, so the game's own argument parsing is untouched. `project.godot` and every `res://` file stay byte-identical; the engine's `.godot/` import cache is the only engine-owned artifact.

**The session is the unit of composability.** A workspace-keyed registry publishes `godot.egoSessions`; the plugin fiber's inverse disposes every session, which closes the socket, terminates the process, and removes the temporary scripts. Tools register inside `ctx.inject(['tools'])`, the frame tool inside `ctx.inject(['attachments', 'llm'])`, and the viewer route inside `ctx.inject(['webServer'])`, so a deployment without those services still gets a complete sandbox. One `godot_play` either reaches `ready` or rolls the whole session back; repeating `godot_stop` is safe and returns `stopped: false`.

**Godot installs as one optional bundle.** `dsh-base` and `dsh-web-app` mount no Godot rows; `packages/godot/bundle-godot` (`@deepseek-ai/dsh-godot-bundle`) inserts the five rows — tools, LSP, debugger, sandbox, and browser surface — as one profile layer. The settings card registers `plugins.bundle.config` keyed by the bundle name, so it follows the installed package and appears on its page under Installed plugins instead of the built-in configuration list. A deployment without the bundle has no Godot tool, schema, or prompt section.

**The protocol is newline-delimited JSON.** The bridge keeps `PROCESS_MODE_ALWAYS` so a paused game still answers, captures frames into memory (`save_png/jpg/webp_to_buffer`), compares frames with the engine's `compute_image_metrics`, reads properties through `get_property_list` filtered to stored and script variables, and injects input with `Viewport.push_input`. Failure codes are package-owned (`EgoGodotError`, eight codes) rather than extending the closed `tool-godot` taxonomy.

**Tool surface.** Session: `godot_play` / `godot_stop` / `godot_scene` / `godot_status`. Observation: `godot_see` / `godot_state` / `godot_node` / `godot_find` / `godot_diff` / `godot_logs` / `godot_actions`. Operation: `godot_click` / `godot_key` / `godot_type` / `godot_fill` / `godot_check` / `godot_hover` / `godot_drag` / `godot_scroll` / `godot_wait` / `godot_wait_for`. `godot_eval` exists only with `allowEval: true`. Alignment with the browser sandbox is recorded per capability: form controls map to `godot_fill` and `godot_check`; `godot_wait_for` gained the `path` + `exists` form of wait-for-element; hover and scroll accept a Control path. Selection (`godot_select`) needs an engine-side value change plus a signal, so it stays with the deferred property-write phase, and the browser-only runtime features (login import, CAPTCHA, dialogs, downloads, HTTP, raw CDP, arbitrary scripts) have no Godot counterpart.

## Notes

- **Schema validation owns type checks.** Parameter schemas already reject non-finite numbers, non-integers, and non-tuples, so the tools do not repeat those checks in `execute`; only semantic guards remain (non-empty text, non-zero wheel delta, positive step count, `res://` scene path). Duplicated runtime guards would be unreachable and would fail the per-file branch gate.
- **`godot_status` reads the host side only.** It projects an optional `snapshot?()` on the session handle. The real session always provides it; a custom factory without one reports `state: "unknown"` rather than fabricating lifecycle state. The registry keeps a lost session until `godot_stop`, so the loss reason stays readable.
- **`godot_wait_for` polls without a bridge change.** It reads a state field (`frames`, `fps`, `nodeCount`, `paused`, `scene`) or one node property and compares with `Object.is`; a timeout carries the last observed value so a typo is diagnosable. The `path` + `exists` form covers wait-for-appearance/disappearance, the Godot equivalent of a browser selector wait.
- **Form tools compose input and verify the result.** `godot_fill` clicks, sends Ctrl+A, types, and reads `text` back; `godot_check` reads `button_pressed` first and only clicks when the state differs. Verification is not optional: a game has no DOM value to trust, and a silent mismatch would teach the model a false state.
- **A wheel press must be released.** Pinned on a real Godot 4.7.2: sending only the `pressed` wheel event leaves the GUI state such that the next left click no longer toggles its Control, so the bridge sends the matching release. The smoke test keeps the wheel-then-check sequence that caught it.
- **`godot_scene` and `godot_play.scene` share `change_scene_to_file`.** The switch does not replay the project's own boot logic; the README says so.
- **`godot_diff` needs a prior frame.** The bridge compares against the last captured frame, so the tool documents "call `godot_see` first" and surfaces the bridge's `REJECTED` reply unchanged.
- **The frame tool degrades.** Without an attachment store or a vision-capable route it returns text and a saved path; with them it returns an image content block plus frame metadata.
- **The watch panel is a browser client with its own timer.** `ui-godot` registers a `shell.overlay` ball that polls `/api/godot/sessions`, streams `/api/godot/view`, and forwards frame clicks to `/api/godot/input`. The ball and panel drag by pointer events and remember their spots in `localStorage`; the panel snaps beside the ball on open. Chrome rejects a global timer invoked as a method (`this` must be `globalThis`), and that failure takes down the whole client fiber at boot, so the controller wraps `globalThis.setInterval`/`clearInterval` and a regression test pins the receiver; the watch registration also logs a failure instead of letting it fail the plugin. The `/api/godot` routes guard themselves with loopback + same-site checks because the web server has no auth layer.
- **`allowEval: false` is a misuse surface, not a security boundary.** The agent can still write a `.gd` file; the gate exists so the model does not reach for arbitrary expression evaluation by default.

## Testing

- 217 unit tests across 21 specs, one spec per tool family, covering default and overridden arguments, rendering, bridge rejection, and the no-session path. Real-machine smoke is gated by `DSH_TEST_GODOT`. The `ui-godot` client suite adds 46 tests, including the timer-receiver regression.
- Coverage is 100% per source file; unreachable branches were deleted rather than ignored, and the new modules add no `v8 ignore`.
- The smoke chain plays, observes, reads, operates, and stops the spike project, and now also exercises status, scene, actions, find, diff, wait_for (including node appearance), hover, scroll, type, drag, check, and fill (twice, so replacement is proven) against a real Godot 4.7.2.
- Gates: `tsc -b` 0, oxlint 0, `vitest` 217 passed + 1 skipped, coverage 100%, README pairing consistent, tool/config catalogs regenerated in both languages.
