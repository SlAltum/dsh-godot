# @deepseek-ai/dsh-tool-godot-ego

English | [中文](README.zh.md)

The **visual sandbox** for Godot projects: `godot_play` starts a persistent game process and keeps it running between tool calls, so the model can **see** a frame, **read** the scene and live properties, **operate** the game with mouse, keyboard, and waits, and **stop** it when done. Twenty-one tools register by default; `godot_eval` joins them only when `allowEval` is on.

Source entry: [`src/index.ts`](src/index.ts) — plugin entry (service, tools, prompt section, viewer route).

The sandbox is **zero-footprint** on the project: a temporary `SceneTree` replaces the game's main loop, the bridge node is loaded from outside the project, and `project.godot` plus every `res://` file stay byte-identical. Port and token travel through the environment, frames stay in memory, and the game process is owned by the session, not by the harness job runtime.

The package injects `tools`, `subprocess`, and `systemPrompt`; the frame tool additionally appears only where `attachments` and `llm` are mounted, and the viewer route only where `webServer` exists.

```ts
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodotEgo from '@deepseek-ai/dsh-tool-godot-ego'

// A deployment points at its godot install; the default resolves `godot` on PATH.
export async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodotEgo, { executable: 'C:\\Godot\\godot.exe' })
}
```

## How it works

`godot_play` resolves the project root, runs the one-time `--headless --editor --import` pass when `.godot/` is missing, writes two GDScript files to a temporary directory outside the project (`boot.gd`, `bridge.gd`), binds `127.0.0.1:0`, and spawns `godot --path <root> --script <boot.gd> --windowed --resolution 1280x720 [--position -32000,-32000] [--max-fps N | --fixed-fps N]`. The boot script injects the bridge as a child of the root, then changes to the project main scene — or to `DSH_EGO_SCENE` when `godot_play` was given a scene. The bridge connects back, sends `hello` with the session token and protocol version, and answers newline-delimited JSON. It keeps `process_mode = PROCESS_MODE_ALWAYS`, so a game that pauses itself still answers `state` and `shot`.

Frames are captured inside the engine (`RenderingServer.frame_post_draw` → `get_viewport().get_texture().get_image()`), encoded to PNG/JPEG/WebP buffers, and returned as base64; the bridge never writes to the game filesystem. `shotdiff` compares the current frame with the previous one using `compute_image_metrics`, so the host needs no image-decoding dependency. Input is injected through `Viewport.push_input` (synchronous and scoped to the game viewport); node reads go through `get_property_list` filtered to stored and script variables, with values serialized by explicit `typeof()` dispatch.

One workspace owns at most one session. `godot_stop` asks the bridge to quit, waits within `graceMs`, escalates to terminate, and reports the real exit code or signal. Disposal runs the same inverse and also removes the temporary scripts; the session registry publishes `godot.egoSessions` and its own inverse disposes every session when the plugin unloads.

## Host endpoints

When `webServer` is mounted, the plugin serves the watch panel under `/api/godot`:

| Endpoint | Method | What it does |
|---|---|---|
| `/api/godot/sessions` | GET | Lists `{ sessionId, state, pid, window, lostReason }`; never contacts the game. |
| `/api/godot/view?session=<id>` | GET | MJPEG stream of 640-wide JPEG frames every 200 ms, with backpressure skip. |
| `/api/godot/input` | POST | Forwards one `{ session, x, y, button?, double? }` click to the session. |

The web server has no auth layer of its own, so the endpoints guard themselves: a request must come from loopback and must not be cross-site (`Sec-Fetch-Site` / `Origin`), or it must carry the pinned `token` query parameter when a deployment configures one. The watch panel in [`ui-godot`](../ui-godot/README.md) is same-origin and needs no token.

## System boundary

The sandbox observes a real process, so some effects are **compensated, not undone**:

