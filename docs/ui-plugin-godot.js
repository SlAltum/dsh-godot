/**
 * ui-plugin-godot — Godot UI 动态插件（部署示例）
 *
 * 为 DSH Web 界面贡献两块 godot 专属 UI，零侵入 dsh 本体：
 *   1. `settings.plugin.item`（插件设置区）：godot 设置卡片——编辑 godot
 *      命名空间的两个可执行文件字段（executable / gdformatExecutable）。
 *   2. `tool.call.toolview`（keyed）：`godot_debug` 专属工具调用卡。
 *
 * 加载方式（二选一）：
 *   - 会话内：用 cordis_define 定义（code.host = 本文件 host 面，
 *     code.client = 本文件 client 面），cordis_run 激活。
 *   - 部署：按部署环境的插件加载方式（cordis 组合）引入本文件。
 *
 * 能力边界（cordis-client-runner 约束）：
 *   - Client 面是纯 JS：无 JSX/TS/import——React 以闭包符号到达，
 *     CSS 经 styles.insert(css)，跨插件协作走 ctx 服务或 host.call。
 *   - 必须声明 inject（'slots' 是 UI 座位的唯一入口；settingsScope 的
 *     bind 还需要 'connection' + 'remote'）。
 *   - 所有注册包在 ctx.slots.inject(key, () => ctx.slots.register(...)) 内
 *     （slot 只在声明它的条目挂载期间存在）。
 *   - 主题色用 CSS 变量（var(--dsw-*)，如 var(--dsw-alias-label-primary)），
 *     不写死颜色，否则另一配色下会破。
 *
 * 注：本文件作为部署示例随 godot 仓库分发；实际 UI 验证需在 GUI 页面
 * 响应的部署中加载（本仓库开发环境页面无应答时无法端到端验证）。
 */
const NS = 'settings.plugins'

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
  return {
    name: 'ui-plugin-godot.client',
    inject: ['slots', 'settingsScope', 'connection', 'remote'],
    apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: 'godot' })

      // ---- 1. godot 设置卡片（settings.plugin.item） ----
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
        { name: 'settings.plugin.item', id: 'godot', order: 30 },
        () => React.createElement(GodotCard, { scope }),
      ))

      // ---- 2. godot_debug 专属工具卡（tool.call.toolview, keyed） ----
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
        { name: 'tool.call.toolview', key: 'godot_debug' },
        (owner) => React.createElement(GodotDebugRow, owner),
      ))
    },
  }
}

/** 读取 scope 快照的简单订阅钩子（动态面无 hooks 转换，用原始 React）。 */
function useScopeSnapshot(scope) {
  const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot())
  React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])
  return snapshot
}

/** godot 设置卡片：两个可执行文件字段 + 保存/重置。 */
function GodotCard(props) {
  const snapshot = useScopeSnapshot(props.scope)
  const value = snapshot.value ?? {}
  const [executable, setExecutable] = React.useState(value.executable ?? '')
  const [gdformat, setGdformat] = React.useState(value.gdformatExecutable ?? '')
  const dirty = executable !== (value.executable ?? '') || gdformat !== (value.gdformatExecutable ?? '')
  const disabled = !snapshot.writable || snapshot.status !== 'ready'
  const rowStyle = { display: 'flex', gap: '8px', alignItems: 'center', margin: '6px 0' }
  const inputStyle = { width: '280px' }
  return React.createElement(
    'div',
    { style: { padding: '12px', border: '1px solid var(--dsw-alias-border-divider)', borderRadius: '8px' } },
    React.createElement('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Godot'),
    React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginBottom: '8px' } },
      'The headless binaries. Saving here applies to the next tool call (host re-reads settings on every execute).'),
    React.createElement('div', { style: rowStyle },
      React.createElement('label', { htmlFor: 'godot-executable' }, 'godot executable'),
      React.createElement('input', {
        id: 'godot-executable', value: executable, disabled,
        onChange: (e) => setExecutable(e.target.value), style: inputStyle,
      })),
    React.createElement('div', { style: rowStyle },
      React.createElement('label', { htmlFor: 'godot-gdformat' }, 'gdformat executable'),
      React.createElement('input', {
        id: 'godot-gdformat', value: gdformat, disabled,
        onChange: (e) => setGdformat(e.target.value), style: inputStyle,
      })),
    React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
      React.createElement('button', {
        disabled: disabled || !dirty,
        onClick: () => {
          void props.scope.set('executable', executable)
          void props.scope.set('gdformatExecutable', gdformat)
        },
      }, 'Save'),
      React.createElement('button', {
        disabled: disabled,
        onClick: () => {
          setExecutable(value.executable ?? '')
          setGdformat(value.gdformatExecutable ?? '')
        },
      }, 'Discard')),
  )
}

/** godot_debug 工具调用卡：身份 + 参数摘要（block 结构以运行时为准）。 */
function GodotDebugRow(owner) {
  const title = `${owner.toolName} call ${owner.callId}`
  const body = owner.cwd !== undefined ? `cwd: ${owner.cwd}` : ''
  return React.createElement(
    'div',
    { style: { padding: '8px 12px', fontFamily: 'var(--dsw-font-mono)', fontSize: '12px' } },
    React.createElement('div', null, title),
    body === '' ? null : React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, body),
  )
}
