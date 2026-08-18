/**
 * ui-plugin-godot — Godot 界面动态插件（部署示例 v2.3）
 *
 * 向 DSH Web 界面添加两块 Godot 相关界面，不改动 DSH 本体：
 *   1. Godot 设置卡片（settings.plugin.item）：Godot 编辑器路径、
 *      gdformat 工具路径、代码格式化方式、单次操作超时。
 *   2. godot_debug 调试工具卡（tool.call.toolview）：摘要行 + 可展开的
 *      调试报告。
 *
 * 加载方式：会话内用 cordis_define / cordis_run（host 面 = applyHost，
 * client 面 = applyClient）；或按部署环境的插件机制引入本文件。
 * 使用说明见同目录 ui-plugin-godot.md。
 *
 * 实现说明（修改本文件前请阅读）：
 *   - 本文件运行在浏览器端，是纯 JavaScript：不能使用 import 和 JSX，
 *     React 与 styles 由运行环境注入，界面用 React.createElement 构建。
 *   - 设置卡片注册时同时提供 key 和 id：新旧两版界面框架对这一位置的
 *     注册要求不同（旧版按 id 收录所有卡片，新版按 key 即设置命名空间
 *     分发），两者都写才能在两个版本下正常显示，请勿删掉其中之一。
 *   - 界面颜色一律使用 var(--dsw-*) 主题变量，不写死颜色值，否则另一套
 *     配色下会显示异常。
 *   - 界面文案为中文；调试报告正文由工具生成、面向助手阅读，保持原样。
 */

/** host 面：无 host 行为（godot 设置命名空间归 tool-godot 所有）。 */
export function applyHost() {
  return {
    name: 'ui-plugin-godot',
    inject: [],
    apply() {},
  }
}

