import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyPreset, tighterSandbox } from '../perm-schema.mjs'
import { allowExecution, looksLikeDsClaw, sameRoot } from '../perm-path.mjs'
import { askReason, officialPin, renderDenyReceipt } from '../perm-official.mjs'
import { composeLayers, denyReason, loadAgentHintSync, resolveLayersSync } from '../perm-layers.mjs'
import { apply as applyGate } from '../../dsh-agent-gate/host.js'
import { fallbackMissingPreset } from '../../dsh-agent-registry/registry-presets.mjs'

async function twoAgents(home) {
  const a = join(home, 'DSclaw', 'alpha')
  const b = join(home, 'DSclaw', 'beta')
  await mkdir(join(home, 'workspace-agents'), { recursive: true })
  await mkdir(a, { recursive: true })
  await mkdir(b, { recursive: true })
  await writeFile(join(home, 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n')
  await writeFile(join(home, 'workspace-agents', 'registry.json'), JSON.stringify({
    version: 1,
    agents: {
      wa_a: {
        agentId: 'wa_a',
        title: 'alpha',
        preset: 'developer',
        dshPreset: 'wa-alpha',
        canonicalRoot: a,
        status: 'active',
        policy: applyPreset('developer'),
      },
      wa_b: {
        agentId: 'wa_b',
        title: 'beta',
        preset: 'research',
        dshPreset: 'wa-beta',
        canonicalRoot: b,
        status: 'active',
        policy: applyPreset('research'),
      },
    },
  }))
  return { a, b }
}

test('checklist: two workspaces stay isolated', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gov-iso-'))
  const { a, b } = await twoAgents(home)
  const layersA = resolveLayersSync(home, { sessionId: 's-a', cwd: a })
  const layersB = resolveLayersSync(home, { sessionId: 's-b', cwd: b })
  assert.equal(layersA.agent.agentId, 'wa_a')
  assert.equal(layersB.agent.agentId, 'wa_b')
  assert.equal(allowExecution(layersA.effective, 'write', { path: join(a, 'out.md') }, a), true)
  assert.equal(allowExecution(layersA.effective, 'write', { path: join(b, 'out.md') }, a), false)
  assert.equal(allowExecution(layersB.effective, 'write', { path: join(b, 'out.md') }, b), false)
})

test('checklist: symlink cwd still binds the same agent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gov-link-'))
  const { a } = await twoAgents(home)
  const alias = join(home, 'alias-alpha')
  await symlink(a, alias)
  assert.equal(sameRoot(a, alias), true)
  assert.equal(looksLikeDsClaw(alias), true)
  assert.equal(loadAgentHintSync(home, { cwd: alias }).agentId, 'wa_a')
})

test('checklist: research cannot write or ls Desktop; deny says do not retry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gov-res-'))
  const { b } = await twoAgents(home)
  const layers = resolveLayersSync(home, { sessionId: 's-b', cwd: b })
  assert.equal(allowExecution(layers.effective, 'write', { path: join(b, 'x.md') }, b), false)
  assert.equal(allowExecution(layers.effective, 'bash', { command: 'ls ~/Desktop' }, b), false)
  const reason = denyReason(home, {
    name: 'bash',
    arguments: { command: 'ls ~/Desktop' },
    agent: { session: { id: 's-b', header: { cwd: b }, events: [] } },
  })
  assert.match(reason, /BLOCKED/)
  assert.match(reason, /Do not retry/)
  assert.match(renderDenyReceipt('bash'), /do not probe/)
})

test('checklist: approval is per call and pin cannot widen', () => {
  const cwd = '/Users/qin/.dsh/DSclaw/dev'
  const policy = applyPreset('developer')
  assert.match(askReason(policy, 'bash', { command: 'ls' }, cwd), /bash/)
  assert.match(askReason(policy, 'bash', { command: 'rm -rf /' }, cwd), /bash/)
  const claw = composeLayers({
    officialName: 'danger-full-access',
    claw: true,
    agent: { agentId: 'wa_1', title: 'test1', preset: 'developer', policy: applyPreset('developer') },
    sessionRecord: { source: 'inherit', policy: null },
  })
  const pin = officialPin(claw, [{ type: 'sandbox/mode', data: { mode: 'danger-full-access' } }])
  assert.equal(pin.sandbox, 'workspace-write')
  assert.equal(tighterSandbox('danger-full-access', 'read-only'), 'read-only')
})

test('checklist: MCP allow list is enforced and not tied to write/shell', () => {
  const research = applyPreset('research')
  assert.equal(allowExecution(research, 'mcp__github__search', {}, '/tmp'), true)
  assert.equal(allowExecution({ ...research, mcp: 'none' }, 'mcp__github__search', {}, '/tmp'), false)
  const explicit = { ...applyPreset('developer'), mcp: 'explicit', servers: { allow: ['github'], deny: [] } }
  assert.equal(allowExecution(explicit, 'mcp__github__search', {}, '/tmp'), true)
  assert.equal(allowExecution(explicit, 'mcp__slack__post', {}, '/tmp'), false)
})

test('checklist: missing claw preset falls back instead of breaking resume', () => {
  const live = new Set(['standard', 'wa-test1'])
  assert.equal(fallbackMissingPreset('wa-2e263a19-08cd-4274-b2af-42286f96b517', live), 'standard')
  assert.equal(fallbackMissingPreset('wa-test1', live), 'wa-test1')
})

test('checklist: unloading the gate restores skills', async () => {
  const origSnapshot = async () => ({ skills: [{ name: 'cad' }], complete: true })
  const origGet = async (name) => name
  const skills = { snapshot: origSnapshot, get: origGet }
  const events = {}
  let stop
  applyGate({
    tools: { guard() { return () => {} } },
    webServer: { register() { return () => {} } },
    skills,
    on(name, fn) {
      events[name] = fn
      return () => { delete events[name] }
    },
    effect(fn) { stop = fn() },
  })
  assert.notEqual(skills.snapshot, origSnapshot)
  stop()
  const snap = await skills.snapshot()
  assert.deepEqual(snap.skills.map((row) => row.name), ['cad'])
  assert.equal(events['tools/pre-execute'], undefined)
})

test('checklist: live web still serves registry and audit', async (t) => {
  const ping = async (path, header) => {
    const res = await fetch('http://127.0.0.1:3080' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [header]: '1' },
      body: '{}',
    })
    return res.status
  }
  let registry
  try {
    registry = await ping('/dsh-agent-registry/list', 'x-dsh-agent-registry')
  } catch {
    t.skip('dsh web is not listening')
    return
  }
  const audit = await ping('/dsh-agent-gate/audit', 'x-dsh-agent-gate')
  assert.notEqual(registry, 404)
  assert.notEqual(audit, 404)
  assert.ok(registry === 200 || registry === 403)
  assert.ok(audit === 200 || audit === 403)
})
