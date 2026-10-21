extends Control

## Two-player Gomoku for the DSH visual sandbox. The authored scene owns the
## visual composition; this script owns rules, turn state, and the transparent
## hit layer that makes every intersection a deterministic Control path.

const BOARD_SIZE := 15
const EMPTY := 0
const BLACK := 1
const WHITE := 2
const CELL := 30.0
const BOARD_MARGIN := 40.0
const VERMILION := Color("#c14c38")
const PAPER := Color("#f1e9da")
const DIM := Color("#9e9482")

var _board: Array = []
var _cells: Array[Button] = []
var _current := BLACK
var _finished := false
var _moves := 0
var _last := Vector2i(-1, -1)
var _win_cells: Array[Vector2i] = []

@onready var board_view: Control = $BoardView
@onready var board_hits: Control = $BoardHits
@onready var status_name: Label = $StatusName
@onready var status_accent: Label = $StatusAccent
@onready var move_meta: Label = $MoveMeta
@onready var last_move: Label = $LastMove
@onready var turn_value: Label = $TurnValue
@onready var black_count: Label = $BlackCount
@onready var white_count: Label = $WhiteCount


func _ready() -> void:
	$NewGame.pressed.connect(_new_game)
	_build_hits()
	_new_game()


func _build_hits() -> void:
	for child in board_hits.get_children():
		child.queue_free()
	var normal := _hit_style()
	for row in range(BOARD_SIZE):
		for col in range(BOARD_SIZE):
			var button := Button.new()
			button.name = "Cell_%02d_%02d" % [row, col]
			button.position = Vector2(BOARD_MARGIN + col * CELL - CELL / 2.0, BOARD_MARGIN + row * CELL - CELL / 2.0)
			button.size = Vector2(CELL, CELL)
			button.flat = false
			button.focus_mode = Control.FOCUS_NONE
			button.mouse_filter = Control.MOUSE_FILTER_STOP
			button.add_theme_stylebox_override("normal", normal)
			button.add_theme_stylebox_override("hover", normal)
			button.add_theme_stylebox_override("pressed", normal)
			button.add_theme_stylebox_override("focus", normal)
			button.pressed.connect(_on_cell_pressed.bind(row, col))
			board_hits.add_child(button)
			_cells.append(button)


func _hit_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0, 0, 0, 0)
	style.border_width_left = 0
	style.border_width_top = 0
	style.border_width_right = 0
	style.border_width_bottom = 0
	return style


func _new_game() -> void:
	_board = []
	for row in range(BOARD_SIZE):
		var line: Array[int] = []
		line.resize(BOARD_SIZE)
		line.fill(EMPTY)
		_board.append(line)
	_current = BLACK
	_finished = false
	_moves = 0
	_last = Vector2i(-1, -1)
	_win_cells = []
	_refresh()


func _on_cell_pressed(row: int, col: int) -> void:
	if _finished or _board[row][col] != EMPTY:
		return
	_board[row][col] = _current
	_moves += 1
	_last = Vector2i(row, col)
	var winning := _winning_cells(row, col, _current)
	if not winning.is_empty():
		_win_cells = winning
		_finished = true
		_refresh()
		return
	if _moves == BOARD_SIZE * BOARD_SIZE:
		_finished = true
		_refresh()
		return
	_current = WHITE if _current == BLACK else BLACK
	_refresh()


func _refresh() -> void:
	board_view.set_state(_board, _last, _win_cells, _finished)
	status_name.text = "Black" if _current == BLACK else "White"
	status_accent.text = "wins" if _finished else "to move"
	status_accent.add_theme_color_override("font_color", VERMILION if _finished else PAPER)
	move_meta.text = "MOVE %02d  /  225" % _moves
	last_move.text = _coordinate(_last) if _last.x >= 0 else "—"
	turn_value.text = "—" if _finished else ("Black" if _current == BLACK else "White")
	black_count.text = "BLACK  ·  %02d" % _count(BLACK)
	white_count.text = "WHITE  ·  %02d" % _count(WHITE)


func _winning_cells(row: int, col: int, player: int) -> Array[Vector2i]:
	for direction in [Vector2i(1, 0), Vector2i(0, 1), Vector2i(1, 1), Vector2i(1, -1)]:
		var line: Array[Vector2i] = [Vector2i(row, col)]
		for step in [-1, 1]:
			var r: int = row + direction.x * step
			var c: int = col + direction.y * step
			while _in_bounds(r, c) and _board[r][c] == player:
				line.append(Vector2i(r, c))
				r += direction.x * step
				c += direction.y * step
		if line.size() >= 5:
			return line
	return []


func _count(player: int) -> int:
	var total := 0
	for row in range(BOARD_SIZE):
		for col in range(BOARD_SIZE):
			if _board[row][col] == player:
				total += 1
	return total


func _coordinate(cell: Vector2i) -> String:
	if cell.x < 0 or cell.y < 0:
		return "—"
	return String.chr(65 + cell.y) + str(cell.x + 1)


func _in_bounds(row: int, col: int) -> bool:
	return row >= 0 and row < BOARD_SIZE and col >= 0 and col < BOARD_SIZE
