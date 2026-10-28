# stretch-repro fixture

The geometry the visual sandbox was never exercised in: a **1440×900 canvas**
with `canvas_items` stretch, rendered into a window the launcher forces to
**1280×720** (`--resolution` is hardcoded in `play.ts`). Measured:

```
window 1280 × 720 · canvas 1440 × 900 · image 1152 × 720 · scale 0.8 · screen origin x=64
```

Every coordinate identity the sandbox assumes (`canvas == screen == image`)
breaks here, which is why it is the baseline for the 2026-10-27 feedback.

## Protocol

The fixture is the oracle. It prints two JSON lines on startup and again when
you press **R**:

```
GEOM   { window, canvas, image, reportedTexture, scale, screen }
EXPECT { ico_canvas, ico_texture, edge_canvas, edge_texture, modulate_on }
```

`*_texture` is the expected crop in **image pixels**: the Control's canvas rect
multiplied by `image / canvas`. The spec never hardcodes a scale factor. It asks
the fixture.

Why `reportedTexture` is in there: `get_viewport().get_texture().get_size()`
reports **922×576** while `get_texture().get_image()` is **1152×720**. The
reported texture size is not the captured image size, so both the fixture and
the capture path must measure the image itself.

## Layout

| Node | Canvas rect | Why |
|---|---|---|
| `Main` | 1440×900 | scene root; its name is also the path prefix `godot_state` emits |
| `Main/Frame` | 100,100 600×400 | plain container, no mouse filter |
| `Main/Frame/Ico` | 120,120 120×60 | Button that brightens on `mouse_entered` (the hover witness) |
| `Main/Frame/Deep/Leaf` | nested | depth for the path round-trip |
| `Main/EdgePanel` | 1300,700 300×300 | extends past the canvas, so the crop must clip to 140×200 canvas / 112×160 image |

## Running the repro

```bash
# from the deepseek-harness checkout
DSH_TEST_GODOT=/path/to/your/godot npx vitest run packages/godot/tool-godot-ego/tests/repro.stretch.spec.ts
```

Current state: **11 pass**, including a mid-session window resize. Before these
fixes the same suite was 1 pass (the RIG guard) and 7 fail, so "green" means the
defect is fixed, not that the test was loosened.

Control experiment: with `window/stretch/mode` removed and the viewport set to
640 × 400 (1:1), `#1 godot_hover` **passes** and the RIG guard fails. That shows
the hover defect comes from the scaling, while `#1 godot_click` (a
`gui_get_hovering_control` call that does not exist on 4.6+) still fails at 1:1.
Two independent causes.
