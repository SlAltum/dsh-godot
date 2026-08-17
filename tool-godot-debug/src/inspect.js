/**
 * The bounded variable expansion: after the first stop that has a frame, the
 * tool serially requests `scene:inspect_object` for the stop's top-level
 * `ObjectId` values and renders their property tuples into the report. This
 * replaces the source plugin's interactive VariablesManager/GodotObjectPromise
 * machinery with a one-shot, budgeted variant (plan D1/D5). Protocol facts
 * pinned in `.context/t5/facts.md`: responses carry the requested id as an
 * INT64 (compare with the requested UINT64 bigint; negative values are
 * unsigned-normalized), property tuples are `[name, typeCode, hint,
 * hintString, usage, value]` with `usage === 128` category markers, RID
 * inspect returns an empty response, and a running (non-paused) game answers
 * with silence — hence expansion only runs while paused, object-level
 * failures skip with `expansionTruncated`, and a disconnect ends the run.
 * @module @deepseek-ai/dsh-tool-godot-debug/inspect
 */
import { GodotError } from './error.ts';
import { renderValue } from './snapshot.ts';
import { ObjectId, RID, RawObject } from './variants.ts';
/**
 * Normalize a decoded response id to the unsigned form used for comparison.
 * Pinned T5.0 fact 1: normal payloads arrive as a non-negative INT64 already
 * equal to the requested UINT64; the +2^64 conversion is defensive.
 * @param value - the decoded id parameter (bigint or integer).
 * @returns the unsigned id, or null when not an integer.
 */
export function normalizeId(value) {
    if (typeof value === 'bigint')
        return value < 0n ? value + (1n << 64n) : value;
    if (typeof value === 'number' && Number.isInteger(value)) {
        const big = BigInt(value);
        return big < 0n ? big + (1n << 64n) : big;
    }
    return null;
}
/**
 * Select the expandable top-level object values from one stop's raw vars.
 * `RID` values are excluded (pinned: RID inspect returns an empty response,
 * plan D9); freed objects already decode as null (no id to inspect).
 * @param vars - the raw `stack_frame_var` params arrays.
 * @param maxObjects - the selection cap (0 = none).
 * @returns the selected `{ name, id }` pairs in first-seen order, deduplicated.
 */
export function selectExpandableIds(vars, maxObjects) {
    const seen = new Set();
    const out = [];
    if (maxObjects <= 0)
        return out;
    for (const entry of vars) {
        const value = entry[3];
        if (!(value instanceof ObjectId) || value instanceof RID)
            continue;
        const key = value.id.toString();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({ name: typeof entry[0] === 'string' ? entry[0] : '', id: value.id });
        if (out.length >= maxObjects)
            break;
    }
    return out;
}
/**
 * Parse one `scene:inspect_object` response's property list into render rows.
 * Pinned T5.0 facts: tuples are `[name, typeCode, hint, hintString, usage,
 * value]`; `usage === 128` marks a category grouping element (skipped; the
 * following properties already carry their group prefix); `Members/` and
 * `Constants/` prefixes are stripped (source-plugin rule), other prefixes
 * (`Node/`) are kept as display names.
 * @param props - the response's props array.
 * @param maxProps - the row cap.
 * @param options - the render bounds.
 * @returns the rows and whether any tuple/row was dropped.
 */
export function parseInspectProps(props, maxProps, options) {
    const rows = [];
    let truncated = false;
    for (const prop of props) {
        if (!Array.isArray(prop) || prop.length < 6 || typeof prop[0] !== 'string') {
            truncated = true; // malformed tuple (defensive; T5.0 fact 9 saw none)
            continue;
        }
        if (prop[4] === 128)
            continue; // category grouping element, not a variable
        let name = prop[0];
        if (name.startsWith('Members/'))
            name = name.slice('Members/'.length);
        else if (name.startsWith('Constants/'))
            name = name.slice('Constants/'.length);
        if (rows.length >= maxProps) {
            truncated = true;
            continue;
        }
        rows.push({ name, value: renderValue(prop[5], 0, options) });
    }
    return { rows, truncated };
}
/**
 * Collect the expandable ObjectIds inside one decoded property value, with
 * their display paths. Pinned T8.0 facts: containers decode as `Array`
 * (elements) and `Map` (values); dictionary KEYS are NOT expanded (the
 * source plugin only renders them, facts 1); RID values are excluded (their
 * inspect returns an empty response, T5.0 fact 5); the same id can appear at
 * top level AND nested (dedup is the caller's job, fact 2).
 * @param value - the decoded property value.
 * @param basePath - the display path of the value (e.g. `player`, `arr`,
 *   `dict`), extended per element/key (`arr[0]`, `dict["k"]`).
 * @returns the nested `{ path, id }` pairs, in traversal order.
 */
