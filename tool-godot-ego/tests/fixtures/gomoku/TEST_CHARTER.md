# Gomoku Sandbox Test Charter

This charter defines two uses of the embedded Gomoku fixture: a fast agent self-test, and a shared interactive session where the agent opens the native Godot window, plays Black first, and answers the user's moves.

## Fixture and vocabulary

- Project: `packages/godot/tool-godot-ego/tests/fixtures/gomoku`
- Window: 1280 × 720, ordinary Godot native window
- Board: 15 × 15, columns A–O left to right, rows 1–15 top to bottom
- Cell name: `Cell_<row>_<col>`, zero-based; for example H8 is `Cell_07_07` and L8 is `Cell_07_11`
- Black is `1`, White is `2`, empty is `0`
- Every intersection is a named Button; `New game` sits in the actions row above the board

## Preconditions

1. `tool-godot-ego` and `ui-godot` are mounted, and `dsh web` was restarted after installation.
2. The `tool-godot` settings card points at a Godot 4.7 executable, or `godot` is on `PATH`.
3. The native window must be visible. Do not pass `offscreen: true` for this charter.
4. The Web watch panel is optional; this charter uses the native window.

## Part A: agent self-test (smoke)

The goal is coverage of the fixture, not strong play. Each step is a pass/fail check.

### A1 — launch

```text
godot_play(path: packages/godot/tool-godot-ego/tests/fixtures/gomoku)
godot_status
godot_see
```

Pass: a session is running, `godot_status` reports `ready` and a window, and `godot_see` shows the wooden board with the status line.

### A2 — inspect the board

```text
godot_state
godot_find(name: "Cell_07_07")
godot_find(name: "NewGame")
```

Pass: the tree includes `BoardView` and `BoardHits`, `godot_find` returns the H8 cell path under `Main/BoardHits`, and `NewGame` is discoverable before the 200-target list is exhausted.

### A3 — Black's first move

```text
godot_click(target: Main/BoardHits/Cell_07_07)
godot_node(path: /root/Main/StatusName, props: ["text"])
godot_node(path: /root/Main/StatusAccent, props: ["text"])
godot_node(path: /root/Main, props: ["_moves", "_last"])
```

Pass: `StatusName` is `White`, `StatusAccent` is `to move`, `_moves` is `1`, and `_last` is `[7, 7]`. `godot_click` may print `no node consumed` even when the move lands; judge by the state, not that message.

### A4 — White's reply

```text
godot_click(target: Main/BoardHits/Cell_07_08)
godot_node(path: /root/Main/StatusName, props: ["text"])
godot_node(path: /root/Main/StatusAccent, props: ["text"])
```

Pass: `StatusName` returns to `Black` and `StatusAccent` reads `to move`; `_moves` is `2`.

### A5 — occupied intersection

Click `Cell_07_07` again. Pass: `_moves` stays at `2`, the status does not change, and no error is raised.

### A6 — win

Start from a fresh board with `New game`, then play this fixed sequence:

| Move | Side | Cell | Coordinate |
|---|---|---|---|
| 1 | Black | `Cell_07_07` | H8 |
| 2 | White | `Cell_05_05` | F6 |
| 3 | Black | `Cell_07_08` | I8 |
| 4 | White | `Cell_05_06` | G6 |
| 5 | Black | `Cell_07_09` | J8 |
| 6 | White | `Cell_05_07` | H6 |
| 7 | Black | `Cell_07_10` | K8 |
| 8 | White | `Cell_05_08` | I6 |
| 9 | Black | `Cell_07_11` | L8 |

Pass: `StatusName` is `Black`, `StatusAccent` is `wins`, `/root/Main` reports `_moves = 9` and `_finished = true`, and `godot_see` shows five Black stones in a row with a vermilion last-move ring.

### A7 — reset

```text
godot_click(target: Main/NewGame)
godot_node(path: /root/Main, props: ["_moves", "_current", "_finished"])
```

Pass: `StatusName` is `Black`, `StatusAccent` is `to move`, `_moves = 0`, `_current = 1`, `_finished = false`, and the board is empty.

