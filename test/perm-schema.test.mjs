import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  allowTool,
  applyPreset,
  clampClawPolicy,
  clampPolicy,
  classifyTool,
  clawHardCap,
  intersectPolicies,
  isSessionId,
  isToolEnabled,
  maxPolicy,
  normalizePolicy,
  officialPolicyFromPreset,
  optionAllowed,
  toggleTool,
  workspaceAccessOf,
} from '../perm-schema.mjs'
import { allowExecution, isPathInside } from '../perm-path.mjs'
import { loadPolicy, resetPolicy, savePolicy } from '../perm-store.mjs'
import {
  composeLayers,
  denyReason,
  officialNameFromEvents,
  officialNameFromYaml,
  resolveLayersSync,
} from '../perm-layers.mjs'
import { officialApprovalOf, officialSandboxOf } from '../perm-schema.mjs'
import { officialPin, askReason } from '../perm-official.mjs'
import { apply, inject, name } from '../host.js'
import { _internal } from '../host.js'

test('session ids and research default', () => {
  assert.equal(isSessionId('session-9966e296-bb47-4200-a90e-9e635b219ede'), true)
  assert.equal(isSessionId('nope'), false)
  const policy = normalizePolicy({})
  assert.equal(policy.preset, 'research')
  assert.equal(policy.files.write, 'none')
  assert.equal(policy.enforced, false)
  assert.equal(isToolEnabled(policy, 'bash'), false)
})

test('applyPreset and toggleTool are independent faces', () => {
  const dev = applyPreset('developer')
  assert.equal(dev.files.write, 'workspace')
  assert.equal(isToolEnabled(dev, 'bash'), true)
  const off = toggleTool(dev, 'bash', false)
  assert.equal(isToolEnabled(off, 'bash'), false)
  assert.equal(off.files.write, 'workspace')
})

test('tighter-wins intersection and official mapping', () => {
  const official = officialPolicyFromPreset('danger-full-access')
  const agent = applyPreset('research')
  const ceiling = intersectPolicies(official, agent)
  assert.equal(ceiling.files.write, 'none')
  assert.equal(ceiling.shell, 'deny')
  assert.equal(isToolEnabled(ceiling, 'bash'), false)
  assert.equal(isToolEnabled(ceiling, 'read'), true)
  assert.equal(intersectPolicies(officialPolicyFromPreset('read-only'), applyPreset('developer')).files.write, 'none')
  assert.equal(optionAllowed(ceiling, 'shell', 'allow'), false)
  assert.equal(optionAllowed(ceiling, 'shell', 'deny'), true)
  assert.equal(optionAllowed(ceiling, 'files.write', 'workspace'), false)
  const clamped = clampPolicy(applyPreset('developer'), ceiling)
  assert.equal(clamped.files.write, 'none')
  assert.equal(isToolEnabled(clamped, 'bash'), false)
  assert.equal(allowTool(ceiling, 'bash'), false)
  assert.equal(allowTool(ceiling, 'read_file'), true)
  assert.equal(allowTool(official, 'bash'), true)
  assert.equal(allowTool(official, 'deploy'), true)
  assert.deepEqual(official.tools.deny, [])
  assert.equal(classifyTool('apply_patch'), 'apply_patch')
})

test('unsaved session inherits the ceiling instead of fake research', () => {
  const official = officialPolicyFromPreset('danger-full-access')
  const inherited = composeLayers({ officialName: 'danger-full-access', agent: null, sessionRecord: { source: 'inherit', policy: null } })
  assert.equal(inherited.inherited, true)
  assert.equal(inherited.session.shell, official.shell)
  assert.equal(inherited.effective.shell, 'allow')
  const claw = composeLayers({
    officialName: 'danger-full-access',
    agent: { agentId: 'wa_1', title: 'test1', preset: 'research', policy: applyPreset('research') },
    sessionRecord: { source: 'inherit', policy: null },
  })
  assert.equal(claw.ceiling.files.write, 'none')
  assert.equal(claw.ceiling.preset, 'research')
  assert.equal(claw.session.files.write, 'none')
  const override = composeLayers({
    officialName: 'danger-full-access',
    agent: { agentId: 'wa_1', title: 'test1', preset: 'research', policy: applyPreset('research') },
    sessionRecord: { source: 'session', policy: applyPreset('developer') },
  })
  assert.equal(override.inherited, false)
  assert.equal(override.session.files.write, 'none')
  assert.equal(override.effective.shell, 'deny')
})

