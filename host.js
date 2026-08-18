import { isSessionId } from './perm-schema.mjs'
import { defaultDshHome, resetPolicy, savePolicy } from './perm-store.mjs'
import {
  composeLayers,
  isClawContext,
  loadAgentHintSync,
  readOfficialName,
  resolveLayersSync,
  sessionFacts,
} from './perm-layers.mjs'
import { renderPolicyPrompt } from './perm-official.mjs'

export const name = 'dsh-session-permissions'
export const inject = ['webServer', 'systemPrompt']

const BODY_CAP = 65536
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
let dshHome = defaultDshHome()

const _internal = {
  setDshHome(dir) { dshHome = dir },
  getDshHome() { return dshHome },
}
export { _internal }

const writeJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const readJsonBody = (req, cap = BODY_CAP) => new Promise((resolveBody, reject) => {
  let size = 0
  const chunks = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > cap) {
      reject(new Error('body too large'))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    try {
      resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      reject(new Error('invalid json body'))
    }
  })
  req.on('error', reject)
})

const guard = (req, res) => {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method not allowed' })
    return false
  }
  const headers = req.headers || {}
  if (headers['x-dsh-session-permissions'] !== '1') {
    writeJson(res, 403, { ok: false, error: 'missing csrf header' })
    return false
  }
  const origin = headers.origin
  if (origin !== undefined && origin !== null && !LOOPBACK_ORIGIN.test(origin)) {
    writeJson(res, 403, { ok: false, error: 'origin not allowed' })
    return false
  }
  return true
}

function payload(layers) {
  return {
    ok: true,
    record: layers.record,
    official: { name: layers.officialName, policy: layers.official },
    agent: layers.agent,
    ceiling: layers.ceiling,
    session: layers.session,
    effective: layers.effective,
    inherited: layers.inherited,
    claw: !!layers.claw,
    enforced: true,
  }
}

function resolveFor(ctx, sessionId, body) {
  return resolveLayersSync(dshHome, sessionFacts(ctx, sessionId, body))
}

function cwdOf(agent) {
  const session = agent && agent.session
  const header = session && session.header
  return header && header.cwd ? String(header.cwd) : ''
}

export function apply(ctx) {
  const stopPrompt = ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function'
    ? ctx.systemPrompt.section({
      name: 'dsh-session-permissions',
      order: 14,
      text(assemble) {
        const agent = assemble && assemble.agent
        const session = agent && agent.session
        const header = session && session.header
        const cwd = cwdOf(agent)
        if (!cwd && !session) return ''
        const layers = resolveLayersSync(dshHome, {
          sessionId: session && session.id,
          cwd,
          preset: header && header.agentPreset,
          events: session && session.events,
        })
        return renderPolicyPrompt(layers && layers.effective)
      },
    })
    : function () {}

  const handle = (fn) => async (req, res) => {
    if (!guard(req, res)) return
    try {
      const body = await readJsonBody(req)
      await fn(req, res, body)
    } catch (error) {
      writeJson(res, 400, { ok: false, error: error && error.message ? error.message : 'bad request' })
    }
  }

  const routes = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-session-permissions/read',
      handler: handle(async (_req, res, body) => {
        const sessionId = body && body.sessionId
        if (!isSessionId(sessionId)) {
          writeJson(res, 400, { ok: false, error: 'invalid session id' })
          return
        }
        writeJson(res, 200, payload(resolveFor(ctx, sessionId, body)))
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-session-permissions/write',
      handler: handle(async (_req, res, body) => {
        const sessionId = body && body.sessionId
        if (!isSessionId(sessionId)) {
          writeJson(res, 400, { ok: false, error: 'invalid session id' })
          return
        }
        const facts = sessionFacts(ctx, sessionId, body)
        const agent = loadAgentHintSync(dshHome, facts)
        const composed = composeLayers({
          officialName: readOfficialName(dshHome, facts.events),
          agent,
          sessionRecord: { source: 'session', policy: body && body.policy },
          claw: isClawContext(facts, agent),
        })
        const record = await savePolicy(dshHome, sessionId, composed.session)
        writeJson(res, 200, payload({ ...composed, record }))
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-session-permissions/reset',
      handler: handle(async (_req, res, body) => {
        const sessionId = body && body.sessionId
        if (!isSessionId(sessionId)) {
          writeJson(res, 400, { ok: false, error: 'invalid session id' })
          return
        }
        await resetPolicy(dshHome, sessionId)
        writeJson(res, 200, payload(resolveFor(ctx, sessionId, body)))
      }),
    }),
  ]

  ctx.effect(() => () => {
    if (typeof stopPrompt === 'function') stopPrompt()
    for (const dispose of routes) {
      if (typeof dispose === 'function') dispose()
    }
  })
}