- **The game process is an emission.** It can be terminated but not un-launched; the tool reports the true exit facts and never pretends the process never existed.
- **Delivered images and logs cannot be recalled.** `godot_see` reports the frame number, and `godot_diff` compares against the bridge's previous frame; `godot_logs` reads incrementally from a cursor and does not rewrite history.
- **The engine writes `.godot/` import artifacts.** They belong to Godot, not to this package, and are not removed by disposal.
- **External prerequisites are environment, not effects.** The Godot binary, the project files, and the graphics driver are deployment facts; a missing or incompatible one fails the call with a structured code.
- **`allowEval: false` is not a security boundary.** It removes a misuse surface — the agent can still write a `.gd` file — so it lowers accidental damage, not intentional escape.

## Settings

The package does not register a settings namespace; the executable and caps are composition-level config.

## Config

Every key has a default; a deployment only overrides what its environment needs.

| Key | Default | Meaning |
|---|---|---|
| `executable` | `godot` | Godot executable path or PATH command name. |
| `executableArgs` | `[]` | Fixed argv elements inserted after the godot executable (deployment wrappers). |
| `allowEval` | `false` | Register `godot_eval` and allow engine `Expression` evaluation in the bridge. |
| `offscreen` | `false` | Start the window off-screen (`--position -32000,-32000`), for deployments where the user does not need to see it. |
| `maxFps` | `60` | Frame-rate cap passed as `--max-fps`; `0` leaves the engine default. |
| `fixedFps` | `0` | Deterministic pacing passed as `--fixed-fps`; when greater than `0` it replaces `--max-fps`. |
| `importTimeoutMs` | `120000` | Budget for the one-time import pass. |
| `timeoutMs` | `60000` | Cooperative tool-call budget enforced by the timeout policy through `exec.signal`. |
| `requestTimeoutMs` | `20000` | Budget for one bridge command, and for the handshake. |
| `graceMs` | `5000` | Terminate-escalation grace when stopping the game. |
| `maxNodes` | `200` | Scene-tree node budget rendered by `godot_state`; `0` disables the tree. |
| `maxProps` | `40` | Property-row budget for `godot_node`. |
| `maxWidth` | `1280` | Preview screenshot width in pixels; `0` disables downscaling. |

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `godot_play` | `path?`, `scene?`, `offscreen?`, `maxFps?`, `fixedFps?`, `restart?` | Start or reuse the workspace session; returns `{ sessionId, pid?, created, running: true }`. |
| `godot_stop` | — | Ask the game to quit, wait, escalate to termination; `{ stopped, sessionId?, exitCode?, signal? }`, and `stopped: false` when no session exists. |
| `godot_scene` | `path?` | Report the current scene, or switch with `change_scene_to_file`; `{ scene, changed, frames? }`. |
| `godot_status` | — | Host-side snapshot: `{ state, pid?, window?, lostReason?, projectRoot?, imported? }`; never contacts the game. |
| `godot_see` | `format?`, `quality?`, `maxWidth?`, `target?`, `region?`, `ifUnchanged?` | Capture a frame into the conversation; crop one Control or a region; skip an unchanged frame number on request. |
| `godot_state` | `tree?`, `targets?`, `maxNodes?`, `diff?` | Scene path, fps, frame, node count, pause flag, bounded tree, clickable Controls, and the changed-target list. |
| `godot_node` | `path`, `props?`, `maxProps?`, `depth?` | Stored and script properties of one node, with glob filters and a row budget. |
| `godot_find` | `name?`, `class?`, `text?` | Case-insensitive substring search over the Control list; every filter must match. |
| `godot_diff` | `useLuma?` | `{ mean, mean_squared, peak_snr, frame }` from the engine's frame comparison. |
| `godot_logs` | `since?`, `maxBytes?`, `stream?` | Incremental stdout/stderr capture with the next cursor. |
| `godot_actions` | — | `{ actions, count }`: the project's InputMap action names. |
| `godot_click` | `x?`/`y?` or `target?`, `button?`, `double?` | Click at coordinates or at a Control center; reports the node that consumed the event. |
| `godot_key` | `key?`, `action?`, `pressed?`, `modifiers?` | Tap or hold a key, or press/release an InputMap action. |
| `godot_type` | `text` | Type text into the focused control, one character at a time. |
| `godot_fill` | `target`, `text` | Replace an input's text: click it, select all, type the replacement, and verify the value. |
| `godot_check` | `target`, `checked?` | Set a checkbox/check button/radio to the desired state, clicking only when it differs. |
| `godot_hover` | `x`/`y` or `target` | Move the pointer without pressing, triggering hover states. |
| `godot_drag` | `from`, `to`, `steps?` | Press, move in steps, release — sliders, drag-and-drop, camera pans. |
| `godot_scroll` | `x`/`y` or `target`, `delta` | Wheel notches at a point or Control center; positive scrolls down. |
| `godot_wait` | `frames?`, `ms?` | Wait inside the game for frames (default 5) or wall-clock milliseconds. |
| `godot_wait_for` | `path?`, `property?`, `equals?`, `exists?`, `timeoutMs?`, `intervalMs?` | Poll until a state field or node property strictly equals the expected value, or until a node appears/disappears; timeout reports the last value. |

