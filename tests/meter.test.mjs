import test from 'node:test'
import assert from 'node:assert/strict'
import { canReserveBudget, createMeter, estimateCallReservation, priceTokenUsage, summarizeRecords } from '../lib/meter.js'

const route = { provider: 'test-provider', model: 'manual-model' }
const price = { ...route, input: '2', cacheRead: '0.2', cacheWrite: '3', output: '4' }
const options = { ...route, sessionId: 'root', purpose: 'conversation' }
const usage = (overrides = {}) => ({ inputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 50, outputTokens: 40, reasoningTokens: 30, totalTokens: 390, ...overrides })
const finish = { type: 'finish', reason: { kind: 'stop' } }
async function collect(stream) { const result = []; for await (const chunk of stream) result.push(chunk); return result }
async function* chunks(...items) { yield* items }
const complete = data => chunks({ type: 'usage', usage: data }, finish)

test('passes frozen options and chunks through and counts only the final cumulative usage', async () => {
  const recorded = []
  let calls = 0
  let clock = 100
  const meter = createMeter({ prices: [price], now: () => { clock += 25; return clock }, onRecord: record => recorded.push(record) })
  const text = Object.freeze({ type: 'text', text: 'hello' })
  const first = { type: 'usage', usage: usage({ inputTokens: 10, totalTokens: 300 }) }
  const last = { type: 'usage', usage: usage() }
  const frozen = Object.freeze({ ...options })
  const result = await collect(meter.wrap(frozen, () => { calls += 1; return chunks(text, first, last, finish) }))
  assert.equal(calls, 1)
  assert.deepEqual(result, [text, first, last, finish])
  assert.equal(result[0], text)
  assert.equal(result[2], last)
  assert.deepEqual(frozen, options)
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].durationMs, 25)
  assert.equal(recorded[0].purpose, 'conversation')
  assert.equal(recorded[0].status, 'completed')
  const summary = meter.snapshot('root')
  assert.deepEqual(summary.tokens, { input: 100, cacheRead: 200, cacheWrite: 50, output: 40, total: 390 })
  assert.equal(summary.costCnyExact, '0.00055')
  assert.equal(summary.costCny, 0.00055)
  assert.equal(summary.usageComplete, true)
  assert.equal(summary.elapsedMs, 25)
  assert.equal(summary.totalDurationMs, 25)
})

