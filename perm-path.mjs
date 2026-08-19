import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { allowTool, asArgs, classifyTool, workspaceAccessOf } from './perm-schema.mjs'

export const HATCH_FILES = ['BOOTSTRAP.md', 'IDENTITY.md', 'USER.md', 'SOUL.md']

export function isAskUserTool(name) {
  const id = String(name || '').toLowerCase()
  return id === 'ask_user_question' || id === 'ask_user' || id === 'user_question'
}

export function hatchActive(cwd) {
  if (!cwd || !looksLikeDsClaw(cwd)) return false
  try { return existsSync(join(cwd, 'BOOTSTRAP.md')) } catch { return false }
}

export function extractPatchPaths(args) {
  const text = String(asArgs(args).patch || asArgs(args).diff || '')
  const found = []
  const re = /^\*\*\* (?:Update|Add|Delete) File:\s+(.+)$/gm
  let match
  while ((match = re.exec(text))) {
    const path = String(match[1] || '').trim()
    if (path && found.indexOf(path) < 0) found.push(path)
  }
  return found
}

export function isHatchIdentityMutation(cwd, name, args) {
  if (!hatchActive(cwd)) return false
  const cls = classifyTool(name, args)
  if (cls !== 'write' && cls !== 'edit' && cls !== 'apply_patch') return false
  const paths = extractPaths(args).concat(extractPatchPaths(args))
  if (paths.length === 0) return false
  return paths.every((raw) => {
    const target = resolveTarget(cwd, raw)
    if (!target || !isPathInside(cwd, target)) return false
    return HATCH_FILES.indexOf(basename(target)) >= 0
  })
}

export function hatchOfficialSandbox(wanted) {
  if (wanted === 'danger-full-access' || wanted === 'workspace-write') return wanted
  return 'workspace-write'
}

export function pathApi(platform = process.platform) {
  return platform === 'win32' ? win32 : { join, resolve, relative, isAbsolute, sep }
}

export function isWinAbs(path) {
  const text = String(path || '')
  return /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\')
}

export function escapesHome(rel, platform = process.platform) {
  if (rel == null || rel === '') return false
  const p = pathApi(platform)
  return rel.startsWith('..') || p.isAbsolute(rel)
}

// Same containment check as OpenClaw packages/fs-safe/src/path.ts `isPathInside`.
export function isPathInside(root, target, platform = process.platform) {
  if (!root || !target) return false
  if (platform === 'win32') {
    const rootForCompare = win32.resolve(root)
    const targetForCompare = win32.resolve(target)
    const rel = win32.relative(rootForCompare, targetForCompare)
    return rel === '' || !escapesHome(rel, 'win32')
  }
  if (isWinAbs(target) && !isWinAbs(root)) return false
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  return rel === '' || !escapesHome(rel, platform)
}

export function extractPaths(args) {
  const value = asArgs(args)
  const found = []
  if (typeof value.path === 'string' && value.path) found.push(value.path)
  if (Array.isArray(value.paths)) {
    for (const item of value.paths) {
      if (typeof item === 'string' && item) found.push(item)
    }
  }
  return found
}

const HOME_EXACT = /^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE|\$\{env:USERPROFILE\})$/i
const HOME_PREFIXES = [
  /^~[\\/]/,
  /^\$HOME[\\/]/i,
  /^\$\{HOME\}[\\/]/i,
  /^%USERPROFILE%[\\/]/i,
  /^\$env:USERPROFILE[\\/]/i,
  /^\$\{env:USERPROFILE\}[\\/]/i,
]

function expandHome(raw) {
  if (HOME_EXACT.test(raw)) return homedir()
  for (const re of HOME_PREFIXES) {
    if (!re.test(raw)) continue
    const segments = raw.replace(re, '').split(/[\\/]+/).filter(Boolean)
    return segments.length ? join(homedir(), ...segments) : homedir()
  }
  return raw
}

export function resolveTarget(cwd, raw) {
  if (typeof raw !== 'string' || raw === '') return null
  const path = expandHome(raw)
  if (isWinAbs(path)) {
    return process.platform === 'win32' ? win32.resolve(path) : win32.normalize(path)
  }
  if (!isAbsolute(path)) {
    if (!cwd) return null
    return resolve(cwd, path)
  }
  return resolve(path)
}

