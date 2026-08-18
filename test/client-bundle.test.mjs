import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js')
const src = readFileSync(dest, 'utf8')

test('generated client keeps the factory contract', () => {
  const check = spawnSync(process.execPath, ['--check', dest], { encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr)
  assert.match(src, /Do not edit by hand/)
  assert.match(src, /id: 'dsh-session-permissions'/)
  assert.match(src, /inject = \['slots', 'locale'\]/)
  assert.match(src, /return module\.exports/)
  assert.match(src, /conversation\.view/)
  assert.match(src, /session-permissions/)
  assert.match(src, /developer: '开发'/)
  assert.match(src, /tool_bash: '命令行'/)
  assert.match(src, /tool_deploy: '对外发布'/)
  assert.match(src, /toolhint_edit/)
  assert.match(src, /margin:0 auto/)
  assert.match(src, /POLICY_SCHEMA_VERSION/)
})
