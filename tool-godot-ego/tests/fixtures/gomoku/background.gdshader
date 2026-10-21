shader_type canvas_item;

void fragment() {
	vec2 p = UV - vec2(0.46, 0.40);
	float glow = smoothstep(0.82, 0.0, length(p));
	vec3 ink = vec3(0.055, 0.055, 0.047);
	vec3 warm = vec3(0.105, 0.098, 0.078);
	COLOR = vec4(mix(ink, warm, glow * 0.85), 1.0);
}
