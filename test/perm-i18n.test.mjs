import assert from 'node:assert/strict'
import test from 'node:test'
import { COPY, isZh, tWith, translate } from '../perm-i18n.mjs'
import { TOOL_IDS } from '../perm-schema.mjs'

const ZH_HAN = /[\u4e00-\u9fff]/
const PRESETS = ['research', 'developer', 'reviewer', 'release', 'public']

test('permission labels are Chinese in zh and English in en', () => {
  for (const id of PRESETS) {
    assert.match(COPY.zh[id], ZH_HAN)
    assert.notEqual(COPY.zh[id], id)
    assert.doesNotMatch(COPY.en[id], ZH_HAN)
  }
  for (const id of TOOL_IDS) {
    const zh = COPY.zh['tool_' + id]
    assert.match(zh, ZH_HAN)
    assert.notEqual(zh, id)
    assert.equal(COPY.zh[id], zh)
    assert.doesNotMatch(COPY.en['tool_' + id], ZH_HAN)
  }
})

test('tWith ignores bind when it echoes the key', () => {
  const echo = {
    getLocale: () => ({ active: 'zh' }),
    bind: () => (key) => key,
  }
  assert.equal(tWith({ locale: echo }, 'tool_bash'), '命令行')
  assert.equal(tWith({ locale: echo }, 'developer'), '开发')
  assert.equal(tWith({ locale: { getLocale: () => ({ active: 'en' }), bind: () => (key) => key } }, 'research'), 'Read only')
})

test('tWith prefers a real bind result', () => {
  assert.equal(tWith({
    locale: { bind: () => (key) => key === 'developer' ? 'Dev' : key },
  }, 'developer'), 'Dev')
})

test('isZh follows official locale snapshot', () => {
  assert.equal(isZh({}), true)
  assert.equal(isZh({ locale: { getLocale: () => ({ active: 'en' }) } }), false)
  assert.equal(translate('zh', 'allow'), '允许')
  assert.equal(translate('en', 'allow'), 'Allow')
})
