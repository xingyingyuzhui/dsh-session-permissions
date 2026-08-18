import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { allowTool, asArgs, classifyTool, workspaceAccessOf } from './perm-schema.mjs'

// Same containment check as OpenClaw packages/fs-safe/src/path.ts `isPathInside`.
export function isPathInside(root, target) {
  if (!root || !target) return false
  if (process.platform === 'win32') {
    const rootForCompare = win32.resolve(root)
    const targetForCompare = win32.resolve(target)
    const rel = win32.relative(rootForCompare, targetForCompare)
    const firstSegment = rel.split(win32.sep)[0]
    return rel === '' || (firstSegment !== '..' && !win32.isAbsolute(rel))
  }
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  const firstSegment = rel.split(sep)[0]
  return rel === '' || (firstSegment !== '..' && !isAbsolute(rel))
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

export function resolveTarget(cwd, raw) {
  if (typeof raw !== 'string' || raw === '') return null
  let path = raw
  if (path === '$HOME' || path === '${HOME}' || path === '~') path = homedir()
  else if (path.startsWith('~/')) path = homedir() + path.slice(1)
  else if (path.startsWith('$HOME/')) path = homedir() + path.slice(5)
  else if (path.startsWith('${HOME}/')) path = homedir() + path.slice(7)
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

export function bashAllowed(policy, command, cwd) {
  const write = looksLikeBashWrite(command)
  const cls = write ? 'write' : 'read'
  const access = workspaceAccessOf(policy, cls)
  if (access === 'none') return false
  if (cls !== 'read' && access === 'ro') return false
  const paths = extractBashPaths(command)
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
  return resolveExisting(a) === resolveExisting(b)
}

export function looksLikeDsClaw(path) {
  const raw = String(path || '').replace(/\\/g, '/')
  if (/(^|\/)DSclaw(\/|$)/.test(raw)) return true
  try {
    return /(^|\/)DSclaw(\/|$)/.test(realpathSync(path).replace(/\\/g, '/'))
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
  if (!allowTool(policy, name, args)) return false
  const cls = classifyTool(name, args)
  if (cls === 'bash') return bashAllowed(policy, asArgs(args).command, cwd)
  if (cls === 'deploy' || cls === 'other') return true
  const access = workspaceAccessOf(policy, cls)
  if (access === 'none') return false
  if (cls !== 'read' && access === 'ro') return false
  const paths = extractPaths(args)
  if (paths.length === 0) return pathAllowed(access, cwd, '')
  return paths.every((item) => pathAllowed(access, cwd, item))
}
