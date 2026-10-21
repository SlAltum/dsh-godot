# 五子棋沙盒测试章程

本章程定义内嵌五子棋用例的两种用法：一是 agent 快速自测；二是 agent 启动原生 Godot 场景，先执黑落子，再与用户轮流对弈。

## 工程与坐标

- 工程：`packages/godot/tool-godot-ego/tests/fixtures/gomoku`
- 窗口：1280 × 720 的普通 Godot 原生窗口
- 棋盘：15 × 15；列 A–O 从左到右，行 1–15 从上到下
- 格子名：`Cell_<行>_<列>`，行列都从 0 开始；例如 H8 是 `Cell_07_07`，L8 是 `Cell_07_11`
- 黑棋为 `1`，白棋为 `2`，空位为 `0`
- 每个交叉点都是一个具名 Button；`New game` 位于棋盘上方的操作行

## 前置条件

1. `tool-godot-ego` 与 `ui-godot` 已挂载，安装后已重启 `dsh web`。
2. `tool-godot` 设置卡里的 Godot 路径指向 Godot 4.7，或 `godot` 在 `PATH` 上。
3. 必须使用可见的原生窗口；不要在 `godot_play` 里传 `offscreen: true`。
4. Web 观察窗是可选的；本章程以原生窗口为交互面。

## A 部分：agent 自测（冒烟）

目标是覆盖用例功能，不追求棋力。每步都按通过／失败判断。

### A1 — 启动

```text
godot_play(path: packages/godot/tool-godot-ego/tests/fixtures/gomoku)
godot_status
godot_see
```

通过：会话运行中，`godot_status` 为 `ready` 且有窗口；`godot_see` 能看到木纹棋盘与状态行。

### A2 — 检查棋盘

```text
godot_state
godot_find(name: "Cell_07_07")
godot_find(name: "NewGame")
```

通过：场景树包含 `BoardView` 与 `BoardHits`；`godot_find` 返回 `Main/BoardHits` 下的 H8 路径；在 200 个目标耗尽之前能找到 `NewGame`。

### A3 — 黑棋第一手

```text
godot_click(target: Main/BoardHits/Cell_07_07)
godot_node(path: /root/Main/StatusName, props: ["text"])
godot_node(path: /root/Main/StatusAccent, props: ["text"])
godot_node(path: /root/Main, props: ["_moves", "_last"])
```

通过：`StatusName` 为 `White`，`StatusAccent` 为 `to move`，`_moves` 为 `1`，`_last` 为 `[7, 7]`。`godot_click` 可能仍打印 `no node consumed`，但落子成功；以状态为准，不看这条消息。

### A4 — 白棋回应

```text
godot_click(target: Main/BoardHits/Cell_07_08)
godot_node(path: /root/Main/StatusName, props: ["text"])
godot_node(path: /root/Main/StatusAccent, props: ["text"])
```

通过：`StatusName` 回到 `Black`，`StatusAccent` 为 `to move`；`_moves` 为 `2`。

### A5 — 已占用的交叉点

再次点击 `Cell_07_07`。通过：`_moves` 仍为 `2`，状态不变，也不报错。

### A6 — 胜负

先用 `New game` 重置，再按固定顺序落子：

| 手数 | 一方 | 格子 | 坐标 |
|---|---|---|---|
| 1 | 黑 | `Cell_07_07` | H8 |
| 2 | 白 | `Cell_05_05` | F6 |
| 3 | 黑 | `Cell_07_08` | I8 |
| 4 | 白 | `Cell_05_06` | G6 |
| 5 | 黑 | `Cell_07_09` | J8 |
| 6 | 白 | `Cell_05_07` | H6 |
| 7 | 黑 | `Cell_07_10` | K8 |
| 8 | 白 | `Cell_05_08` | I6 |
| 9 | 黑 | `Cell_07_11` | L8 |

通过：`StatusName` 为 `Black`，`StatusAccent` 为 `wins`，`/root/Main` 的 `_moves = 9`、`_finished = true`，`godot_see` 显示五枚黑子连成一行，最后一手带朱红环。

### A7 — 重置

```text
godot_click(target: Main/NewGame)
godot_node(path: /root/Main, props: ["_moves", "_current", "_finished"])
```

通过：`StatusName` 为 `Black`，`StatusAccent` 为 `to move`，`_moves = 0`，`_current = 1`，`_finished = false`，棋盘为空。

### A8 — 日志与停止

