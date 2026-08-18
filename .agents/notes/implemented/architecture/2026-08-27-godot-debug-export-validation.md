# Agent Note: Godot exported-build breakpoint validation (dsh-tool-godot-debug)

Status: implemented

English | [中文](2026-08-27-godot-debug-export-validation.zh.md)

## Problem

The README's Known Limitations claimed exported release builds "may not deliver stops" — an unverified, probabilistic-sounding statement. The task (roadmap R7/T12) was shelved in 2026-08 because no export templates were installed; the user then changed the ruling and asked for an automated validation using whatever the machine had.

## Decision

Reference check first: godot-vscode-plugin has NO export-specific code — exported games are debugged exactly like attach (the game dials the debug server via `--remote-debug`, breakpoints go over the remote protocol). So T12 validates GODOT TEMPLATE behavior, not plugin code. The machine has 4.5.1.mono export templates (no 4.7 — template behavior is a build-time property stable across 4.x, so the facts generalize). A probe (`.context/t12/run-t12.mjs`) exports the t3 project copy with both templates (headless `--export-debug`/`--export-release`, Windows Desktop preset, embed_pck) and attaches to each exported game with the standard protocol: bind → spawn game with `--remote-debug` → set_pid → dynamic breakpoint → expect debug_enter.

## Facts (Godot 4.5.1 mono, `.context/t12/facts.md`)

- **Debug template: full remote debugger** — the exported game dials, answers set_pid, and the dynamic breakpoint delivers a stop (`res://player.gd:10 @ run`; stack format matches 4.7).
- **Release template: connection layer only** — the game STILL dials and answers set_pid (~1.1 s), but the breakpoint command never triggers a stop (8 s window plus natural exit; only output/error/profile heartbeats follow). The GDScript breakpoint engine is compiled out; the connection stack survives. Deterministic, not probabilistic.
- **Console wrapper is debug-only** — `debug/export_console_wrapper` yields `<name>.console.exe` for the debug template only; the release exe is GUI-subsystem (stdout/stderr not capturable). Export itself needs the REAL APPDATA (a redirected APPDATA cannot locate templates).
- **Baseline**: both exported packages run cleanly (exit 0; debug console exe prints the full game output).

## Consequences

- README Known Limitation rewritten: debug-template exports keep breakpoints; release-template exports never stop (connection layer only), pinned with the facts file. The user's original self-packaging validation path stays valid as a supplement (debug template + `--remote-debug`).
- Leftover: 4.7 templates were not downloaded (generalization is by template-behavior stability); CLI `--breakpoints` on exported games was not probed (the dynamic-breakpoint attach form is the product's recommended path for exported games).
