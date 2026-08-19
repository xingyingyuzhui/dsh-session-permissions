import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  asArgs,
  classifyTool,
  clawHardCap,
  clampClawPolicy,
  intersectPolicies,
  maxPolicy,
  normalizePolicy,
  officialPolicyFromPreset,
} from './perm-schema.mjs'
import { allowExecution, looksLikeDsClaw, sameRoot } from './perm-path.mjs'
import { emptyRecord, loadPolicySync } from './perm-store.mjs'
import { renderDenyReceipt } from './perm-official.mjs'

export function officialNameFromYaml(text) {
  const src = String(text || '')
  const patterns = [
    /(?:^|\n)permission:\s*\n(?:[ \t].*\n)*?[ \t]+defaultPreset:\s*([A-Za-z0-9._-]+)/,
    /(?:^|\n)permissionPresets:\s*\n(?:[ \t].*\n)*?[ \t]+defaultPreset:\s*([A-Za-z0-9._-]+)/,
  ]
  for (const re of patterns) {
    const match = src.match(re)
    if (match) return match[1]
  }
  return 'danger-full-access'
}

export function officialNameFromEvents(events, fallback) {
  let name = fallback || 'danger-full-access'
  if (!Array.isArray(events)) return name
  for (const event of events) {
    if (event && event.type === 'permission/preset' && event.data && typeof event.data.preset === 'string') {
      name = event.data.preset
    }
  }
  return name
}

export function readOfficialName(home, events) {
  let fallback = 'danger-full-access'
  try {
    fallback = officialNameFromYaml(readFileSync(join(home, 'settings.yaml'), 'utf8'))
  } catch { /* no settings file */ }
  return officialNameFromEvents(events, fallback)
}

function policyFromAgent(agent) {
  if (!agent) return null
  if (agent.policy) return normalizePolicy(agent.policy, agent.preset)
  try {
    if (agent.canonicalRoot) {
      return normalizePolicy(JSON.parse(readFileSync(join(agent.canonicalRoot, 'policy.json'), 'utf8')), agent.preset)
    }
  } catch { /* no per-agent file */ }
  return normalizePolicy({ preset: agent.preset || 'research' }, agent.preset)
}

export function loadAgentHintSync(home, query) {
  const cwd = query && query.cwd
  const preset = query && query.preset
  let registry
  try {
    registry = JSON.parse(readFileSync(join(home, 'workspace-agents', 'registry.json'), 'utf8'))
  } catch {
    return null
  }
  const rows = registry && registry.agents ? Object.values(registry.agents) : []
  let agent = null
  for (const row of rows) {
    if (!row || row.status === 'archived') continue
    if (cwd && (row.canonicalRoot === cwd || sameRoot(row.canonicalRoot, cwd))) {
      agent = row
      break
    }
  }
  if (!agent && preset) {
    agent = rows.find((row) => row && row.status !== 'archived' && row.dshPreset === preset) || null
  }
  if (!agent) return null
  return {
    agentId: agent.agentId,
    title: agent.title,
    preset: agent.preset || 'research',
    dshPreset: agent.dshPreset,
    canonicalRoot: agent.canonicalRoot,
    policy: policyFromAgent(agent),
  }
}

export function isClawContext(query, agent) {
  if (agent) return true
  if (query && query.claw === true) return true
  const cwd = query && query.cwd ? String(query.cwd) : ''
  if (looksLikeDsClaw(cwd)) return true
  const preset = query && query.preset ? String(query.preset) : ''
  return preset === 'wa-template' || preset.startsWith('wa-')
}

export function composeLayers({ officialName, agent, sessionRecord, claw }) {
  const official = officialPolicyFromPreset(officialName)
  const isClaw = claw === true || !!(agent && (agent.agentId || agent.policy))
  const rawAgent = agent && agent.policy ? normalizePolicy(agent.policy, agent.preset) : null
  const agentPolicy = isClaw && rawAgent ? clampClawPolicy(rawAgent) : rawAgent
  const hard = isClaw ? clawHardCap() : null
  const ceiling = hard
    ? { ...intersectPolicies(official, hard, agentPolicy || hard), preset: (agentPolicy || hard).preset }
    : { ...maxPolicy(), enforced: true }
  const inherited = !(sessionRecord && sessionRecord.source === 'session' && sessionRecord.policy)
  const session = inherited ? ceiling : intersectPolicies(normalizePolicy(sessionRecord.policy), ceiling)
  return {
    officialName: officialName || 'danger-full-access',
    official,
    agent: agent ? {
      agentId: agent.agentId,
      title: agent.title,
      preset: agent.preset,
      dshPreset: agent.dshPreset,
      policy: agentPolicy,
    } : null,
    claw: isClaw,
    ceiling,
    session,
    effective: session,
    inherited,
    enforced: true,
  }
}

export function resolveLayersSync(home, query) {
  const sessionId = query && query.sessionId
  const officialName = readOfficialName(home, query && query.events)
  const agent = loadAgentHintSync(home, query || {})
  const record = sessionId ? loadPolicySync(home, sessionId) : emptyRecord(sessionId || 'session-unknown')
  return {
    record,
    cwd: (query && query.cwd) || (agent && agent.canonicalRoot) || '',
    ...composeLayers({
      officialName,
      agent,
      sessionRecord: record,
      claw: isClawContext(query, agent),
    }),
  }
}

export function sessionFacts(ctx, sessionId, body) {
  let cwd = body && body.cwd
  let preset = body && body.preset
  let events
  try {
    const sessions = ctx && ctx.sessions
    const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
    if (session) {
      const header = session.header || {}
      cwd = header.cwd || cwd
      preset = header.agentPreset || preset
      events = session.events
    }
  } catch { /* sessions not ready */ }
  return { sessionId, cwd, preset, events }
}

export function denyReason(home, exec) {
  const session = exec && exec.agent && exec.agent.session
  if (!session || !session.id) return undefined
  const header = session.header || {}
  const layers = resolveLayersSync(home, {
    sessionId: session.id,
    cwd: header.cwd,
    preset: header.agentPreset,
    events: session.events,
  })
  if (String(exec.name || '').toLowerCase() === 'memory') return undefined
  if (String(exec.name || '').toLowerCase() === 'skill') {
    const denied = ((layers.effective && layers.effective.skills && layers.effective.skills.deny) || [])
    const skillName = asArgs(exec.arguments).name
    if (skillName && denied.indexOf(skillName) >= 0) {
      return renderDenyReceipt('skill', 'That skill is not allowed for this agent.')
    }
  }
  if (allowExecution(layers.effective, exec.name, exec.arguments, header.cwd)) return undefined
  const cls = classifyTool(exec.name, exec.arguments)
  const policy = layers.effective
  let extra = ''
  if (cls === 'bash' && policy && policy.shell === 'deny') extra = 'Terminal is off for this session.'
  else if (cls === 'mcp') extra = policy && policy.mcp === 'none'
    ? 'MCP is off for this session.'
    : 'This MCP server is not on the session allow list.'
  else if (policy && policy.files && (policy.files.read !== 'all' || policy.files.write !== 'all')) {
    extra = 'Paths outside this workspace (Desktop, home, other agents) are out of scope.'
  }
  return renderDenyReceipt(cls, extra)
}
