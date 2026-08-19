import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyPreset } from '../perm-schema.mjs'
import { allowExecution, hatchActive, hatchOfficialSandbox } from '../perm-path.mjs'
import { composeLayers } from '../perm-layers.mjs'
import { officialPin } from '../perm-official.mjs'

test('hatch allows identity writes and ask_user while BOOTSTRAP.md exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsp-hatch-'))
  const root = join(home, 'DSclaw', 'bot1')
  await mkdir(root, { recursive: true })
  const research = applyPreset('research')
  assert.equal(hatchActive(root), false)
  assert.equal(allowExecution(research, 'write', { path: join(root, 'IDENTITY.md') }, root), false)
  assert.equal(allowExecution(research, 'ask_user_question', {}, root), true)
  await writeFile(join(root, 'BOOTSTRAP.md'), 'ask\n')
  assert.equal(hatchActive(root), true)
  assert.equal(allowExecution(research, 'write', { path: join(root, 'IDENTITY.md') }, root), true)
  assert.equal(allowExecution(research, 'write', { path: 'USER.md' }, root), true)
  assert.equal(allowExecution(research, 'write', { path: join(root, 'SOUL.md') }, root), true)
  assert.equal(allowExecution(research, 'write', { path: join(root, 'BOOTSTRAP.md') }, root), true)
  assert.equal(allowExecution(research, 'write', { path: join(root, 'SESSION_LOG.md') }, root), false)
  assert.equal(allowExecution(research, 'write', { path: join(root, 'AGENTS.md') }, root), false)
  assert.equal(allowExecution(research, 'bash', { command: 'rm BOOTSTRAP.md' }, root), false)
})

test('hatch pins official sandbox to workspace-write then can tighten after', async () => {
  assert.equal(hatchOfficialSandbox('read-only'), 'workspace-write')
  assert.equal(hatchOfficialSandbox('workspace-write'), 'workspace-write')
  const home = await mkdtemp(join(tmpdir(), 'dsp-hatch-pin-'))
  const root = join(home, 'DSclaw', 'bot1')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'BOOTSTRAP.md'), 'ask\n')
  const layers = {
    ...composeLayers({
      officialName: 'danger-full-access',
      claw: true,
      agent: { agentId: 'wa_1', title: 'bot1', preset: 'research', canonicalRoot: root, policy: applyPreset('research') },
      sessionRecord: { source: 'inherit', policy: null },
    }),
    cwd: root,
  }
  const first = officialPin(layers, [{ type: 'sandbox/mode', data: { mode: 'danger-full-access' } }])
  assert.equal(first.sandbox, 'workspace-write')
})
