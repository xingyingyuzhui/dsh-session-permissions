import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyPreset } from '../perm-schema.mjs'
import { allowExecution, extractBashPaths, looksLikeBashWrite, looksLikeDsClaw, sameRoot } from '../perm-path.mjs'
import { askReason, officialPin, renderDenyReceipt, renderPolicyPrompt } from '../perm-official.mjs'
import { composeLayers, denyReason, loadAgentHintSync, resolveLayersSync } from '../perm-layers.mjs'

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

test('two Claw agents keep separate policy and cannot write each other', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsp-acc-'))
  const { a, b } = await twoAgents(home)
  const layersA = resolveLayersSync(home, { sessionId: 's-a', cwd: a })
  const layersB = resolveLayersSync(home, { sessionId: 's-b', cwd: b })
  assert.equal(layersA.agent.agentId, 'wa_a')
  assert.equal(layersB.agent.agentId, 'wa_b')
  assert.notEqual(layersA.effective.preset, layersB.effective.preset)
  assert.equal(allowExecution(layersA.effective, 'write', { path: join(a, 'out.md') }, a), true)
  assert.equal(allowExecution(layersA.effective, 'write', { path: join(b, 'out.md') }, a), false)
  assert.equal(allowExecution(layersB.effective, 'write', { path: join(b, 'out.md') }, b), false)
  const research = {
    name: 'bash',
    agent: { session: { id: 's-b', header: { cwd: b }, events: [] } },
  }
  assert.match(denyReason(home, research), /bash/)
  assert.match(denyReason(home, research), /BLOCKED/)
  assert.match(denyReason(home, research), /Do not retry/)
  assert.match(denyReason(home, { name: 'write', arguments: { path: join(b, 'x.md') }, agent: research.agent }), /write|edit/)
})

test('deny receipts tell the model not to retry or rephrase', () => {
  const text = renderDenyReceipt('bash', 'Terminal is off for this session.')
  assert.match(text, /^BLOCKED:/)
  assert.match(text, /bash/)
  assert.match(text, /Do not retry this call/)
  assert.match(text, /do not rephrase/)
  assert.match(text, /do not use another tool/)
  assert.match(text, /do not probe/)
})

test('symlink cwd still binds the same agent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsp-link-'))
  const { a } = await twoAgents(home)
  const alias = join(home, 'alias-alpha')
  await symlink(a, alias)
  assert.equal(sameRoot(a, alias), true)
  assert.equal(looksLikeDsClaw(alias), true)
  const hint = loadAgentHintSync(home, { cwd: alias })
  assert.equal(hint.agentId, 'wa_a')
  const layers = resolveLayersSync(home, { sessionId: 's-alias', cwd: alias })
  assert.equal(layers.claw, true)
  assert.equal(layers.agent.agentId, 'wa_a')
})

test('approval is per call; a different command still asks', () => {
  const cwd = '/Users/qin/.dsh/DSclaw/dev'
  const policy = applyPreset('developer')
  const first = askReason(policy, 'bash', { command: 'ls' }, cwd)
  const second = askReason(policy, 'bash', { command: 'rm -rf /' }, cwd)
  const third = askReason(policy, 'write', { path: '/etc/passwd' }, cwd)
  assert.match(first, /bash/)
  assert.match(second, /bash/)
  assert.match(third, /outside/)
  assert.match(askReason(policy, 'bash', { command: 'ls' }, cwd), /bash/)
})

test('workspace-only read denies ls Desktop at the policy layer, not via approval', () => {
  const cwd = '/Users/qin/.dsh/DSclaw/test1'
  const policy = applyPreset('developer')
  assert.equal(policy.files.read, 'workspace')
  assert.ok(looksLikeBashWrite('cat > ~/Desktop/a.md << EOF'))
  assert.equal(looksLikeBashWrite('ls -la ~/Desktop 2>/dev/null'), false)
  assert.ok(extractBashPaths('ls -la ~/Desktop 2>/dev/null').some((item) => item.indexOf('Desktop') >= 0))
  assert.equal(allowExecution(policy, 'bash', { command: 'ls -la ~/Desktop 2>/dev/null' }, cwd), false)
  assert.equal(allowExecution(policy, 'bash', { command: 'ls -la /Users/qin/Desktop' }, cwd), false)
  assert.match(renderPolicyPrompt(policy), /仅当前工作区/)
  assert.match(renderPolicyPrompt(policy), /不要读取桌面/)
  assert.match(renderPolicyPrompt(policy), /三层/)
  assert.match(renderPolicyPrompt(policy), /不走审批/)
})

test('workspace Desktop sessions do not go through the suite whitelist', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsp-ws-acc-'))
  const { b } = await twoAgents(home)
  const desktop = join(home, 'Desktop', 'test2')
  await mkdir(desktop, { recursive: true })
  const sessionId = 'session-ffffffff-0000-1111-2222-333333333333'
  const workspace = {
    name: 'pwsh',
    arguments: { command: 'Get-ChildItem' },
    agent: { session: { id: sessionId, header: { cwd: desktop, agentPreset: 'standard' }, events: [] } },
  }
  assert.equal(resolveLayersSync(home, { sessionId, cwd: desktop, preset: 'standard' }).claw, false)
  assert.equal(denyReason(home, workspace), undefined)
  assert.equal(denyReason(home, { name: 'web_search', arguments: { query: 'dsh' }, agent: workspace.agent }), undefined)
  assert.match(denyReason(home, {
    name: 'pwsh',
    arguments: { command: 'Get-ChildItem' },
    agent: { session: { id: 's-b', header: { cwd: b }, events: [] } },
  }), /bash/)
})

test('pinning a claw session cannot open danger-full-access', () => {
  const claw = composeLayers({
    officialName: 'danger-full-access',
    claw: true,
    agent: { agentId: 'wa_1', title: 'test1', preset: 'developer', policy: applyPreset('developer') },
    sessionRecord: { source: 'inherit', policy: null },
  })
  const pin = officialPin(claw, [{ type: 'sandbox/mode', data: { mode: 'danger-full-access' } }])
  assert.equal(pin.sandbox, 'workspace-write')
  assert.notEqual(pin.sandbox, 'danger-full-access')
})
