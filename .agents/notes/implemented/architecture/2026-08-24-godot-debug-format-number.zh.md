# Agent Note：Godot 调试数字渲染精度（dsh-tool-godot-debug）

状态：implemented

[English](2026-08-24-godot-debug-format-number.md) | 中文

## Problem

两条显示路径丢失浮点精度：`snapshot.ts renderValue` 用 `toFixed(5)`（`0.1234567` → `0.12346`），math 类型的 `stringify_value` 沿用源插件的 `toFixed(1)` UI 四舍五入（`0.123456` → `0.1`）——调试器把 0.123456 坐标显示成 `0.1` 具有误导性。

## Decision

用**有效数字**替代固定小数位（无协议变更、无新增包）：

- `variants.ts` 导出 `formatNumber(value, maxSignificantDigits = 7)`：整数直出（`String(value)`）；非整数经 `toPrecision(7)` + `parseFloat` 保留最多 7 位有效数字（去尾零）。
- `clean_number`（math 类型）改为薄封装；`renderValue` 的 number 分支直接调 `formatNumber`。
- 7 位有效数字可无损往返任何 float32；float32 线伪影（`0.10000000149011612`——0.1 按 float32 解码的结果）自然归一为 `0.1`。超大/极小值落到 JS 指数形式（`1e+21`、`1e-7`）。
- 显示长度仍受 `maxValueLength` 约束（不变）；7 位数字远不会触及它。

## Design notes

- `formatNumber` 放在 `variants.ts`——`snapshot.ts` 已依赖它（方向安全）；9 处 math 类型 `stringify_value` 调用点不变（它们调 `clean_number`）。
- 整数快速路径同时覆盖 `-0`（`String(-0)` 为 `"0"`）与 `Number.isInteger` 为真的超 `MAX_SAFE_INTEGER` 整数（正常字符串化，直到 1e21 才指数化——可接受）。
- 7 位上限截断 float64 高精度（`0.123456789012345` → `0.1234568`）——调试显示的有意平衡；完整精度需要 config 旋钮（未做）。

## Testing

- `formatNumber` 单测：整数直出（含大数）、7 位有效数字截断 + 尾零去除、float32 伪影归一、负值、指数回落。
- `renderValue` math 类型测试：`Vector2(0.123456, 2.5)` 带精度渲染（原为 `Vector2(0.1, 2.5)`）。
- snapshot 断言更新（`0.1234567` 保持；原 `0.12346`）；real-composition 快照重录——`_delta = 0.00694` → `0.006944444`（1/144）、`0.06667` → `0.06666667`（1/15），可见的精度收益。
- 全套全绿（141 测试 + 真机冒烟）；整数重断言（`counter = 1`、`Vector2(10, 20)`）不变。

## Consequences

- 调试报告的所有数字显示现在带有效精度；Known Limitations 不再声称沿用源插件 `toFixed(1)`。
- `formatNumber` 已导出可复用（如未来场景树/展开值的格式化）。