test('claw agents and sessions cannot reach danger-full-access', () => {
  const cap = clawHardCap()
  assert.equal(cap.shell, 'allowlist')
  assert.equal(isToolEnabled(cap, 'deploy'), true)
  assert.equal(optionAllowed(cap, 'shell', 'allow'), false)
  assert.equal(optionAllowed(cap, 'files.read', 'all'), true)
  assert.equal(optionAllowed(cap, 'files.write', 'all'), true)
  assert.equal(cap.files.read, 'all')
  assert.equal(cap.files.write, 'all')
  const wide = officialPolicyFromPreset('danger-full-access')
  const clamped = clampClawPolicy(wide)
  assert.equal(clamped.shell, 'allowlist')
  assert.equal(isToolEnabled(clamped, 'deploy'), true)
  assert.notEqual(clamped.approval, 'never')
  const clawWide = composeLayers({
    officialName: 'danger-full-access',
    claw: true,
    agent: {
      agentId: 'wa_1',
      title: 'test1',
      preset: 'developer',
      policy: wide,
    },
    sessionRecord: { source: 'session', policy: wide },
  })
  assert.equal(clawWide.claw, true)
  assert.equal(clawWide.ceiling.shell, 'allowlist')
  assert.equal(clawWide.session.shell, 'allowlist')
  assert.equal(isToolEnabled(clawWide.effective, 'deploy'), true)
  const clawPathOnly = composeLayers({
    officialName: 'danger-full-access',
    claw: true,
    agent: null,
    sessionRecord: { source: 'inherit', policy: null },
  })
  assert.equal(clawPathOnly.ceiling.shell, 'allowlist')
  const workspace = composeLayers({
    officialName: 'workspace-write',
    claw: false,
    agent: null,
    sessionRecord: { source: 'inherit', policy: null },
  })
  assert.equal(workspace.ceiling.preset, 'full')
  assert.equal(workspace.ceiling.shell, 'allow')
  assert.equal(workspace.ceiling.files.read, 'all')
  assert.equal(workspace.session.approval, 'never')
  assert.equal(isToolEnabled(workspace.effective, 'deploy'), true)
})

test('editor view is read; paths stay inside the workspace unless files are all', () => {
  assert.equal(classifyTool('str_replace_editor', { command: 'view' }), 'read')
  assert.equal(classifyTool('str_replace_editor', { command: 'create' }), 'write')
  assert.equal(classifyTool('str_replace_editor', { command: 'str_replace' }), 'edit')
  const research = applyPreset('research')
  const root = '/Users/qin/.dsh/DSclaw/test1'
  assert.equal(workspaceAccessOf(research), 'ro')
  assert.equal(workspaceAccessOf(applyPreset('developer')), 'rw')
  assert.equal(workspaceAccessOf(maxPolicy()), 'all')
  const writeChild = { files: { read: 'all', write: 'workspace' } }
  assert.equal(workspaceAccessOf(writeChild), 'all')
  assert.equal(workspaceAccessOf(writeChild, 'read'), 'all')
  assert.equal(workspaceAccessOf(writeChild, 'write'), 'rw')
  assert.equal(workspaceAccessOf(writeChild, 'edit'), 'rw')
  assert.equal(isPathInside(root, root + '/AGENTS.md'), true)
  assert.equal(isPathInside(root, '/Users/qin/Desktop'), false)
  assert.equal(allowExecution(research, 'str_replace_editor', { command: 'view', path: root + '/AGENTS.md' }, root), true)
  assert.equal(allowExecution(research, 'str_replace_editor', { command: 'view', path: '/Users/qin/Desktop' }, root), false)
  assert.equal(allowExecution(research, 'str_replace_editor', { command: 'create', path: root + '/SESSION_LOG.md' }, root), false)
  assert.equal(allowExecution(research, 'bash', { command: 'ls ~/Desktop' }, root), false)
  const developer = applyPreset('developer')
  assert.equal(allowExecution(developer, 'bash', { command: 'ls' }, root), true)
  assert.equal(allowExecution(developer, 'bash', { command: 'ls AGENTS.md' }, root), true)
  assert.equal(allowExecution(developer, 'bash', { command: 'ls -la ~/Desktop 2>/dev/null' }, root), false)
  assert.equal(allowExecution(developer, 'bash', { command: 'ls -la $HOME/Desktop' }, root), false)
  assert.equal(allowExecution(developer, 'bash', { command: 'cat > ~/Desktop/note.md << EOF\nhi\nEOF' }, root), false)
  assert.equal(allowExecution(developer, 'bash', { command: 'echo hi > ./ok.md' }, root), true)
  assert.equal(allowExecution(maxPolicy(), 'str_replace_editor', { command: 'view', path: '/Users/qin/Desktop' }, root), true)
})

test('claw pins official sandbox down and asks only when policy says so', () => {
  const root = '/Users/qin/.dsh/DSclaw/test1'
  assert.equal(officialSandboxOf(applyPreset('research')), 'read-only')
  assert.equal(officialSandboxOf(applyPreset('developer')), 'workspace-write')
  assert.equal(officialSandboxOf(maxPolicy()), 'danger-full-access')
  assert.equal(officialSandboxOf(clawHardCap()), 'workspace-write')
  assert.equal(officialApprovalOf(applyPreset('developer')), 'ask')
  const claw = composeLayers({
    officialName: 'danger-full-access',
    claw: true,
    agent: { agentId: 'wa_1', title: 'test1', preset: 'research', policy: applyPreset('research') },
    sessionRecord: { source: 'inherit', policy: null },
  })
  const first = officialPin(claw, [{ type: 'sandbox/mode', data: { mode: 'danger-full-access' } }, { type: 'approval/policy', data: { policy: 'never' } }])
  assert.equal(first.sandbox, 'read-only')
  assert.equal(first.approval, 'ask')
  const again = officialPin(claw, [{ type: 'sandbox/mode', data: { mode: 'read-only' } }])
  assert.equal(again.sandbox, null)
  const workspace = composeLayers({
    officialName: 'danger-full-access',
    claw: false,
    agent: null,
    sessionRecord: { source: 'inherit', policy: null },
  })
  assert.equal(officialPin(workspace, []).sandbox, null)
  assert.equal(askReason(applyPreset('research'), 'bash', {}, root), undefined)
  assert.match(askReason(applyPreset('developer'), 'bash', {}, root), /bash/)
  assert.equal(askReason(applyPreset('developer'), 'read', { path: root + '/AGENTS.md' }, root), undefined)
})