/** client 面：注册 godot 设置卡片与 godot_debug 工具卡。 */
export function applyClient() {
  const css = `
.godot-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);padding:12px 16px}
.godot-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.godot-name{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}
.godot-note{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}
.godot-desc{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);margin-top:2px}
.godot-field{display:grid;grid-template-columns:170px minmax(0,1fr) auto;gap:8px;align-items:center;margin-top:10px}
.godot-label{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.godot-control{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font:var(--dsw-font-xs-13);width:100%;box-sizing:border-box;outline:none}
.godot-control:focus{border-color:var(--dsw-alias-brand-primary)}
.godot-control:disabled{color:var(--dsw-alias-label-tertiary)}
.godot-control[data-invalid=true]{border-color:var(--dsw-alias-label-error)}
.godot-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);margin-top:2px;line-height:1.5}
.godot-chip{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border-radius:4px;padding:1px 6px;white-space:nowrap}
.godot-reset{border:none;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);cursor:pointer;padding:0;text-decoration:underline}
.godot-reset:hover:not(:disabled){color:var(--dsw-alias-label-secondary)}
.godot-actions{display:flex;gap:8px;margin-top:12px}
.godot-btn{border:1px solid var(--dsw-alias-label-dimmed);background:transparent;color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 12px;font:var(--dsw-font-xs-13);cursor:pointer}
.godot-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.godot-btn:disabled{cursor:default;opacity:.5}
.godot-btn-primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.godot-row{display:flex;align-items:center;gap:8px;padding:6px 0;min-width:0;font:var(--dsw-font-xs-13)}
.godot-dot{width:8px;height:8px;border-radius:50%;flex:none}
.godot-dot-running{background:var(--dsw-alias-state-business-primary);animation:godot-pulse 1.6s ease-in-out infinite}
.godot-dot-error{background:var(--dsw-alias-state-error-primary)}
.godot-tool-name{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary);white-space:nowrap}
.godot-tool-summary{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.godot-tool-head{color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.godot-tool-head-error{color:var(--dsw-alias-state-error-primary)}
.godot-inspect{margin-left:auto;border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;padding:0 2px}
.godot-inspect:hover{color:var(--dsw-alias-label-secondary)}
.godot-report{margin-top:2px}
.godot-report>summary{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none;list-style:none}
.godot-report>summary::-webkit-details-marker{display:none}
.godot-report>summary::before{content:'\u25B8  '}
.godot-report[open]>summary::before{content:'\u25BE  '}
.godot-pre{margin:6px 0 0;padding:8px 10px;overflow:auto;max-height:340px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;white-space:pre;color:var(--dsw-alias-label-primary)}
.godot-stop{margin-top:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 10px}
.godot-stop>summary{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;list-style:none}
.godot-stop>summary::-webkit-details-marker{display:none}
.godot-sub{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin-top:6px}
.godot-lines{margin:4px 0 0;padding:6px 8px;overflow:auto;max-height:260px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;white-space:pre;color:var(--dsw-alias-label-primary)}
.godot-frame{margin-top:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.godot-frame-link{color:var(--dsw-alias-brand-primary);text-decoration:underline;cursor:pointer}
.godot-frame-link:hover{text-decoration:none}
@keyframes godot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
`

  /** Subscribe to one settings scope snapshot with plain React. */
  function useScopeSnapshot(scope) {
    const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot())
    React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])
    return snapshot
  }

  /** One labeled field: label column + (control + hint) + status chip column. */
  function Field(props) {
    return React.createElement(
      'div',
      { className: 'godot-field' },
      React.createElement('label', { className: 'godot-label', htmlFor: props.id }, props.label),
      React.createElement('div', null, props.control,
        props.hint !== undefined ? React.createElement('div', { className: 'godot-hint' }, props.hint) : null),
      ...props.chips,
    )
  }

  /** The godot settings card: editor path, formatter path, format mode, timeout. */
  function GodotCard(props) {
    const scope = props.scope
    const snapshot = useScopeSnapshot(scope)
    const value = snapshot.value ?? {}
    const committed = {
      executable: value.executable ?? '',
      gdformatExecutable: value.gdformatExecutable ?? '',
      formatBackend: value.formatBackend ?? 'gdformat',
      timeoutMs: value.timeoutMs !== undefined ? String(value.timeoutMs) : '',
    }
    const [form, setForm] = React.useState(committed)
    const setField = (field, next) => setForm((prev) => ({ ...prev, [field]: next }))
    const dirty = form.executable !== committed.executable
      || form.gdformatExecutable !== committed.gdformatExecutable
      || form.formatBackend !== committed.formatBackend
      || form.timeoutMs.trim() !== committed.timeoutMs
    // Follow external settings changes (another surface saved) while the form is clean.
    React.useEffect(() => {
      if (!dirty) setForm(committed)
    }, [snapshot])
    const timeoutValid = form.timeoutMs.trim() === '' || /^\d+$/.test(form.timeoutMs.trim())
    const disabled = snapshot.status !== 'ready' || !snapshot.writable
    const user = snapshot.user !== null && typeof snapshot.user === 'object' ? snapshot.user : {}
    const overridden = (field) => Object.prototype.hasOwnProperty.call(user, field)
    const resetField = (field) => { void scope.unset(field).catch(() => {}) }
    const save = () => {
      const ops = []
      const applyText = (field, next, prev) => {
        if (next === prev) return
        ops.push(next === '' ? scope.unset(field) : scope.set(field, next))
      }
      applyText('executable', form.executable, committed.executable)
      applyText('gdformatExecutable', form.gdformatExecutable, committed.gdformatExecutable)
      if (form.formatBackend !== committed.formatBackend) ops.push(scope.set('formatBackend', form.formatBackend))
      if (form.timeoutMs.trim() !== committed.timeoutMs) {
        const t = form.timeoutMs.trim()
        ops.push(t === '' ? scope.unset('timeoutMs') : scope.set('timeoutMs', Number(t)))
      }
      void Promise.all(ops).catch(() => {})
    }
    const chipFor = (field) => overridden(field)
      ? [
        React.createElement('span', { key: 'chip', className: 'godot-chip' }, '已覆盖'),
        React.createElement('button', {
          key: 'reset', type: 'button', className: 'godot-reset', disabled,
          onClick: () => resetField(field),
        }, '重置'),
      ]
      : []
    return React.createElement(
      'li',
      { className: 'godot-card' },
      React.createElement('div', { className: 'godot-head' },
        React.createElement('span', { className: 'godot-name' }, 'Godot'),
        snapshot.status === 'loading' ? React.createElement('span', { className: 'godot-note' }, '加载中…') : null,
        snapshot.status === 'unavailable' ? React.createElement('span', { className: 'godot-note' }, '此宿主未提供 godot 命名空间') : null,
        snapshot.status === 'ready' && !snapshot.writable ? React.createElement('span', { className: 'godot-note' }, '只读') : null,
      ),
      React.createElement('div', { className: 'godot-desc' },
        '告诉助手本机的 Godot 装在哪里，助手在运行、检查、格式化 Godot 项目时会使用这里的配置。保存后，下一次操作即按新配置执行。'),
      React.createElement(Field, {
        id: 'godot-executable', label: 'Godot 编辑器路径', chips: chipFor('executable'),
        hint: 'Godot 程序在本机的完整位置，例如 D:\\软件\\Godot\\Godot_v4.7.exe；也可以填已加入系统 PATH 的命令名。留空则使用默认命令 godot。',
        control: React.createElement('input', {
          id: 'godot-executable', className: 'godot-control', value: form.executable, disabled,
          placeholder: 'godot',
          onChange: (e) => setField('executable', e.target.value),
        }),
      }),
      React.createElement(Field, {
        id: 'godot-gdformat', label: 'gdformat 工具路径', chips: chipFor('gdformatExecutable'),
        hint: '可选。gdformat 是专门给 GDScript 代码排版的命令行工具，需单独安装；没有安装时，可把下方「代码格式化方式」切换为内置。',
        control: React.createElement('input', {
          id: 'godot-gdformat', className: 'godot-control', value: form.gdformatExecutable, disabled,
          placeholder: 'gdformat',
          onChange: (e) => setField('gdformatExecutable', e.target.value),
        }),
      }),
      React.createElement(Field, {
        id: 'godot-backend', label: '代码格式化方式', chips: chipFor('formatBackend'),
        hint: '整理 GDScript 代码缩进和排版时使用哪种工具。',
        control: React.createElement('select', {
          id: 'godot-backend', className: 'godot-control', value: form.formatBackend, disabled,
          onChange: (e) => setField('formatBackend', e.target.value),
        },
        React.createElement('option', { value: 'gdformat' }, 'gdformat（效果更好，需单独安装）'),
        React.createElement('option', { value: 'builtin' }, '内置格式化器（无需安装任何东西）')),
      }),
      React.createElement(Field, {
        id: 'godot-timeout', label: '单次操作超时', chips: chipFor('timeoutMs'),
        hint: '助手执行每个 Godot 相关操作最多等待多久，超过即中止并报告（单位：毫秒，默认 60000 即 60 秒）。',
        control: React.createElement('input', {
          id: 'godot-timeout', className: 'godot-control', value: form.timeoutMs, disabled,
          placeholder: '60000', inputMode: 'numeric', 'data-invalid': !timeoutValid || undefined,
          onChange: (e) => setField('timeoutMs', e.target.value),
        }),
      }),
      React.createElement('div', { className: 'godot-actions' },
        React.createElement('button', {
          type: 'button', className: 'godot-btn godot-btn-primary',
          disabled: disabled || !dirty || !timeoutValid,
          onClick: save,
        }, '保存'),
        React.createElement('button', {
          type: 'button', className: 'godot-btn',
          disabled: !dirty,
          onClick: () => setForm(committed),
        }, '放弃')),
    )
  }

  /**
   * Narrow the tool result's structured card view (T20). Defensive: any shape
   * violation — missing field, wrong array type, unknown version — yields null
   * and the card falls back to the plain text report (adversarial review H3).
   * @param meta - the opaque replayed tool metadata (`block.meta`).
   * @returns the structured view, or null for the text fallback.
   */
  function parseDebugView(meta) {
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
    const view = meta.view
    if (view === null || typeof view !== 'object' || Array.isArray(view) || view.version !== 1) return null
    if (typeof view.stopCount !== 'number' || !Array.isArray(view.stops)) return null
    for (const stop of view.stops) {
      if (stop === null || typeof stop !== 'object' || typeof stop.index !== 'number' || !Array.isArray(stop.frames)) return null
      if (stop.varsLines !== undefined && !Array.isArray(stop.varsLines)) return null
      if (stop.sceneTree !== undefined
        && (stop.sceneTree === null || typeof stop.sceneTree !== 'object' || !Array.isArray(stop.sceneTree.lines))) return null
    }
    if (view.outputTail !== undefined && !Array.isArray(view.outputTail)) return null
    if (view.errors !== undefined && !Array.isArray(view.errors)) return null
    if (view.expansion !== undefined
      && (view.expansion === null || typeof view.expansion !== 'object' || !Array.isArray(view.expansion.entries))) return null
    if (view.edits !== undefined
      && (view.edits === null || typeof view.edits !== 'object' || !Array.isArray(view.edits.results))) return null
    return view
  }

  /** Workspace path for a frame's file, when the run was launched with a
   *  project path; attach runs have no project mapping, so frames are not
   *  clickable there (adversarial review M3). */
  function frameOpenPath(frame, args) {
    if (typeof args.path !== 'string' || args.path === '') return undefined
    const file = frame.file
    if (typeof file !== 'string' || !file.startsWith('res://')) return undefined
    return args.path.replace(/[\\/]+$/, '') + '/' + file.slice('res://'.length)
  }

  /** Render one expanded object and its nested children as text lines
   *  (presentation parity with the tool's text report; the T20 view is
   *  structured, the card flattens it the same way). */
  function expansionLines(entries, indent) {
    const lines = []
    const pad = ' '.repeat(indent)
    for (const entry of entries) {
      const value = entry.repr !== undefined ? entry.repr : 'Object<' + entry.id + '>'
      lines.push(pad + entry.name + ' = ' + value + ' [' + entry.className + ']')
      if (Array.isArray(entry.rows)) {
        for (const row of entry.rows) lines.push(' '.repeat(indent + 2) + row.name + ' = ' + row.value)
      }
      if (Array.isArray(entry.children)) lines.push(...expansionLines(entry.children, indent + 2))
    }
    return lines
  }

  /** One edit's outcome line (parity with the tool's text report). */
  function editLine(result) {
    const status = result.ok ? 'ok' : 'failed: ' + (result.detail ?? 'unknown')
    return result.target + '.' + result.property + ' = ' + JSON.stringify(result.requested)
      + ' [' + result.type + '] ' + status
  }

  /** The structured card body: one collapsible section per stop. */
  function renderStructuredStops(view, state, owner, args) {
    const children = []
    for (const stop of view.stops) {
      const frame = stop.frames[0]
      const where = frame !== undefined ? frame.file + ':' + frame.line + ' @ ' + frame.func : '<无帧>'
      const reason = stop.reason === '' ? 'break' : stop.reason
      const thread = stop.threadId !== 1 ? ' · 线程 ' + stop.threadId : ''
      const body = []
      if (stop.frames.length > 1) {
        body.push(React.createElement('div', { key: 'frames-head', className: 'godot-sub' }, '调用栈'))
        for (const f of stop.frames) {
          const path = frameOpenPath(f, args)
          body.push(React.createElement('div', { key: 'frame-' + f.line, className: 'godot-frame' },
            path !== undefined
              ? React.createElement('span', {
                className: 'godot-frame-link',
                onClick: () => owner.openFile(path),
              }, f.file + ':' + f.line)
              : f.file + ':' + f.line,
            ' @ ' + f.func))
        }
      }
      if (stop.varsLines !== undefined && stop.varsLines.length > 0) {
        body.push(React.createElement('div', { key: 'vars-head', className: 'godot-sub' }, '变量'),
          React.createElement('pre', { key: 'vars-lines', className: 'godot-lines' }, stop.varsLines.join('\n')))
      }
      if (view.expansion !== undefined && view.expansion.stopIndex === stop.index && view.expansion.entries.length > 0) {
        body.push(React.createElement('div', { key: 'exp-head', className: 'godot-sub' },
          '展开对象 (' + view.expansion.expandedObjects + ')'),
        React.createElement('pre', { key: 'exp-lines', className: 'godot-lines' },
          expansionLines(view.expansion.entries, 0).join('\n')))
      }
      if (view.edits !== undefined && view.edits.stopIndex === stop.index && view.edits.results.length > 0) {
        body.push(React.createElement('div', { key: 'edits-head', className: 'godot-sub' },
          '编辑 (' + view.edits.results.length + ')'),
        React.createElement('pre', { key: 'edits-lines', className: 'godot-lines' },
          view.edits.results.map(editLine).join('\n')))
      }
      if (stop.sceneTree !== undefined && stop.sceneTree.lines.length > 0) {
        body.push(React.createElement('div', { key: 'tree-head', className: 'godot-sub' },
          '场景树 (' + stop.sceneTree.lines.length + ' 节点)'),
        React.createElement('pre', { key: 'tree-lines', className: 'godot-lines' }, stop.sceneTree.lines.join('\n')))
      }
      children.push(React.createElement('details', {
        key: 'stop-' + stop.index,
        className: 'godot-stop',
        open: state === 'error' || undefined,
      },
      React.createElement('summary', null, '停顿 ' + stop.index + ' · ' + where + ' [' + reason + thread + ']'),
      body))
    }
    if (view.outputTail.length > 0) {
      children.push(React.createElement('details', { key: 'output', className: 'godot-stop', open: state === 'error' || undefined },
        React.createElement('summary', null, '输出 (' + view.outputTail.length + ' 行' + (view.outputTruncated ? '，已截断' : '') + ')'),
        React.createElement('pre', { className: 'godot-lines' }, view.outputTail.join('\n'))))
    }
    if (view.errors.length > 0) {
      children.push(React.createElement('details', { key: 'errors', className: 'godot-stop', open: state === 'error' || undefined },
        React.createElement('summary', null, '错误 (' + view.errors.length + ')'),
        React.createElement('pre', { className: 'godot-lines godot-tool-head-error' }, view.errors.join('\n'))))
    }
    return children
  }

  /** The godot_debug tool call card: identity row + structured report. */
  function GodotDebugCard(owner) {
    const block = owner.block
    const done = block !== null && typeof block === 'object' && typeof block.kind === 'string'
    const argsRaw = done
      ? (block.call != null ? block.call.argsRaw : '')
      : (block != null ? block.argsRaw : '')
    let args = {}
    if (typeof argsRaw === 'string' && argsRaw !== '') {
      try {
        const parsed = JSON.parse(argsRaw)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed
      } catch (_ignored) { args = {} }
    }
    const attach = args.mode === 'attach'
    const mode = attach ? '附加' : '启动'
    const target = attach
      ? (typeof args.port === 'number' ? ':' + args.port : '运行中的游戏')
      : (typeof args.scene === 'string' && args.scene !== '' ? args.scene : '主场景')
    const bpCount = Array.isArray(args.breakpoints) ? args.breakpoints.length : 0
    let summary = mode + ' · ' + target
    if (bpCount > 0) summary += ' · ' + bpCount + ' 个断点'
    let state = 'running'
    let text = ''
    if (done) {
      state = block.isError === true ? 'error' : 'ok'
      const parts = []
      const content = Array.isArray(block.content) ? block.content : []
      for (const item of content) {
        if (item !== null && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
        else parts.push(JSON.stringify(item, null, 2))
      }
      if (parts.length === 0 && block.error != null) parts.push(block.error.name + ': ' + block.error.code)
      text = parts.join('\n')
    }
    const nl = text.indexOf('\n')
    const head = done && text !== '' ? (nl === -1 ? text : text.slice(0, nl)) : ''
    // T20: the structured view when the result carries one (else text fallback).
    const view = done ? parseDebugView(block.meta) : null
    const rowChildren = [
      React.createElement('span', {
        key: 'dot',
        className: state === 'running' ? 'godot-dot godot-dot-running' : state === 'error' ? 'godot-dot godot-dot-error' : 'godot-dot',
      }),
      React.createElement('span', { key: 'name', className: 'godot-tool-name' }, owner.toolName || 'godot_debug'),
      React.createElement('span', { key: 'summary', className: 'godot-tool-summary' }, summary),
    ]
    if (view !== null) {
      const truncated = view.viewTruncated === true || view.expansionTruncated === true || view.editsTruncated === true
        || view.sceneTreeTruncated === true || view.outputTruncated === true || view.varsTruncated === true
      const chips = [view.stopCount + ' 停顿']
      if (view.detached === true) chips.push('附加')
      if (view.sceneTreeCount > 0) chips.push(view.sceneTreeCount + ' 场景树')
      if (view.editsApplied > 0) chips.push(view.editsApplied + ' 编辑')
      if (view.expandedObjects > 0) chips.push(view.expandedObjects + ' 展开对象')
      if (truncated) chips.push('部分截断')
      for (const chip of chips) {
        rowChildren.push(React.createElement('span', { key: 'chip-' + chip, className: 'godot-chip' }, chip))
      }
    } else if (head !== '') {
      rowChildren.push(React.createElement('span', {
        key: 'head',
        className: 'godot-tool-head' + (state === 'error' ? ' godot-tool-head-error' : ''),
      }, head))
    }
    if (typeof owner.inspect === 'function') rowChildren.push(React.createElement('button', {
      key: 'inspect', type: 'button', className: 'godot-inspect', title: '查看调用详情',
      onClick: () => owner.inspect(),
    }, '⌕'))
    const row = React.createElement('div', { className: 'godot-row' }, rowChildren)
    if (!done || (text === '' && view === null)) return row
    if (view !== null) {
      return React.createElement('div', { className: 'godot-tool' }, row, ...renderStructuredStops(view, state, owner, args))
    }
    return React.createElement('div', { className: 'godot-tool' },
      row,
      React.createElement('details', { className: 'godot-report', open: state === 'error' || undefined },
        React.createElement('summary', null, '调试报告'),
        React.createElement('pre', { className: 'godot-pre' }, text)),
    )
  }

  return {
    name: 'ui-plugin-godot.client',
    inject: ['slots', 'settingsScope'],
    apply(ctx) {
      styles.insert(css)
      const scope = ctx.settingsScope.bind({ namespace: 'godot' })
      // 1. godot settings card. id satisfies list runtimes (deployed bundle,
      //    renders every card), key satisfies keyed runtimes (current source,
      //    dispatched by settings namespace).
      ctx.slots.inject('settings.plugin.item', () => {
        try {
          ctx.slots.register(
            { name: 'settings.plugin.item', key: 'godot', id: 'godot' },
            () => React.createElement(GodotCard, { scope }),
          )
        } catch (error) {
          console.warn('ui-plugin-godot: settings card registration failed', error)
        }
      })
      // 2. godot_debug tool call card — keyed by the wire tool name on both vintages.
      ctx.slots.inject('tool.call.toolview', () => {
        try {
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'godot_debug' },
            (owner) => React.createElement(GodotDebugCard, owner),
          )
        } catch (error) {
          console.warn('ui-plugin-godot: tool card registration failed', error)
        }
      })
    },
  }
}