test('alpha.5 terminal error and aborted finish frames are not counted as success', async () => {
  const meter = createMeter({ prices: [price] })
  const failure = { code: 'TRANSPORT', detail: 'fixture' }
  const errorFinish = { type: 'finish', reason: { kind: 'error', failure } }
  const abortFinish = { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED' } } }
  const errorResult = await collect(meter.wrap(options, () => chunks({ type: 'usage', usage: usage() }, errorFinish)))
  const abortResult = await collect(meter.wrap(options, () => chunks(abortFinish)))
  assert.equal(errorResult.at(-1), errorFinish)
  assert.equal(abortResult.at(-1), abortFinish)
  const summary = meter.snapshot()
  assert.equal(summary.failed, 1)
  assert.equal(summary.cancelled, 1)
  assert.equal(summary.completed, 0)
  assert.equal(summary.records[0].costCnyExact, '0.00055')
  assert.equal(summary.records[0].usageComplete, true)
  assert.equal(summary.records[1].costCny, null)
})

test('a price of zero is known and reasoning tokens are not added a second time', async () => {
  const meter = createMeter({ prices: [{ ...route, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }] })
  await collect(meter.wrap(options, () => complete(usage())))
  assert.equal(meter.snapshot('root').tokens.total, 390)
  assert.equal(meter.snapshot('root').tokens.output, 40)
  assert.equal(meter.snapshot('root').costCny, 0)
  assert.equal(meter.snapshot('root').unknownPriceCalls, 0)
})

test('missing prices keep measured usage while cost stays unknown', async () => {
  const meter = createMeter()
  await collect(meter.wrap(options, () => complete(usage())))
  const summary = meter.snapshot('root')
  assert.equal(summary.usageComplete, true)
  assert.equal(summary.tokens.total, 390)
  assert.equal(summary.costCny, null)
  assert.equal(summary.knownCostCny, 0)
  assert.equal(summary.unknownPriceCalls, 1)
  assert.deepEqual(summary.records[0].unknownReasons, ['price-missing'])
})

test('a stream without usage is unknown instead of zero, including successful streams', async () => {
  const meter = createMeter({ prices: [price] })
  await collect(meter.wrap(options, () => chunks({ type: 'text', text: 'answer' }, finish)))
  const summary = meter.snapshot('root')
  assert.equal(summary.calls, 1)
  assert.equal(summary.completed, 1)
  assert.equal(summary.unknownUsageCalls, 1)
  assert.equal(summary.costCny, null)
  assert.deepEqual(summary.tokens, { input: null, cacheRead: null, cacheWrite: null, output: null, total: null })
  assert.equal(summary.records[0].usageObserved, false)
})

test('omitted cache buckets are only inferred when an exact total determines them', () => {
  const zero = priceTokenUsage({ inputTokens: 100, outputTokens: 10, totalTokens: 110 }, price)
  assert.equal(zero.usageComplete, true)
  assert.deepEqual(zero.tokens, { input: 100, cacheRead: 0, cacheWrite: 0, output: 10, total: 110 })
  const one = priceTokenUsage({ inputTokens: 100, cacheReadTokens: 20, outputTokens: 10, totalTokens: 135 }, price)
  assert.equal(one.tokens.cacheWrite, 5)
  assert.equal(one.usageComplete, true)
  const ambiguous = priceTokenUsage({ inputTokens: 100, outputTokens: 10, totalTokens: 135 }, price)
  assert.equal(ambiguous.tokens.total, 135)
  assert.equal(ambiguous.tokens.cacheRead, null)
  assert.equal(ambiguous.tokens.cacheWrite, null)
  assert.equal(ambiguous.costCny, null)
  assert.equal(ambiguous.knownCostCnyExact, '0.00024')
  assert.equal(priceTokenUsage({ inputTokens: 100, outputTokens: 10 }, price).usageComplete, false)
})

test('contradictory or invalid final usage does not inherit an earlier valid sample', async () => {
  const meter = createMeter({ prices: [price] })
  await collect(meter.wrap(options, () => chunks({ type: 'usage', usage: usage() }, { type: 'usage', usage: usage({ totalTokens: 1 }) }, finish)))
  assert.equal(meter.snapshot('root').costCny, null)
  assert.equal(meter.snapshot('root').tokens.total, null)
  assert.equal(meter.snapshot('root').records[0].usageObserved, true)
  assert.ok(meter.snapshot('root').records[0].unknownReasons.includes('usage-invalid'))
  for (const bad of [usage({ outputTokens: -1 }), usage({ cacheReadTokens: 0.5 }), usage({ reasoningTokens: 41 }), usage({ inputTokens: Number.MAX_SAFE_INTEGER })]) {
    assert.equal(priceTokenUsage(bad, price).usageComplete, false)
  }
})

test('each retry attempt settles separately and original errors reach the caller', async () => {
  const error = new Error('provider failed')
  const records = []
  const meter = createMeter({ prices: [price], onRecord: record => records.push(record) })
  await assert.rejects(collect(meter.wrap(options, async function* () {
    yield { type: 'usage', usage: usage() }
    yield finish
    throw error
  })), candidate => candidate === error)
  await collect(meter.wrap(options, () => complete(usage())))
  const summary = meter.snapshot('root')
  assert.equal(summary.calls, 2)
  assert.equal(summary.failed, 1)
  assert.equal(summary.completed, 1)
  assert.equal(summary.tokens.total, 780)
  assert.equal(summary.costCnyExact, '0.0011')
  assert.equal(records.length, 2)
  assert.notEqual(records[0].id, records[1].id)
})

test('a partial stream failure retains observed usage as a lower bound', async () => {
  const meter = createMeter({ prices: [price] })
  await assert.rejects(collect(meter.wrap(options, async function* () {
    yield { type: 'usage', usage: usage() }
    throw new Error('connection lost before terminal frame')
  })))
  const summary = meter.snapshot('root')
  assert.equal(summary.failed, 1)
  assert.equal(summary.usageComplete, false)
  assert.equal(summary.tokens.total, 390)
  assert.equal(summary.knownCostCnyExact, '0.00055')
  assert.equal(summary.costCny, null)
  assert.ok(summary.records[0].unknownReasons.includes('stream-incomplete'))
})

test('abort without usage settles once with unknown consumption', async () => {
  const controller = new AbortController()
  const error = new DOMException('cancelled', 'AbortError')
  let calls = 0
  let recorded = 0
  const meter = createMeter({ prices: [price], onRecord: () => { recorded += 1 } })
  await assert.rejects(collect(meter.wrap({ ...options, signal: controller.signal }, () => {
    calls += 1
    controller.abort()
    throw error
  })), candidate => candidate === error)
  const summary = meter.snapshot('root')
  assert.equal(calls, 1)
  assert.equal(recorded, 1)
  assert.equal(summary.cancelled, 1)
  assert.equal(summary.costCny, null)
  assert.equal(summary.unknownUsageCalls, 1)
})

test('consumer cancellation closes the provider iterator and settles partial usage', async () => {
  let closed = 0
  const meter = createMeter({ prices: [price] })
  const source = async function* () {
    try {
      yield { type: 'usage', usage: usage() }
      yield finish
    } finally { closed += 1 }
  }
  for await (const _chunk of meter.wrap(options, source)) break
  assert.equal(closed, 1)
  assert.equal(meter.snapshot('root').cancelled, 1)
  assert.equal(meter.snapshot('root').costCny, null)
  assert.equal(meter.snapshot('root').knownCostCnyExact, '0.00055')
})

test('a call admitted while enabled is fully settled after the host toggles off', async () => {
  let enabled = true
  const meter = createMeter({ prices: [price] })
  const stream = meter.wrap(options, async function* () {
    enabled = false
    yield { type: 'usage', usage: usage() }
    yield finish
  })
  await collect(stream)
  assert.equal(enabled, false)
  assert.equal(meter.snapshot('root').calls, 1)
  assert.equal(meter.snapshot('root').costCnyExact, '0.00055')
})

test('persistence failures and callback mutation cannot mask or change provider outcomes', async () => {
  const original = new Error('original provider error')
  let recorded = 0
  const meter = createMeter({ prices: [price], onRecord: async record => {
    recorded += 1
    record.tokens.input = 999
    throw new Error('persistence unavailable')
  } })
  await assert.rejects(collect(meter.wrap(options, () => { throw original })), error => error === original)
  await collect(meter.wrap(options, () => complete(usage())))
  assert.equal(recorded, 2)
  assert.equal(meter.snapshot().recordErrors, 2)
  assert.equal(meter.snapshot().records[1].tokens.input, 100)
})

test('session and descendant aggregation deduplicates IDs and survives replay', async () => {
  const meter = createMeter({ prices: [price] })
  for (const sessionId of ['root', 'child', 'other']) await collect(meter.wrap({ ...options, sessionId }, () => complete(usage())))
  assert.equal(meter.snapshot('root').calls, 1)
  assert.equal(meter.snapshot('root', { descendants: ['root', 'child', 'child'] }).calls, 2)
  assert.equal(meter.snapshot('root', { descendants: new Set(['child']) }).costCnyExact, '0.0011')
  const persisted = meter.snapshot().records
  let notified = 0
  const restored = createMeter({ records: persisted, onRecord: () => { notified += 1 } })
  assert.equal(restored.restore(persisted[0]), false)
  assert.equal(restored.snapshot().calls, 3)
  assert.equal(notified, 0)
  assert.equal(restored.snapshot('child').costCnyExact, '0.00055')
  persisted[0].tokens.input = 999
  const copy = restored.snapshot()
  copy.records[0].tokens.input = 888
  assert.equal(restored.snapshot('root').tokens.input, 100)
  assert.throws(() => restored.restore({ version: 1 }), /Invalid NEXT meter record/)
  assert.throws(() => restored.snapshot('root', { descendants: 'child' }), /iterable/)
})

test('pure aggregation deduplicates persisted calls and never reprices historical records', async () => {
  const meter = createMeter({ prices: [price], now: (() => { const times = [100, 300, 150, 500]; return () => times.shift() })() })
  await collect(meter.wrap(options, () => complete(usage())))
  await collect(meter.wrap(options, () => complete(usage())))
  const records = meter.snapshot().records
  const aggregate = summarizeRecords([...records, ...records])
  assert.equal(aggregate.calls, 2)
  assert.equal(aggregate.costCnyExact, '0.0011')
  assert.equal(aggregate.elapsedMs, 400)
  assert.equal(aggregate.totalDurationMs, 550)
  const withNewPrice = createMeter({ prices: [{ ...price, input: 999 }], records })
  assert.equal(withNewPrice.snapshot().costCnyExact, aggregate.costCnyExact)
  assert.deepEqual(summarizeRecords([]).tokens, { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 })
})

test('route attribution is captured before an external caller mutates its options', async () => {
  const mutable = { ...options }
  const meter = createMeter({ prices: [price] })
  await collect(meter.wrap(mutable, async function* () {
    mutable.provider = 'later-provider'
    mutable.sessionId = 'later-session'
    yield { type: 'usage', usage: usage() }
    yield finish
  }))
  assert.equal(meter.snapshot('root').costCnyExact, '0.00055')
  assert.equal(meter.snapshot('later-session').calls, 0)
})

test('throwing undefined still records a failed request instead of consumer cancellation', async () => {
  const meter = createMeter()
  let rejected = false
  try { await collect(meter.wrap(options, () => { throw undefined })) }
  catch (error) { rejected = true; assert.equal(error, undefined) }
  assert.equal(rejected, true)
  assert.equal(meter.snapshot().failed, 1)
  assert.equal(meter.snapshot().cancelled, 0)
})

test('decimal pricing is summed exactly instead of accumulating binary rounding', async () => {
  const precise = { ...route, input: '0.1', cacheRead: 1e-7, cacheWrite: 0, output: '0.2' }
  const meter = createMeter({ prices: [precise] })
  for (let index = 0; index < 3; index += 1) {
    await collect(meter.wrap(options, () => complete({ inputTokens: 1_000_000, cacheReadTokens: 1, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 1_000_001 })))
  }
  assert.equal(meter.snapshot().costCnyExact, '0.3000000000003')
  assert.equal(meter.snapshot().costCny, 0.3000000000003)
})

test('invalid price configurations fail before any model is called', () => {
  assert.throws(() => createMeter({ prices: [price, price] }), /Duplicate/)
  for (const invalid of [-1, Infinity, NaN, undefined, 'no-price', '1e100000']) {
    assert.throws(() => createMeter({ prices: [{ ...price, input: invalid }] }))
  }
})

test('reservation uses the most expensive input bucket and exact outstanding budget', () => {
  assert.deepEqual(estimateCallReservation({ inputTokens: 1_000_000, maxOutputTokens: 500_000, price }), { costCny: 5, costCnyExact: '5' })
  assert.equal(canReserveBudget({ limitCny: 20, spentCny: '14.9', reservedCny: '0.1' }, '5'), true)
  assert.equal(canReserveBudget({ limitCny: 20, spentCny: '14.9000000000001', reservedCny: '0.1' }, '5'), false)
  assert.equal(canReserveBudget({ limitCny: 20, spentCny: '19.8', reservedCny: '0.1' }, '0.1'), true)
  assert.throws(() => estimateCallReservation({ inputTokens: -1, maxOutputTokens: 1, price }))
  assert.throws(() => estimateCallReservation({ inputTokens: 1, maxOutputTokens: 1 }))
  assert.throws(() => canReserveBudget({ limitCny: -20 }, 0))
})

test('streaming-only meter persists outcomes without retaining a second history', async () => {
  const records = []
  const meter = createMeter({ prices: [price], retainRecords: false, onRecord: record => records.push(record) })
  await collect(meter.wrap(options, () => complete(usage())))
  await assert.rejects(collect(meter.wrap(options, async function* () { throw new Error('provider failed') })), /provider failed/)
  const controller = new AbortController()
  controller.abort()
  await collect(meter.wrap({ ...options, signal: controller.signal }, () => chunks()))
  assert.equal(records.length, 3)
  assert.deepEqual(records.map(record => record.status), ['completed', 'failed', 'cancelled'])
  assert.equal(records[0].costCnyExact, '0.00055')
  assert.equal(records[1].costCny, null)
  assert.equal(records[2].usageComplete, false)
  assert.throws(() => meter.snapshot(), /History is unavailable/)
  assert.throws(() => meter.restore(records[0]), /History is unavailable/)
  assert.throws(() => createMeter({ retainRecords: false, records }), /History is unavailable/)
  let called = 0
  const broken = createMeter({ retainRecords: false, onRecord() { called++; throw new Error('disk full') } })
  await collect(broken.wrap(options, () => complete(usage())))
  assert.equal(called, 1)
})