export function collectNestedIds(value, basePath) {
    const out = [];
    visit(value, basePath);
    return out;
    function visit(v, path) {
        if (v instanceof ObjectId) {
            if (!(v instanceof RID))
                out.push({ path, id: v.id });
            return;
        }
        // RawObject (an inline-decoded object, extends Map) is NOT traversed: its
        // members are the object's own properties, not nested containers to
        // expand (the t8 probe walked only __type__-tagged values, matching this).
        if (v instanceof RawObject)
            return;
        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++)
                visit(v[i], `${path}[${i}]`);
            return;
        }
        if (v instanceof Map) {
            for (const [key, val] of v)
                visit(val, `${path}["${String(key)}"]`);
        }
    }
}
/**
 * Run the serial, budgeted expansion for one stop's raw vars. Runs only while
 * the game is paused (pinned: a running game answers with silence). Top-level
 * object values are expanded; when `maxDepth > 1`, ObjectIds found inside
 * their property values (direct, array elements, dictionary values) are
 * expanded recursively with the same serial/id-matched protocol (T8.0 facts
 * 1/4), deduplicated across levels (fact 2), and rendered as `children`.
 * Failure taxonomy (plan D4/D5): per-object timeout/malformed = skip + flag;
 * disconnect (GODOT_UNAVAILABLE) = propagate (the run loop ends and returns
 * the partial result); cancellation = propagate (GODOT_ABORTED).
 * @param vars - the stop's raw vars.
 * @param controller - the protocol controller (send + waitForMessage).
 * @param options - the expansion bounds and budget.
 * @returns the expansion result.
 */
export async function expandObjects(vars, controller, options) {
    const selected = selectExpandableIds(vars, options.maxObjects);
    if (selected.length === 0) {
        return { entries: [], expandedObjects: 0, expansionTruncated: false };
    }
    const entries = [];
    let expandedObjects = 0;
    let expansionTruncated = false;
    const expandedIds = new Set();
    const start = Date.now();
    /** Expand one object (recursively per maxDepth); returns null on skip. */
    async function expandOne(id, name, depth) {
        const remaining = options.budgetMs - (Date.now() - start);
        if (remaining <= 0) {
            expansionTruncated = true; // budget spent: skip, keep partial result
            return null;
        }
        const waitMs = Math.min(options.idleTimeoutMs, remaining);
        try {
            controller.send('scene:inspect_object', [id]);
            const resp = await controller.waitForMessage(m => m[0] === 'scene:inspect_object' && normalizeId(Array.isArray(m[2]) ? m[2][0] : null) === id, waitMs, options.signal, 'scene:inspect_object');
            const params = resp[2];
            const className = Array.isArray(params) && typeof params[1] === 'string' ? params[1] : '';
            const props = Array.isArray(params) && Array.isArray(params[2]) ? params[2] : [];
            const { rows, truncated } = parseInspectProps(props, options.maxProps, options.render);
            if (truncated)
                expansionTruncated = true;
            expandedObjects++;
            let children;
            if (depth < options.maxDepth) {
                // Recurse into nested ObjectIds found in the property values.
                for (const prop of props) {
                    if (!Array.isArray(prop) || prop.length < 6 || typeof prop[0] !== 'string')
                        continue;
                    if (prop[4] === 128)
                        continue; // category grouping element
                    const propName = stripPrefix(prop[0]);
                    for (const nested of collectNestedIds(prop[5], propName)) {
                        const key = nested.id.toString();
                        if (expandedIds.has(key))
                            continue; // cross-level dedup (T8.0 fact 2)
                        expandedIds.add(key);
                        const child = await expandOne(nested.id, nested.path, depth + 1);
                        if (child !== null) {
                            children ??= [];
                            children.push(child);
                        }
                    }
                }
            }
            return { name, id: id.toString(), className, rows, ...(children !== undefined ? { children } : {}) };
        }
        catch (error) {
            if (error instanceof GodotError && error.code === 'GODOT_ABORTED')
                throw error;
            if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE')
                throw error; // disconnected
            expansionTruncated = true; // timeout or malformed: skip this object
            return null;
        }
    }
    // Top-level selection wins: pre-reserve every selected id so the nested
    // recursion skips them (T8.0 fact 2 — a top-level object that also appears
    // inside a property is expanded once, at top level).
    for (const { id } of selected)
        expandedIds.add(id.toString());
    for (const { name, id } of selected) {
        const entry = await expandOne(id, name, 1);
        if (entry !== null)
            entries.push(entry);
    }
    return { entries, expandedObjects, expansionTruncated };
}
/** Strip the `Members/` / `Constants/` prefix for display (T8.0 fact 6). */
function stripPrefix(name) {
    if (name.startsWith('Members/'))
        return name.slice('Members/'.length);
    if (name.startsWith('Constants/'))
        return name.slice('Constants/'.length);
    return name;
}
