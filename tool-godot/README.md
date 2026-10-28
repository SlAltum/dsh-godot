---
description: "Headless Godot project tools for a model: validate scripts, run a scene, format GDScript, inspect project files, and run an editor script."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-godot

English | [中文](README.zh.md)

The **model-facing Godot project tools** — `godot_validate`, `godot_run_scene`, `godot_format`, `godot_inspect`, `godot_editor_script` — are backed by the **host-installed godot and gdformat executables** spawned through the `ctx.subprocess` seam with plain argv vectors (no shell layer, so no quoting applies). Unlike the packaged-ripgrep search suite, no binary ships inside the package: registration is unconditional, and a missing executable surfaces as the structured `GODOT_UNAVAILABLE` / `GODOT_FORMAT_UNAVAILABLE` error at call time, never at load time. The package injects `tools`, `systemPrompt`, and `subprocess` — deliberately **not** `fs`; only `godot_inspect` (pure parsing of Godot's text formats) and `godot_format` (a temporary copy, never the user's file) touch the filesystem, through plain `node:fs`.

Source entry: [`src/index.ts`](src/index.ts) — plugin registration, configuration, and the `godot` settings namespace.

```ts ignore-check
// A deployment points at its godot install; the defaults resolve `godot` and
// `gdformat` on PATH.
await ctx.plugin(LocalSubprocessRuntime)                       // @deepseek-ai/dsh-subprocess-local
await ctx.plugin(ToolGodot, { executable: 'C:\\Godot\\godot.exe' })
```

Why spawn-backed: Godot validation and headless running are naturally CLI workflows, and there is no stable in-process Godot API for a harness to bind. The subprocess seam owns spawn execution, process-tree termination, environment scrubbing, and bounded output capture; this package owns schemas, argument validation, argv construction, diagnostics parsing, retention, and timeout declaration. The tools never expose a background job — the call returns only after the process exits, is terminated by the cooperative timeout, is aborted, or fails.

## Summary

Hand the model a Godot project and it can check that scripts and scenes load, run a scene headless and read its output, format a `.gd` file and get the text back, parse `project.godot`/`.tscn`/`.tres` structure, and run a `res://` editor script. Every call spawns the host `godot` (and `gdformat` for the default formatter) through the subprocess seam, so no binary ships with the package and nothing runs until a tool is called. A missing executable returns a structured `GODOT_UNAVAILABLE` error instead of failing at load.

## Table of Contents