`godot_eval` (`expression`) registers only with `allowEval: true`.

## Errors

Failures carry the package-owned `EgoGodotError` (a `HarnessError` subclass), surfaced as `{ name, code }`:

| Code | Meaning |
|---|---|
| `GODOT_EGO_UNAVAILABLE` | The executable cannot run or the deployment is unusable. |
| `GODOT_EGO_NO_SESSION` | No session for this workspace; call `godot_play` first. |
| `GODOT_EGO_TIMEOUT` | Handshake, a bridge command, or `godot_wait_for` ran out of budget. |
| `GODOT_EGO_REJECTED` | The bridge or the tool rejected the request (unknown command, unreachable scene, missing node, not a res:// path). |
| `GODOT_EGO_NOT_IMPORTED` | The one-time import pass failed. |
| `GODOT_EGO_ABORTED` | The caller canceled the call, or the session was disposed mid-flight. |
| `GODOT_EGO_STALE_FRAME` | A requested frame is not newer than the frame already delivered. |
| `GODOT_EGO_LOST` | The game exited, disconnected, or broke the protocol; the session is unusable. |

## Testing

Run the unit suite from the monorepo root: `pnpm exec vitest run packages/godot/tool-godot-ego`. The real-machine smoke is opt-in through `DSH_TEST_GODOT` (the Godot executable path); it plays, observes, reads, operates, and stops the spike project in one chain.

## Model Experience

### System prompt

#### What the model sees

Every request in the plugin's registration scope carries this guidance. Hiding the tool schemas per agent does not remove the paragraph.

##### Godot visual sandbox guidance (tool:godot-ego)

```markdown
Godot visual sandbox: call godot_play to start the project, godot_see to look at the current frame (crop with target for detail), godot_state for the scene tree and clickable Control paths, godot_click / godot_key / godot_type / godot_fill / godot_check / godot_hover / godot_drag / godot_scroll to operate it, godot_wait or godot_wait_for before the next capture, godot_node for live property values, godot_find to locate a Control by name/class/text, godot_actions for InputMap action names, godot_scene to report or switch scenes, godot_diff to measure visual change, godot_status for the session, godot_logs for print and error output, and godot_stop when done. Prefer clicking by Control path: it is deterministic, while coordinates depend on the window scale.
```

#### Token effect

One fixed paragraph per request while the plugin scope is active; it names the twenty-one tools and the preferred click channel once, so the model does not need to rediscover them per turn.

#### KV Cache effect

Prefix-stable while the scope and the paragraph are unchanged. Activation, disposal, or editing the paragraph may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The generated schemas for the sandbox tools are the anchored section [godot tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-godot-ego) of the tool catalog. `godot_eval` is absent unless `allowEval` is on, and the frame tool is absent when `attachments`/`llm` are not mounted.

#### Token effect

Fixed schema cost on every request where the tools are visible; the twenty-one small schemas are cheaper than one dump-all schema.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Results

#### What the model sees

Text results, plus one image content block for `godot_see`. `godot_state` renders a header (`scene res://main.tscn · 60 fps · frame 128 · 12 nodes`), indented tree lines (`Main [Node2D] (1)`), and target lines (`Main/HUD/StartButton [Button] rect=(10,20,100,40) text="Start"`). `godot_node` renders `name = value` rows with a truncation note. `godot_find` renders `N of M Controls match` followed by the same target lines. `godot_fill` renders the verified text, and `godot_check` renders the resulting checked state with `(already)` or `(did not change)` when appropriate. `godot_diff` renders `mean 0.5 · mse 0.25 · psnr 32.5 dB · frame 42`. `godot_status` renders `session <id> · <state> · pid <n>`, then `window`, `project`, and `lost:` lines when present. `godot_logs` returns the captured text plus the next offset. `godot_wait_for` reports `state.frames = 42 after 120 ms`, `Main/Btn exists after 40 ms`, or a timeout that names the last observed value.

#### Token effect

Bounded by the configured budgets (`maxNodes`, `maxProps`, `maxWidth`) and by the tool-call budget; a cropped `godot_see` is smaller than a full frame.

#### KV Cache effect

Append-only; each result extends the request prefix and never rewrites earlier turns.

### Tool errors

#### What the model sees

Failed calls return `Error: <message>` with the structured `GODOT_EGO_*` code in metadata. The messages name the recovery step (for example, `call godot_play first` or `read godot_state for the available targets`).

#### Token effect

Only a failing call adds its message; successful calls are unaffected.

#### KV Cache effect

Append-only.

## Known Limitations and Deferred Work

- **Sub-windows are not in the captured frame** — the root viewport texture excludes `Window` children, so a popup or a second window is not visible to `godot_see`.
- **A minimized or fully occluded window may not render** — frames stay stale; `godot_see` reports the frame number and `godot_diff` compares against the previous captured frame.
- **Switching scenes does not replay boot logic** — `godot_scene` and `godot_play.scene` call `change_scene_to_file`, which is not equivalent to the project's own start-up path.
- **DPI and canvas transforms can shift coordinates** — click by Control path when possible; coordinates come from the reported rect and may differ under scaling.
- **One session per workspace** — a second `godot_play` reuses the running session unless `restart` is set.
- **A config reload disposes the game** — the plugin's fiber owns the session, so changing composition settings stops the running game.
- **Editor-only projects may need `--editor`** — projects whose scripts rely on `@tool` execution are not supported in game mode.
- **No audio capture and no recording/replay** — `AudioEffectCapture` and `--write-movie` are out of scope.
- **Headless hosts are rejected upfront** — the sandbox needs a renderer; a headless deployment gets a structured failure instead of a black frame.
- **Logs can be lossy under volume** — the subprocess capture keeps a bounded window; `godot_logs` marks a cursor that slid out of memory.
- **`godot_fill` relies on the select-all shortcut** — it clicks the field, sends Ctrl+A, types, and verifies; a custom input Control that ignores Ctrl+A reports the mismatch instead of replacing text (use `godot_click` + `godot_key` + `godot_type` there).
- **`godot_select` is not implemented** — choosing an option in an `OptionButton`/`PopupMenu` needs engine-side selection and a signal, which belongs to the deferred property-write phase.
- **No raw-command escape hatch** — unlike a browser CDP tool, the bridge exposes only its fixed command set; `godot_eval` (with `allowEval`) is the expression-level escape hatch.