```text
godot_logs
godot_stop
```

通过：没有脚本或引擎错误，会话正常停止。

### 自动化版本

```bash
DSH_TEST_GODOT='D:\软件\godot\Godot_v4.7.2-stable_win64\Godot_v4.7.2-stable_win64.exe' \
  pnpm exec vitest run packages/godot/tool-godot-ego/tests/smoke.gomoku.spec.ts
```

该 spec 覆盖启动、查找、九手连五、状态与重置。

## B 部分：与用户对弈

agent 打开原生场景，先执黑，然后回应用户的白棋。原生窗口是共享的棋盘；Web 观察窗不是交互面。

### 角色与开局

- agent：黑棋，开局落在 H8（`Cell_07_07`）。
- 用户：白棋，直接在原生 Godot 窗口里点击落子。
- agent 在用户落子前先说明开局：`黑棋 H8；轮到你执白。`

### 回合协议

1. agent 调 `godot_play`，确认 `godot_status` 为 `ready`。
2. agent 点击 `Cell_07_07`，宣布 `黑棋 H8`。
3. agent 请用户落子。`StatusName` 为 `White` 且 `StatusAccent` 为 `to move` 期间，agent 不得点击棋盘。
4. 用户在原生窗口点击，并告诉 agent 已落子。
5. agent 读取状态：

   ```text
   godot_node(path: /root/Main, props: ["_board", "_moves", "_current", "_finished"], depth: 3)
   godot_node(path: /root/Main/StatusName, props: ["text"])
   godot_node(path: /root/Main/StatusAccent, props: ["text"])
   ```

6. 如果 `_current` 不是 `1`（黑棋），说明仍是用户回合；继续等待，不点击。
7. 如果 `_current` 是 `1` 且 `_finished` 为 false，选一个空位，按完整 `Cell_<行>_<列>` 路径点击，确认 `StatusName` 变为 `White`、`StatusAccent` 为 `to move`，再宣布坐标。
8. 回到第 3 步，直到状态显示胜负或和棋。

也可以不追问用户，改用 `godot_wait_for` 等待 `/root/Main/StatusName` 变为 `Black`；但对弈测试更推荐让用户明确说“已落子”，避免误判。

### 选点策略

这是沙盒用例测试，不是棋力评测。使用可解释的固定策略：

1. 黑棋能立刻连五，就走连五点。
2. 否则白棋能立刻连五，就堵住。
3. 否则延伸黑棋最长的一条线，优先靠近中心。
4. 不覆盖已有棋子，不落在 A–O / 1–15 之外。

agent 每次落子都要先或立刻宣布坐标，不得连走两手。

### 读取棋盘

`_board` 是 15 个长度为 15 的整数数组：`0` 空、`1` 黑、`2` 白。`_moves`、`_current`、`_finished` 是其余事实。读取时用 `depth: 3` 才能看到嵌套行。

### 结束

- 出现胜负或和棋时，宣布结果与最后一手。
- 询问用户是否要 `New game`；得到同意后再点 `Main/NewGame`。
- 只有用户要求结束，或本次测试跑完，才调用 `godot_stop`。
- 用户还在下棋时，保持原生窗口打开。

## 通过标准

A 部分 A1–A8 全部通过，且 `godot_logs` 干净。B 部分 agent 完成开局，用户至少完成一次白棋落子，agent 合法回点一次，并且双方在每个回合后看到同一状态。不要求下完整盘。

## 失败处理

| 现象 | 检查 |
|---|---|
| `godot_play` 失败 | `tool-godot` 设置卡里的 Godot 路径；不要传 `offscreen: true` |
| 没有原生窗口 | subprocess 改动后重启 `dsh web`；查 `godot_status` 的 window |
| 点击没有反应 | 检查 `Main/Margin/.../Cell_xx_yy` 路径与 `godot_node`；不要只看 `no node consumed` |
| 状态与棋盘不一致 | 从 `/root/Main` 读 `_board`、`_moves`、`_current` |
| 目标列表里找不到 NewGame | `NewGame` 排在 225 个格子之前；用 `godot_find(name: "NewGame")` |
| 用户与 agent 同时点击 | 立即停止点击，读棋盘，从实际状态继续 |

## 非目标

不测五子棋 AI 强度，不测网络对弈，不走 Godot 编辑器流程，也不做纯 Web 场景窗口。本用例测的是沙盒对真实原生场景的启动、观察、输入与重置闭环。
