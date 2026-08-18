import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { isSessionId, normalizePolicy } from './perm-schema.mjs'

export function defaultDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function policyFile(home, sessionId) {
  return join(home || defaultDshHome(), 'session-permissions', sessionId + '.json')
}

export function emptyRecord(sessionId, now = new Date().toISOString()) {
  return {
    version: 1,
    sessionId,
    source: 'inherit',
    createdAt: now,
    updatedAt: now,
    policy: null,
  }
}

export function normalizeRecord(raw, sessionId) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const id = isSessionId(value.sessionId) ? value.sessionId : sessionId
  const now = new Date().toISOString()
  const policyRaw = value.policy && typeof value.policy === 'object' ? value.policy : null
  const source = value.source === 'session' && policyRaw ? 'session' : 'inherit'
  return {
    version: 1,
    sessionId: id,
    source,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
    policy: policyRaw ? normalizePolicy(policyRaw) : null,
  }
}

function parseRecord(text, sessionId) {
  return normalizeRecord(JSON.parse(text), sessionId)
}

export function loadPolicySync(home, sessionId) {
  if (!isSessionId(sessionId)) return null
  try {
    return parseRecord(readFileSync(policyFile(home, sessionId), 'utf8'), sessionId)
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyRecord(sessionId)
    throw error
  }
}

export async function loadPolicy(home, sessionId) {
  if (!isSessionId(sessionId)) return null
  try {
    return parseRecord(await readFile(policyFile(home, sessionId), 'utf8'), sessionId)
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyRecord(sessionId)
    throw error
  }
}

export async function savePolicy(home, sessionId, policy, now = new Date().toISOString()) {
  if (!isSessionId(sessionId)) throw new Error('invalid session id')
  const current = await loadPolicy(home, sessionId)
  const record = {
    version: 1,
    sessionId,
    source: 'session',
    createdAt: current && current.source === 'session' ? current.createdAt : now,
    updatedAt: now,
    policy: normalizePolicy(policy),
  }
  const file = policyFile(home, sessionId)
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(record, null, 2) + '\n')
  await rename(tmp, file)
  return record
}

export async function resetPolicy(home, sessionId) {
  if (!isSessionId(sessionId)) throw new Error('invalid session id')
  const file = policyFile(home, sessionId)
  try {
    await unlink(file)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  return emptyRecord(sessionId)
}
