extends Control

## Draws the kaya board, grid, coordinates, stones, and winning/last-move rings.
## Input lives on the transparent hit buttons above this view, so the visual
## layer never consumes a click.

const BOARD_SIZE := 15
const FRAME := 4.0

var _board: Array = []
var _last := Vector2i(-1, -1)
var _win_cells: Array[Vector2i] = []
var _finished := false

@export var mono_font: Font
@export var paper := Color("#f1e9da")
@export var vermilion := Color("#c14c38")
@export var wood_light := Color("#cba46e")
@export var wood_dark := Color("#a87748")
@export var ink := Color("#181816")


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)


func set_state(board: Array, last: Vector2i, win_cells: Array[Vector2i], finished: bool) -> void:
	_board = board
	_last = last
	_win_cells = win_cells
	_finished = finished
	queue_redraw()


func _draw() -> void:
	var side := minf(size.x, size.y)
	var margin := side * 0.08
	var step := (side - margin * 2.0) / float(BOARD_SIZE - 1)

	# A quiet shadow and a thin dark frame keep the board seated in the room.
	draw_rect(Rect2(6, 10, side, side), Color(0, 0, 0, 0.32))
	draw_rect(Rect2(0, 0, side, side), Color("#2b241a"))
	draw_rect(Rect2(FRAME, FRAME, side - FRAME * 2, side - FRAME * 2), Color("#7a522e"), false, 1.0)

	# Wood grain: a vertical warm gradient plus a few long, low-contrast fibers.
	for y in range(int(FRAME), int(side - FRAME)):
		var t := float(y - FRAME) / maxf(side - FRAME * 2.0, 1.0)
		draw_rect(Rect2(FRAME, y, side - FRAME * 2.0, 1.0), wood_light.lerp(wood_dark, t))
	for i in range(26):
		var gy := margin * 0.4 + float(i) * (side - margin * 0.8) / 25.0
		var wobble := sin(float(i) * 1.7) * 3.0
		draw_line(Vector2(FRAME + 2, gy), Vector2(side - FRAME - 2, gy + wobble), Color(0.36, 0.23, 0.12, 0.10), 1.0)

	for i in range(BOARD_SIZE):
		var x := margin + float(i) * step
		var y := margin + float(i) * step
		draw_line(Vector2(x, margin), Vector2(x, margin + step * float(BOARD_SIZE - 1)), Color(0.32, 0.21, 0.12, 0.72), 1.0)
		draw_line(Vector2(margin, y), Vector2(margin + step * float(BOARD_SIZE - 1), y), Color(0.32, 0.21, 0.12, 0.72), 1.0)
		draw_string(mono_font, Vector2(x - 3, margin - 12), String.chr(65 + i), HORIZONTAL_ALIGNMENT_LEFT, -1, 9, Color(0.34, 0.23, 0.13, 0.80))
		draw_string(mono_font, Vector2(margin - 22, y + 3), str(i + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, 9, Color(0.34, 0.23, 0.13, 0.80))

	for star in [Vector2i(3, 3), Vector2i(3, 11), Vector2i(7, 7), Vector2i(11, 3), Vector2i(11, 11)]:
		draw_circle(_point(star, margin, step), 2.8, Color(0.30, 0.19, 0.10, 0.85))

	for row in range(BOARD_SIZE):
		for col in range(BOARD_SIZE):
			var player := int(_board[row][col]) if row < _board.size() and col < _board[row].size() else 0
			if player == 0:
				continue
			_draw_stone(_point(Vector2i(row, col), margin, step), player, step)

	if _last.x >= 0:
		draw_arc(_point(_last, margin, step), step * 0.47, 0.0, TAU, 48, vermilion, maxf(2.0, step * 0.075), true)


func _point(cell: Vector2i, margin: float, step: float) -> Vector2:
	return Vector2(margin + float(cell.y) * step, margin + float(cell.x) * step)


func _draw_stone(center: Vector2, player: int, step: float) -> void:
	var radius := step * 0.45
	draw_circle(center + Vector2(2, 3), radius + 1.0, Color(0, 0, 0, 0.32))
	if player == 1:
		draw_circle(center, radius, ink)
		draw_circle(center + Vector2(-radius * 0.28, -radius * 0.32), radius * 0.28, Color(1, 1, 1, 0.10))
		draw_circle(center + Vector2(-radius * 0.38, -radius * 0.42), radius * 0.12, Color(1, 1, 1, 0.22))
		draw_arc(center, radius, 0.0, TAU, 48, Color(0.02, 0.02, 0.02, 0.95), 1.0, true)
	else:
		draw_circle(center, radius, Color("#e8e0d0"))
		draw_circle(center + Vector2(-radius * 0.28, -radius * 0.32), radius * 0.34, Color(1, 1, 1, 0.65))
		draw_circle(center + Vector2(-radius * 0.40, -radius * 0.44), radius * 0.16, Color(1, 1, 1, 0.95))
		draw_arc(center, radius, 0.0, TAU, 48, Color("#8f7f6b"), 1.2, true)
