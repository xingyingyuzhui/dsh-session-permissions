import {
  PRESET_IDS,
  TOOL_IDS,
  applyPreset,
  clampPolicy,
  isToolEnabled,
  normalizePolicy,
  optionAllowed,
  toggleTool,
} from './perm-schema.mjs'

const PRESET_LABEL = {
  full: 'full',
  research: 'research',
  developer: 'developer',
  reviewer: 'reviewer',
  release: 'release',
  public: 'public',
}

export function createPermissionPage(React, t, post, toast, subscribeLocale) {
  return function PermissionPage(props) {
    const el = React.createElement
    const [, setLocaleTick] = React.useState(0)
    React.useEffect(() => {
      if (typeof subscribeLocale !== 'function') return undefined
      return subscribeLocale(() => setLocaleTick((n) => n + 1))
    }, [subscribeLocale])
    const sessionId = props && props.sessionId
    const cwd = props && props.useSessions
      ? props.useSessions((s) => (s.byId && sessionId && s.byId[sessionId] && s.byId[sessionId].cwd) || '')
      : ''
    const [ceiling, setCeiling] = React.useState(null)
    const [claw, setClaw] = React.useState(false)
    const [policy, setPolicy] = React.useState(null)
    const [busy, setBusy] = React.useState(false)

    const applyLayers = React.useCallback((data) => {
      setCeiling(data.ceiling || null)
      setClaw(!!data.claw || !!(data.agent && data.agent.agentId))
      const next = data.session || data.effective
      setPolicy(next ? normalizePolicy(next) : null)
    }, [])

    const load = React.useCallback(() => {
      if (!sessionId) return Promise.resolve()
      return post('/dsh-session-permissions/read', { sessionId, cwd }).then((data) => {
        applyLayers(data)
      }).catch((err) => toast(String(err.message || t('fail'))))
    }, [sessionId, cwd, applyLayers])

    React.useEffect(() => { load() }, [load])

    function setClamped(next) {
      setPolicy(ceiling ? clampPolicy(next, ceiling) : normalizePolicy(next))
    }

    function save() {
      if (!sessionId || !policy) return
      setBusy(true)
      post('/dsh-session-permissions/write', { sessionId, cwd, policy }).then((data) => {
        applyLayers(data)
        toast(t('saved'))
      }).catch((err) => toast(String(err.message || t('fail')))).finally(() => setBusy(false))
    }

    function reset() {
      if (!sessionId) return
      setBusy(true)
      post('/dsh-session-permissions/reset', { sessionId, cwd }).then((data) => {
        applyLayers(data)
      }).catch((err) => toast(String(err.message || t('fail')))).finally(() => setBusy(false))
    }

    function field(label, control, span) {
      return el('div', { className: 'dsp-perm-item', 'data-span': span ? '2' : undefined },
        el('div', { className: 'dsp-perm-k' }, label),
        control,
      )
    }

    function segs(value, options, onChange) {
      return el('div', { className: 'dsp-segs' }, options.map((opt) => el('button', {
        key: opt.id,
        type: 'button',
        className: 'dsp-seg',
        'data-on': value === opt.id ? 'true' : undefined,
        disabled: !!opt.disabled,
        onClick() { if (!opt.disabled) onChange(opt.id) },
      }, opt.label)))
    }

    function faceOptions(face, ids, labels) {
      return ids.map((id) => ({
        id,
        label: labels[id],
        disabled: ceiling ? !optionAllowed(ceiling, face, id) : false,
      }))
    }

    if (!policy) {
      return el('div', { className: 'dsp-page' })
    }

    return el('div', { className: 'dsp-page' },
      el('div', { className: 'dsp-perm-grid' },
        field(t('template'), segs(policy.preset, (claw ? PRESET_IDS.filter((id) => id !== 'full') : PRESET_IDS).map((id) => ({ id, label: t(PRESET_LABEL[id]) })), (id) => {
          setClamped(applyPreset(id))
        }), true),
        field(t('filesRead'), segs(policy.files.read, faceOptions('files.read', ['none', 'workspace', 'all'], {
          none: t('none'),
          workspace: t('workspace'),
          all: t('all'),
        }), (id) => setClamped({ ...policy, files: { ...policy.files, read: id } }))),
        field(t('filesWrite'), segs(policy.files.write, faceOptions('files.write', ['none', 'workspace', 'all'], {
          none: t('none'),
          workspace: t('workspace'),
          all: t('all'),
        }), (id) => setClamped({ ...policy, files: { ...policy.files, write: id } }))),
        field(t('shell'), segs(policy.shell, faceOptions('shell', ['deny', 'allowlist', 'allow'], {
          deny: t('deny'),
          allowlist: t('allowlist'),
          allow: t('allow'),
        }), (id) => setClamped({ ...policy, shell: id }))),
        field(t('approval'), segs(policy.approval, faceOptions('approval', ['never', 'ask-external', 'ask-always'], {
          never: t('never'),
          'ask-external': t('askExternal'),
          'ask-always': t('askAlways'),
        }), (id) => setClamped({ ...policy, approval: id }))),
        field(t('mcp'), segs(policy.mcp, faceOptions('mcp', ['none', 'explicit', 'init-defaults'], {
          none: t('mcpNone'),
          explicit: t('mcpExplicit'),
          'init-defaults': t('mcpInit'),
        }), (id) => setClamped({ ...policy, mcp: id }))),
        field(t('delegation'), el('input', {
          className: 'dsp-num',
          type: 'number',
          min: 0,
          max: ceiling ? ceiling.delegation.maxDepth : 8,
          value: policy.delegation.maxDepth,
          onChange(e) {
            setClamped({ ...policy, delegation: { maxDepth: e.target.value } })
          },
        })),
        field(t('tools'), el('div', { className: 'dsp-cards' }, TOOL_IDS.map((id) => {
          const locked = ceiling ? !isToolEnabled(ceiling, id) : false
          const on = isToolEnabled(policy, id)
          return el('button', {
            key: id,
            type: 'button',
            className: 'dsp-tile',
            disabled: locked,
            onClick() {
              if (locked) return
              setClamped(toggleTool(policy, id, !on))
            },
          },
            el('span', { className: 'dsp-tile-lead' },
              el('span', { className: 'dsp-tile-title' }, t('tool_' + id)),
              el('span', {
                className: 'dsp-hint',
                tabIndex: 0,
                'data-tip': t('toolhint_' + id),
                'aria-label': t('toolhint_' + id),
                onClick(e) { e.preventDefault(); e.stopPropagation() },
                onKeyDown(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation() } },
              }, '!'),
            ),
            el('span', { className: 'dsp-tag', 'data-on': on ? 'true' : 'false' }, on ? t('on') : t('off')),
          )
        })), true),
      ),
      el('div', { className: 'dsp-actions' },
        el('button', { type: 'button', className: 'dsp-btn', disabled: busy, onClick: save }, t('save')),
        el('button', { type: 'button', className: 'dsp-btn', disabled: busy, onClick: reset }, t('reset')),
      ),
    )
  }
}
