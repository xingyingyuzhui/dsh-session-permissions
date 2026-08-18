import { classifyTool, officialApprovalOf, officialSandboxOf, tighterSandbox } from './perm-schema.mjs'
import { extractPaths, isPathInside, resolveTarget } from './perm-path.mjs'

export function lastEventData(events, type) {
  if (!Array.isArray(events)) return undefined
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event && event.type === type) return event.data
  }
  return undefined
}

export function officialPin(layers, events) {
  if (!layers || !layers.claw) return { sandbox: null, approval: null }
  const currentSandbox = lastEventData(events, 'sandbox/mode')
  const wantedSandbox = officialSandboxOf(layers.effective)
  const nextSandbox = tighterSandbox(wantedSandbox, currentSandbox && currentSandbox.mode)
  const sandbox = nextSandbox && nextSandbox !== (currentSandbox && currentSandbox.mode) ? nextSandbox : null
  const currentApproval = lastEventData(events, 'approval/policy')
  const wantedApproval = officialApprovalOf(layers.effective)
  const approval = wantedApproval === 'ask' && (!currentApproval || currentApproval.policy !== 'ask')
    ? 'ask'
    : null
  return { sandbox, approval }
}

export function applyOfficialPin(session, layers) {
  if (!session || typeof session.append !== 'function') return officialPin(layers, [])
  const plan = officialPin(layers, session.events)
  if (plan.sandbox) session.append('sandbox/mode', { mode: plan.sandbox })
  if (plan.approval) session.append('approval/policy', { policy: plan.approval })
  return plan
}

export function renderPolicyPrompt(policy) {
  if (!policy || !policy.files) return ''
  const read = policy.files.read
  const write = policy.files.write
  const shell = policy.shell
  const readLabel = { none: '无', workspace: '仅当前工作区', all: '全部' }
  const writeLabel = { none: '无', workspace: '仅当前工作区', all: '全部' }
  const shellLabel = { deny: '禁止', allowlist: '仅工作区内', allow: '无限制' }
  const lines = [
    '# 本会话权限天花板',
    '',
    '三层由紧到松：工具名单 → 路径边界 → 审批。被拒绝的不要重试、不要换写法绕过。',
    '工作区外的写入直接拒绝，不走审批。',
    '',
    '- 文件读：' + (readLabel[read] || read),
    '- 文件写：' + (writeLabel[write] || write),
    '- 终端：' + (shellLabel[shell] || shell),
  ]
  if (shell === 'deny') {
    lines.push('', '不要调用终端/bash。只读会话连终端一起关。')
  } else if (read !== 'all' || write !== 'all') {
    lines.push('', '终端若开启，工作区外的路径仍按文件读/写边界拦截，不是审批。')
  }
  if (read !== 'all') lines.push('不要读取桌面、家目录或其他 Agent 工作区。')
  if (write !== 'all') lines.push('不要在工作区外新建或改文件。')
  return lines.join('\n')
}

export function renderDenyReceipt(cls, extra) {
  const kind = String(cls || 'tool').trim() || 'tool'
  const note = typeof extra === 'string' ? extra.trim() : ''
  const parts = [
    'BLOCKED: denied by session capability ceiling (' + kind + ').',
    note,
    'Do not retry this call, do not rephrase it, and do not use another tool to reach the same path or effect.',
    'Stay inside the session capability ceiling. If the task needs more access, tell the user — do not probe.',
  ]
  return parts.filter(Boolean).join(' ')
}

export function askReason(policy, name, args, cwd) {
  if (!policy) return undefined
  if (policy.approval === 'never') return undefined
  const cls = classifyTool(name, args)
  if (policy.approval === 'ask-always') {
    if (cls === 'read') return undefined
    return 'Approval required by session policy (' + cls + ').'
  }
  if (cls === 'bash' || cls === 'deploy') {
    return 'Approval required for external or privileged tool (' + cls + ').'
  }
  const paths = extractPaths(args)
  if (cls !== 'read' && paths.some((item) => {
    const target = resolveTarget(cwd, item)
    return target && cwd && !isPathInside(cwd, target)
  })) {
    return 'Approval required for a path outside the workspace.'
  }
  return undefined
}