### A8 — logs and stop

```text
godot_logs
godot_stop
```

Pass: no script or engine errors, and the session stops cleanly.

### Automated version

```bash
DSH_TEST_GODOT='D:\软件\godot\Godot_v4.7.2-stable_win64\Godot_v4.7.2-stable_win64.exe' \
  pnpm exec vitest run packages/godot/tool-godot-ego/tests/smoke.gomoku.spec.ts
```

The spec covers launch, find, the nine-move win, status, and reset.

## Part B: interaction with the user

The agent opens the native scene, plays Black first, and then answers the user's White moves. The native window is the shared table; the Web watch panel is not the interaction surface.

### Roles and opening

- Agent: Black, opens at H8 (`Cell_07_07`).
- User: White, clicks directly in the native Godot window.
- Agent announces the opening before the user moves: `Black H8; your move as White.`

### Turn protocol

1. Agent calls `godot_play` and confirms `godot_status` is `ready`.
2. Agent clicks `Cell_07_07` and announces `Black H8`.
3. Agent asks the user to play. The agent must not click while `StatusName` is `White` and `StatusAccent` is `to move`.
4. The user clicks a cell in the native window and tells the agent the move is complete.
5. Agent reads the state:

   ```text
   godot_node(path: /root/Main, props: ["_board", "_moves", "_current", "_finished"], depth: 3)
   godot_node(path: /root/Main/StatusName, props: ["text"])
   godot_node(path: /root/Main/StatusAccent, props: ["text"])
   ```

6. If `_current` is not `1` (Black), the user's turn is still open; wait, do not click.
7. If `_current` is `1` and `_finished` is false, choose one empty cell, click it by its full `Cell_<row>_<col>` path, verify `StatusName` becomes `White` with `StatusAccent` `to move`, and announce the coordinate.
8. Repeat from step 3 until the status reports a win or draw.

The agent may instead wait for `StatusName` to become `Black` with `godot_wait_for` on `/root/Main/StatusName`, but asking the user to say the move is complete is preferred for a conversational test.

### Move choice

This is a fixture test, not an engine benchmark. Use a deterministic, explainable policy:

1. If Black has an immediate five, play it.
2. Else if White has an immediate five, block it.
3. Else extend Black's longest line, preferring the center.
4. Never overwrite an occupied cell; never play outside A–O / 1–15.

Announce every agent move as a coordinate before or immediately after the click. Do not take two moves in a row.

### Reading the board

`_board` is 15 arrays of 15 integers: `0` empty, `1` Black, `2` White. `_moves`, `_current`, and `_finished` are the other facts. Use `depth: 3` so the nested rows are visible.

### Ending

- On a win or draw, announce the result and the final move.
- Ask whether the user wants `New game`; click `Main/NewGame` only after agreement.
- Call `godot_stop` only when the user asks to end the session or when the test run is finished.
- Leave the native window open while the user is still playing.

## Pass criteria

Part A passes when A1–A8 all pass and `godot_logs` is clean. Part B passes when the agent opens, the user completes at least one White move, the agent replies to it with a legal clicked cell, and both sides see the same status after each turn. A full game is not required.

## Failure handling

| Symptom | Check |
|---|---|
| `godot_play` fails | Godot path in the `tool-godot` settings card; no `offscreen: true` |
| No native window | Restart `dsh web` after the subprocess change; `godot_status` window |
| Click has no visible effect | Check `Main/Margin/.../Cell_xx_yy` path and `godot_node`; ignore the `no node consumed` message alone |
| Status disagrees with the board | Read `_board`, `_moves`, `_current` from `/root/Main` |
| Reset is missing from targets | `NewGame` precedes the 225 cells in the target list; use `godot_find(name: "NewGame")` |
| User and agent click together | Stop clicking; read the board; resume from the observed state |

## Non-goals

No Gomoku AI strength, no network play, no Godot editor workflow, and no Web-only scene window. The fixture tests the sandbox's launch, observation, input, and reset loop through a real native scene.
