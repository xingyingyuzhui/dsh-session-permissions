import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyPreset } from '../perm-schema.mjs'
import {
  allowExecution,
  escapesHome,
  extractCommandPaths,
  isPathInside,
  looksLikeDsClaw,
  looksLikeShellWrite,
  resolveTarget,
} from '../perm-path.mjs'

test('resolveTarget expands USERPROFILE tokens onto homedir', () => {
  const cwd = join(homedir(), '.dsh', 'DSclaw', 'bot1')
  const want = join(homedir(), 'Desktop', 'a.md')
  assert.equal(resolveTarget(cwd, '%USERPROFILE%\\Desktop\\a.md'), want)
  assert.equal(resolveTarget(cwd, '%USERPROFILE%/Desktop/a.md'), want)
  assert.equal(resolveTarget(cwd, '$env:USERPROFILE\\Desktop\\a.md'), want)
  assert.equal(resolveTarget(cwd, '~\\Desktop\\a.md'), want)
})

test('extractCommandPaths reads PowerShell and drive paths', () => {
  const paths = extractCommandPaths('Get-ChildItem C:\\Users\\qin\\Desktop')
  assert.ok(paths.some((item) => item.indexOf('Desktop') >= 0))
  const env = extractCommandPaths('Get-ChildItem $env:USERPROFILE\\Desktop')
  assert.ok(env.some((item) => /USERPROFILE|Desktop/.test(item)))
})

test('looksLikeShellWrite sees PowerShell verbs', () => {
  assert.equal(looksLikeShellWrite('Set-Content .\\x.md hi'), true)
  assert.equal(looksLikeShellWrite('New-Item .\\out.md -ItemType File'), true)
  assert.equal(looksLikeShellWrite('Get-ChildItem C:\\Users\\qin\\Desktop'), false)
})

test('research bash denies Desktop via PowerShell home', () => {
  const research = applyPreset('research')
  const cwd = join(homedir(), '.dsh', 'DSclaw', 'bot1')
  assert.equal(allowExecution(research, 'bash', { command: 'Get-ChildItem $env:USERPROFILE\\Desktop' }, cwd), false)
  assert.equal(allowExecution(research, 'bash', { command: 'Get-ChildItem C:\\Users\\qin\\Desktop' }, cwd), false)
})

test('isPathInside on win32 rejects other drives and Desktop', () => {
  const root = 'C:\\Users\\qin\\.dsh\\DSclaw\\a'
  assert.equal(isPathInside(root, 'C:\\Users\\qin\\.dsh\\DSclaw\\a\\IDENTITY.md', 'win32'), true)
  assert.equal(isPathInside(root, 'C:\\Users\\qin\\Desktop', 'win32'), false)
  assert.equal(isPathInside(root, 'D:\\other', 'win32'), false)
  assert.equal(escapesHome('D:\\other', 'win32'), true)
  assert.equal(escapesHome('..\\..\\Desktop', 'win32'), true)
})

test('looksLikeDsClaw is case-insensitive', () => {
  assert.equal(looksLikeDsClaw('C:\\Users\\qin\\.dsh\\dsclaw\\bot1'), true)
  assert.equal(looksLikeDsClaw('C:\\Users\\qin\\Desktop'), false)
})