- [Deployment requirement: host godot and (optionally) gdformat](#deployment-requirement-host-godot-and-optionally-gdformat)
- [Settings](#settings)
- [Config](#config)
- [Tools](#tools)
- [Execution design](#execution-design)
- [Errors](#errors)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="deployment-requirement-host-godot-and-optionally-gdformat"></a>
## Deployment requirement: host godot and (optionally) gdformat

The tools require a godot executable (any 4.x build; `--headless` must be supported). `godot_format` runs `gdformat` from [gdtoolkit](https://github.com/Scony/godot-gdscript-toolkit) by default, or the **builtin backend** (`formatBackend: 'builtin'`) — an embedded TextMate-based formatter migrated from godot-vscode-plugin that needs no Python. Both resolve through the `executable`/`gdformatExecutable` config, which may be a full path or a PATH command name. Returned paths are displayed relative to the resolved workdir (the calling agent's session cwd when present, else `process.cwd()`) and are follow-up-readable with `read` only when that workdir and the filesystem root are the same workspace — the same co-location requirement the search suite documents.

<a id="settings"></a>
## Settings

The package registers the `godot` settings namespace (`GODOT_SETTINGS_NAMESPACE`), which the Web UI's plugin configuration section exposes as the Godot card. `executable` and `gdformatExecutable` are editable there; a saved value applies to the **next tool call** — the authoritative config (settings section over the composition entry) is re-read on every execute, so no reload is needed. Clearing a field re-inherits the composition entry. The live executable and wrapper args are also published as the `godot.toolchain` service; the visual sandbox reads them when its own `executable` is empty, so the card remains the single place to configure the path. The remaining caps stay composition-level by design: the timeout declaration on a registered tool cannot be re-read per call.

<a id="config"></a>
## Config

Every key has a default; a deployment only overrides what its environment needs.

| Key | Default | Meaning |
|---|---|---|
| `executable` | `godot` | godot executable path or PATH command name. |
| `executableArgs` | `[]` | Fixed argv elements inserted after the godot executable (deployment wrappers). |
| `gdformatExecutable` | `gdformat` | gdformat executable path or PATH command name (used when `formatBackend` is `gdformat`). |
| `gdformatArgs` | `[]` | Fixed argv elements inserted after the gdformat executable. |
| `formatBackend` | `gdformat` | `godot_format` backend: `gdformat` (gdtoolkit) or `builtin` (embedded TextMate formatter, no Python). |
| `builtinMaxEmptyLines` | `2` | Builtin backend: max consecutive blank lines inside the file. |
| `builtinDenseFunctionParameters` | `false` | Builtin backend: remove extra space inside function parameter lists. |
| `builtinSpacesBeforeEndOfLineComment` | `'1'` | Builtin backend: spaces before an end-of-line comment (`'1'` or `'2'`). |
| `stdoutMaxBytes` | `1048576` | Max bytes retained for one run's stdout; a lossy read marks the result `stdoutTruncated`. |
| `stderrMaxBytes` | `262144` | Max bytes retained for one run's stderr; a lossy read marks the result `stderrTruncated`. |
| `validateMaxErrors` | `200` | Max issues one `godot_validate` result retains inline; more issues set `issuesTruncated`. |
| `graceMs` | `5000` | Positive terminate-escalation grace the subprocess seam grants before an aborted run settles; cannot exceed [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md). |
| `timeoutMs` | `60000` | Cooperative tool-call budget on all five tools, enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` through `exec.signal`. First-run project validation boots the headless editor and imports assets; large projects may need a larger budget. |

<a id="tools"></a>
## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `godot_validate` | `path?`, `mode?` (`project` default, `file`, `scene`) | `project` runs `godot --headless --editor --path <root> --quit` (imports assets and surfaces scene/resource errors) and then a generated `SceneTree` sweep that loads every `.gd` under `res://`, so script parse errors are caught too; `file` runs `godot --headless --check-only --script <file> --path <root>`. Parses `ERROR:` / `SCRIPT ERROR:` / `WARNING:` lines with their `at:` locations (either `<path>:<line>[:<column>]` or `<function> (<path>:<line>[:<column>])`) into structured issues (`res://` paths displayed project-relative). `ok` is false on any error-kind issue or a non-zero/killed exit; a failed run that produced no issue carries its engine output tail as `diagnostics`. `scene` starts no engine at all: it reads a `.tscn` (or every `.tscn` under a directory, capped at 200 files) and reports structural mistakes, which include a Control laid out with anchors/offsets inside a Container (containers position their children, so the file looks right and the screen does not), container layout under a non-container parent, a `parent=` naming a missing node, a duplicate node path, a missing `ext_resource`, and a `[connection]` calling a method the target script does not declare. |
| `godot_run_scene` | `scene`, `path?`, `frames?`, `args?`, `timeoutMs?` | Runs `godot --headless --path <root> [--quit-after <frames>] <scene> [-- <args>]` and returns the captured output. A non-zero exit or signal kill is a domain outcome (`ok: false`), not an error. The run has its own budget (`runSceneTimeoutMs`, default 300,000 ms, `timeoutMs` per call): when it expires the process is terminated and the output produced so far is returned with `timedOut: true`. The tool-call guard sits deliberately above that budget, because it replaces the whole result and discards the output a long test scene already printed. |
| `godot_format` | `file` | Formats a `.gd` file and returns `{ file, formatted, original, changed }`; it never writes the user's file, so the model applies the change with `write`/`edit` and file policy. The `gdformat` backend formats a **temporary copy** (a gdformat rejection of the file's syntax is `GODOT_PARSE_ERROR`; a formatter crash or missing module is `GODOT_FORMAT_UNAVAILABLE`); the `builtin` backend formats in-process and needs no Python. |
| `godot_inspect` | `path` | Pure file parsing of Godot's text formats: a project root yields name/main scene/autoloads/sections; a `.tscn` yields format/uid/ext_resources/nodes; a `.tres` yields sections/ext_resources. No godot subprocess runs. |
| `godot_editor_script` | `script` (`res://`), `path?`, `args?` | Writes a generated `SceneTree` bootstrap outside the project and runs `godot --headless --editor --path <root> --script <bootstrap> [-- <args>]`; the bootstrap loads the `res://` EditorScript, instantiates it under the editor, and calls its `_run()`. Godot's `--script` accepts only `SceneTree`/`MainLoop` scripts, which is why the EditorScript cannot be passed directly. Returns stdout and stderr, with stdout parsed as JSON when the script printed JSON. The escape hatch for project-specific checks that need editor access; the script is project code with full editor access (the user's own trust boundary). A non-zero exit is a domain outcome. |

<a id="execution-design"></a>
## Execution design

Every run is an ordinary foreground spawn through `ctx.subprocess` with the session cwd as the working directory and `exec.signal` forwarded, so the cooperative timeout and caller cancellation terminate the process tree. Captured output is bounded by `stdoutMaxBytes`/`stderrMaxBytes`; truncation is reported in the result (never silently dropped from the model's view). Exit semantics are tool-owned: non-zero exits and signal kills are domain outcomes with `ok: false` — the only typed failures are launch/infrastructure failures (`GODOT_UNAVAILABLE`, `GODOT_FORMAT_UNAVAILABLE`), unreadable/unparseable inputs (`GODOT_PARSE_ERROR`), and cancellation (`GODOT_ABORTED`). Headless godot runs write `.godot/` import artifacts; that is expected Godot behavior, stated in the system-prompt guidance. The generated bootstrap scripts of `godot_validate` project mode and `godot_editor_script` are written to the OS temp directory, never into the user's project.

<a id="errors"></a>
## Errors

Failures carry the package-owned `GodotError` (a `HarnessError` subclass), surfaced as `{ name, code }` on `isError` results: `GODOT_UNAVAILABLE` (the godot/gdformat executable could not be resolved or launched, or produced no collected output), `GODOT_FORMAT_UNAVAILABLE` (the gdformat invocation itself failed — traceback, missing module), `GODOT_PARSE_ERROR` (unreadable/missing/unsupported project, scene, or resource input, or gdformat rejecting the file's syntax), and `GODOT_ABORTED` (cooperative tool timeout or caller cancellation). Model argument mistakes (blank paths, a non-`res://` script, a non-positive `frames`) stay ordinary tool argument errors.

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the independently registered godot guidance below. Agent-scoped tool restrictions can hide the schemas without removing the prompt section.

##### Godot guidance (tool:godot)

```markdown
Use godot_validate after editing GDScript to get structured parse errors, godot_run_scene to execute a scene headless and capture its output, godot_format to format a script with gdformat (returns the formatted text; apply it with write/edit), godot_inspect to read project/scene/resource structure, and godot_editor_script to run a res:// EditorScript in the project. Headless godot runs write the .godot cache and import artifacts.
```

#### Token effect

Fixed guidance cost per request while the tools are registered.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation, disposal, or editing the text may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The generated [`godot_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-godot) describe each tool's arguments and canonical output; the tools are registered unconditionally, so a missing host executable never changes the schemas.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

`godot_validate` returns a pass/fail head plus one `path:line:column [error|warning] message` line per retained issue, with truncation notes; its result card carries the issue list with editor-jump locations. `godot_run_scene` and `godot_editor_script` return the captured output with an exit head. `godot_format` returns the formatted text and flags `changed`, and its result card renders the before/after diff (metadata capped at 64 KiB per side). `godot_inspect` returns a per-kind structured summary.

#### Token effect

Inline issues are bounded by `validateMaxErrors`; captured output is bounded by the stdout/stderr byte budgets; the retained result stays in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Failures are normalized as `Error: <message>` with structured `GODOT_UNAVAILABLE`, `GODOT_FORMAT_UNAVAILABLE`, `GODOT_PARSE_ERROR`, or `GODOT_ABORTED` metadata for callers.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **godot is a host install; gdformat only for the default backend** — no binary ships with the package; a missing executable fails calls at call time (`GODOT_UNAVAILABLE` / `GODOT_FORMAT_UNAVAILABLE`), never at load time. The `builtin` `godot_format` backend (`formatBackend: 'builtin'`) needs neither gdformat nor Python — only the embedded TextMate grammar and the `vscode-oniguruma` WASM from its own dependencies.
- **The builtin formatter follows godot-vscode-plugin rules, not gdformat's** — its whitespace decisions (parameter lists, blank-line caps, comment spacing) are pinned by the migrated snapshot suite; switching backends changes output for the same file. `gdformat` remains the default for gdtoolkit parity.
- **godot_format is read-only by design** — it returns text; the model must apply changes with `write`/`edit` so file policy applies. A very large file's diff-card metadata is capped at 64 KiB per side (the canonical result still carries the full text).
- **Project-mode validation runs the engine twice** — the editor import pass boots the headless editor (the first-run asset import is the slow part) and the GDScript sweep boots it again, so the default 60 s cooperative timeout may need raising for large projects (config `timeoutMs`). The sweep drops godot's own `leaked at exit` teardown chatter, which the `--script` exit path prints even for a clean project.
- **godot_editor_script runs project code** — the script executes with full editor access inside the user's project; it is the user's own trust boundary, stated in the tool description.
- **Headless runs write the project cache** — validate/run/editor_script write `.godot/` import artifacts; expected Godot behavior, stated in the system-prompt guidance.
- **Godot 4.4+ built-in formatter has no stable CLI** — the `gdformat` backend relies on gdtoolkit; the builtin backend embeds the godot-vscode-plugin formatter instead. The editor's built-in formatter is out of scope.
- **Semantic navigation lives in `lsp-godot`** — the DSH `ctx.lsp` seam's four navigation operations against Godot's TCP language server are provided by the sibling [`lsp-godot`](../lsp-godot/README.md) package (attach to a running editor or spawn a headless one); this package covers the headless CLI workflows only.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tools are spawn-backed because Godot exposes no stable in-process API: the subprocess seam owns argv execution, process-tree termination, environment scrubbing, and bounded output, while this package owns schemas, argv construction, diagnostics parsing, and retention. Add a tool by declaring its schema and argv builder beside the existing ones; the tool catalog is generated, so never hand-edit `docs/tool-catalog.md`.

</details>