test('savePolicy round-trips a session override', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsp-'))
  const id = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const first = await loadPolicy(dir, id)
  assert.equal(first.source, 'inherit')
  assert.equal(first.policy, null)
  const saved = await savePolicy(dir, id, applyPreset('developer'))
  assert.equal(saved.source, 'session')
  assert.equal(saved.policy.shell, 'allowlist')
  const loaded = await loadPolicy(dir, id)
  assert.equal(loaded.policy.preset, 'developer')
  const reset = await resetPolicy(dir, id)
  assert.equal(reset.source, 'inherit')
  assert.equal(reset.policy, null)
})

test('official name from yaml and session events', () => {
  assert.equal(officialNameFromYaml('permission:\n  defaultPreset: workspace-write\n'), 'workspace-write')
  assert.equal(officialNameFromYaml('ui:\n  x: 1\npermission:\n  defaultPreset: danger-full-access\n'), 'danger-full-access')
  assert.equal(officialNameFromEvents([
    { type: 'permission/preset', data: { preset: 'workspace-write' } },
    { type: 'permission/preset', data: { preset: 'danger-full-access' } },
  ], 'workspace-write'), 'danger-full-access')
})

test('resolveLayersSync and denyReason use the intersection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsp-'))
  await writeFile(join(dir, 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n')
  await mkdir(join(dir, 'workspace-agents'), { recursive: true })
  await mkdir(join(dir, 'DSclaw', 'test1'), { recursive: true })
  await writeFile(join(dir, 'workspace-agents', 'registry.json'), JSON.stringify({
    version: 1,
    agents: {
      wa_1: {
        agentId: 'wa_1',
        title: 'test1',
        preset: 'research',
        dshPreset: 'wa-test1',
        canonicalRoot: join(dir, 'DSclaw', 'test1'),
        status: 'active',
      },
    },
  }))
  const sessionId = 'session-bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
  const layers = resolveLayersSync(dir, {
    sessionId,
    cwd: join(dir, 'DSclaw', 'test1'),
  })
  assert.equal(layers.inherited, true)
  assert.equal(layers.agent.title, 'test1')
  assert.equal(layers.effective.shell, 'deny')
  const exec = {
    name: 'bash',
    agent: { session: { id: sessionId, header: { cwd: join(dir, 'DSclaw', 'test1') }, events: [] } },
  }
  assert.match(denyReason(dir, exec), /bash/)
  assert.equal(denyReason(dir, { name: 'read_file', agent: exec.agent }), undefined)
})

test('denied skills are refused by name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsp-skill-'))
  await writeFile(join(dir, 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n')
  await mkdir(join(dir, 'workspace-agents'), { recursive: true })
  await mkdir(join(dir, 'DSclaw', 'test1'), { recursive: true })
  await writeFile(join(dir, 'workspace-agents', 'registry.json'), JSON.stringify({
    version: 1,
    agents: {
      wa_1: {
        agentId: 'wa_1',
        title: 'test1',
        preset: 'research',
        dshPreset: 'wa-test1',
        canonicalRoot: join(dir, 'DSclaw', 'test1'),
        status: 'active',
        policy: { preset: 'research', skills: { deny: ['pdf'] } },
      },
    },
  }))
  const sessionId = 'session-cccccccc-dddd-eeee-ffff-000000000000'
  const exec = {
    name: 'skill',
    arguments: { name: 'pdf' },
    agent: { session: { id: sessionId, header: { cwd: join(dir, 'DSclaw', 'test1') }, events: [] } },
  }
  assert.match(denyReason(dir, exec), /skill/)
  assert.equal(denyReason(dir, { ...exec, arguments: { name: 'docx' } }), undefined)
})

test('host named exports and routes', () => {
  assert.equal(name, 'dsh-session-permissions')
  assert.deepEqual(inject, ['webServer', 'systemPrompt'])
  const routes = []
  apply({
    webServer: { register(entry) { routes.push(entry); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    effect() {},
  })
  assert.deepEqual(routes.map((row) => row.path), [
    '/dsh-session-permissions/read',
    '/dsh-session-permissions/write',
    '/dsh-session-permissions/reset',
  ])
  _internal.setDshHome(tmpdir())
})
