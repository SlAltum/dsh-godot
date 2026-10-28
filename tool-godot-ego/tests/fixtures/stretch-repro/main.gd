extends Control

## Repro fixture for the 2026-10-27 feedback: a 1440 × 900 canvas rendered into a
## smaller window, which is the one geometry the sandbox was never exercised in.
##
## It reports its own geometry and its own expectations whenever the viewport
## texture size changes, and on demand (key R), so the spec never hardcodes a
## scale factor and never reads a stale startup value:
##
##   GEOM   { window, canvas, texture, scale, screen }
##   EXPECT { ico_canvas, ico_texture, edge_canvas, edge_texture, modulate_on }

const MODULATE_ON := Color(1.6, 1.6, 1.6, 1.0)

var ico: Button
var edge: Panel

const REPORT_AT := [2, 30]

var _frames := 0


func _ready() -> void:
	var frame := Panel.new()
	frame.name = "Frame"
	frame.position = Vector2(100, 100)
	frame.size = Vector2(600, 400)
	add_child(frame)

	ico = Button.new()
	ico.name = "Ico"
	ico.position = Vector2(20, 20)
	ico.size = Vector2(120, 60)
	ico.text = "ICO"
	ico.mouse_entered.connect(_on_ico_enter)
	ico.mouse_exited.connect(_on_ico_exit)
	frame.add_child(ico)

	var deep := Control.new()
	deep.name = "Deep"
	deep.position = Vector2(300, 40)
	deep.size = Vector2(200, 80)
	frame.add_child(deep)

	var leaf := Button.new()
	leaf.name = "Leaf"
	leaf.position = Vector2(10, 10)
	leaf.size = Vector2(100, 40)
	leaf.text = "LEAF"
	deep.add_child(leaf)

	edge = Panel.new()
	edge.name = "EdgePanel"
	edge.position = Vector2(1300, 700)
	edge.size = Vector2(300, 300)
	add_child(edge)


func _process(_delta: float) -> void:
	_frames += 1
	# The root viewport geometry is not stable during startup, so report on a
	# fixed schedule (plus on demand via R) instead of guessing "settled".
	if _frames in REPORT_AT:
		_report()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_R:
		_report()
	# Resizing is normal user behavior, and it changes the canvas -> window scale
	# at runtime. S grows the window, T shrinks it, so the spec can assert that
	# capture and pointer coordinates survive a resize.
	elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_S:
		DisplayServer.window_set_size(Vector2i(1920, 1200))
		await get_tree().process_frame
		await get_tree().process_frame
		_report()
	elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_T:
		DisplayServer.window_set_size(Vector2i(800, 500))
		await get_tree().process_frame
		await get_tree().process_frame
		_report()


func _on_ico_enter() -> void:
	ico.modulate = MODULATE_ON
	print("HOVER in")


func _on_ico_exit() -> void:
	ico.modulate = Color(1, 1, 1, 1)
	print("HOVER out")


func _report() -> void:
	var viewport := get_viewport()
	var canvas := viewport.get_visible_rect().size
	# The oracle must use the IMAGE size, never get_texture().get_size(): on a
	# scaled window the latter reports a different number (measured 922 × 576
	# while the captured image is 1152 × 720). The capture side has the same duty.
	var image := viewport.get_texture().get_image()
	var image_size := Vector2(image.get_size())
	var scale := Vector2(image_size.x / canvas.x, image_size.y / canvas.y)
	var screen := viewport.get_screen_transform()
	var ico_canvas := ico.get_global_rect()
	var edge_canvas := edge.get_global_rect().intersection(Rect2(Vector2.ZERO, canvas))
	print("GEOM ", JSON.stringify({
		"window": [DisplayServer.window_get_size().x, DisplayServer.window_get_size().y],
		"canvas": [canvas.x, canvas.y],
		"image": [image_size.x, image_size.y],
		"reportedTexture": [viewport.get_texture().get_size().x, viewport.get_texture().get_size().y],
		"scale": [scale.x, scale.y],
		"screen": [screen.x.x, screen.y.y, screen.origin.x, screen.origin.y],
	}))
	print("EXPECT ", JSON.stringify({
		"ico_canvas": _rect_of(ico_canvas),
		"ico_texture": _rect_scaled(ico_canvas, scale),
		"edge_canvas": _rect_of(edge_canvas),
		"edge_texture": _rect_scaled(edge_canvas, scale),
		"modulate_on": [MODULATE_ON.r, MODULATE_ON.g, MODULATE_ON.b],
	}))


func _rect_of(rect: Rect2) -> Array:
	return [rect.position.x, rect.position.y, rect.size.x, rect.size.y]


func _rect_scaled(rect: Rect2, scale: Vector2) -> Array:
	return [
		roundi(rect.position.x * scale.x),
		roundi(rect.position.y * scale.y),
		roundi(rect.size.x * scale.x),
		roundi(rect.size.y * scale.y),
	]
