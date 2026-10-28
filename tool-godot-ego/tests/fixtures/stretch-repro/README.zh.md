# stretch-repro 夹具

[English](README.md) | 中文

可视化沙盒从未在此几何下运行过：**1440×900 画布**，使用 `canvas_items` 拉伸模式，被渲染进启动器强制设定的 **1280×720** 窗口（`--resolution` 在 `play.ts` 中硬编码）。实测：

```
window 1280 × 720 · canvas 1440 × 900 · image 1152 × 720 · scale 0.8 · screen origin x=64
```

沙盒假设的坐标恒等式（`canvas == screen == image`）在这里全部失效，因此它成为 2026-10-27 反馈的基线。

## 协议

夹具本身就是判据。它在启动时以及每次按下 **R** 时各打印两行 JSON：

```
GEOM   { window, canvas, image, reportedTexture, scale, screen }
EXPECT { ico_canvas, ico_texture, edge_canvas, edge_texture, modulate_on }
```

`*_texture` 是以**图像像素**表示的预期裁剪区域：Control 的画布矩形乘以 `image / canvas`。测试规格从不硬编码缩放系数，而是向夹具索取。

`reportedTexture` 之所以在输出里：`get_viewport().get_texture().get_size()` 报告的是 **922×576**，而 `get_texture().get_image()` 是 **1152×720**。报告的纹理尺寸不是捕获图像的尺寸，因此夹具和截图路径都必须测量图像本身。

## 布局

| 节点 | 画布矩形 | 用途 |
|---|---|---|
| `Main` | 1440×900 | 场景根；它的名字同时是 `godot_state` 输出的路径前缀 |
| `Main/Frame` | 100,100 600×400 | 普通容器，不设鼠标过滤 |
| `Main/Frame/Ico` | 120,120 120×60 | 在 `mouse_entered` 时变亮的 Button（悬停见证物） |
| `Main/Frame/Deep/Leaf` | 嵌套 | 为路径往返提供深度 |
| `Main/EdgePanel` | 1300,700 300×300 | 超出画布，裁剪必须收到 140×200 画布 / 112×160 图像 |

## 运行复现

```bash
# from the deepseek-harness checkout
DSH_TEST_GODOT=/path/to/your/godot npx vitest run packages/godot/tool-godot-ego/tests/repro.stretch.spec.ts
```

当前状态：**11 项通过**，其中包含会话中途改变窗口尺寸。修复之前同一套件是 1 项通过（RIG 守卫）加 7 项失败，因此“全绿”意味着缺陷已修复，而不是测试被放宽。

对照实验：去掉 `window/stretch/mode` 并把视口设为 640 × 400（1:1）后，`#1 godot_hover` **通过**，而 RIG 守卫失败。这说明悬停缺陷来自缩放；而 `#1 godot_click`（调用 4.6+ 上不存在的 `gui_get_hovering_control`）在 1:1 下仍然失败。两个彼此独立的原因。