export function extractBashPaths(command) {
  const text = String(command || '')
  const found = []
  const push = (raw) => {
    const path = String(raw || '').trim()
    if (!path) return
    if (found.indexOf(path) < 0) found.push(path)
  }
  const quoted = /["'](\$\{?HOME\}?(?:\/[^"']*)?|~(?:\/[^"']*)?|\/[^"']+|\.\.(?:\/[^"']*)?)["']/g
  let match
  while ((match = quoted.exec(text))) push(match[1])
  const bare = /(?:^|[\s|&;()<>`])(\$\{?HOME\}?(?:\/[^\s|&;<>"'`\\]*)?|~(?:\/[^\s|&;<>"'`\\]*)?|\/[^\s|&;<>"'`\\]+|\.\.(?:\/[^\s|&;<>"'`\\]*)?)/g
  while ((match = bare.exec(text))) push(match[1])
  return found
}

export function looksLikeBashWrite(command) {
  const text = String(command || '').replace(/(?:\&|\d*)>\s*\/dev\/null/g, ' ')
  if (/>>|(?:^|[^\d])>/.test(text)) return true
  return /(?:^|[|&;\n]\s*)(?:mkdir|rmdir|rm|mv|cp|touch|chmod|chown|ln|install|tee|truncate|dd)\b/.test(text)
}

const WIN_PATH_TOKEN = '(?:[A-Za-z]:[\\\\/]|\\\\\\\\|%USERPROFILE%|\\$env:USERPROFILE|\\$\\{env:USERPROFILE\\}|~|\\.)'
const WIN_QUOTED = new RegExp('["\'](' + WIN_PATH_TOKEN + '[^"\']*)["\']', 'gi')
const WIN_BARE = new RegExp(
  '(?:^|[\\s|&;()<>`])((?:[A-Za-z]:[\\\\/][^\\s|&;<>"\'`]+)|(?:\\\\\\\\[^\\s|&;<>"\'`]+)|(?:%USERPROFILE%(?:[\\\\/][^\\s|&;<>"\'`]*)?)|(?:\\$env:USERPROFILE(?:[\\\\/][^\\s|&;<>"\'`]*)?)|(?:\\$\\{env:USERPROFILE\\}(?:[\\\\/][^\\s|&;<>"\'`]*)?)|(?:~(?:[\\\\/][^\\s|&;<>"\'`]*)?)|(?:\\.[\\\\/][^\\s|&;<>"\'`]+))',
  'gi',
)

export function extractWinPaths(command) {
  const text = String(command || '')
  const found = []
  const push = (raw) => {
    const path = String(raw || '').trim()
    if (!path) return
    if (found.indexOf(path) < 0) found.push(path)
  }
  let match
  WIN_QUOTED.lastIndex = 0
  while ((match = WIN_QUOTED.exec(text))) push(match[1])
  WIN_BARE.lastIndex = 0
  while ((match = WIN_BARE.exec(text))) push(match[1])
  return found
}

export function extractCommandPaths(command) {
  const found = []
  const push = (raw) => {
    const path = String(raw || '').trim()
    if (!path) return
    if (found.indexOf(path) < 0) found.push(path)
  }
  for (const item of extractBashPaths(command)) push(item)
  for (const item of extractWinPaths(command)) push(item)
  return found
}

export function looksLikeShellWrite(command) {
  if (looksLikeBashWrite(command)) return true
  const text = String(command || '').replace(/(?:\&|\d*)>\s*\$null/gi, ' ')
  if (/>>|(?:^|[^\d])>/.test(text)) return true
  return /(?:^|[|&;\n]\s*)(?:New-Item|Set-Content|Add-Content|Clear-Content|Out-File|Remove-Item|Copy-Item|Move-Item|Rename-Item|ni|del|erase|copy|move|ren|rd)\b/i.test(text)
}

export function bashAllowed(policy, command, cwd) {
  const write = looksLikeShellWrite(command)
  const cls = write ? 'write' : 'read'
  const access = workspaceAccessOf(policy, cls)
  if (access === 'none') return false
  if (cls !== 'read' && access === 'ro') return false
  const paths = extractCommandPaths(command)
  if (paths.length === 0) return pathAllowed(access, cwd, '')
  return paths.every((item) => pathAllowed(access, cwd, item))
}

export function inWorkspace(cwd, target) {
  return isPathInside(cwd, target)
}

export function resolveExisting(path) {
  try {
    return realpathSync(String(path))
  } catch {
    return String(path || '')
  }
}

export function sameRoot(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const left = resolveExisting(a)
  const right = resolveExisting(b)
  if (left === right) return true
  return String(left).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    === String(right).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function looksLikeDsClaw(path) {
  const raw = String(path || '').replace(/\\/g, '/')
  if (/(^|\/)DSclaw(\/|$)/i.test(raw)) return true
  try {
    return /(^|\/)DSclaw(\/|$)/i.test(realpathSync(path).replace(/\\/g, '/'))
  } catch {
    return false
  }
}

export function pathAllowed(access, cwd, raw) {
  if (access === 'all') return true
  if (access === 'none') return false
  if (!cwd) return false
  if (raw == null || raw === '') return true
  const target = resolveTarget(cwd, raw)
  if (!target) return false
  return isPathInside(cwd, target)
}

export function allowExecution(policy, name, args, cwd) {
  if (isAskUserTool(name)) return true
  if (isHatchIdentityMutation(cwd, name, args)) return true
  if (!allowTool(policy, name, args)) return false
  const cls = classifyTool(name, args)
  if (cls === 'bash') return bashAllowed(policy, asArgs(args).command, cwd)
  if (cls === 'deploy' || cls === 'mcp' || cls === 'other' || cls === 'ask_user') return true
  const access = workspaceAccessOf(policy, cls)
  if (access === 'none') return false
  if (cls !== 'read' && access === 'ro') return false
  const paths = extractPaths(args)
  if (paths.length === 0) return pathAllowed(access, cwd, '')
  return paths.every((item) => pathAllowed(access, cwd, item))
}
