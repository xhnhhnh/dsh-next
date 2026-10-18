import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTOMATION_RECORD, VERIFICATION_RECORD, automationProjection as projection } from '../lib/automation-state.js'
const event = (type, data, seq = 1) => ({ type, data, seq, ignorable: true })
const reserve = (id = 'r1') => event(AUTOMATION_RECORD, { kind: 'reserve', id, childId: 'child', amountCny: 1, amountCnyExact: '1', provider: 'p', model: 'm', maxInputTokens: 100, maxOutputTokens: 10, at: 1 })
const settle = (id, recordId, costCnyExact) => event(AUTOMATION_RECORD, { kind: 'settle', id, recordId, costCnyExact, costCny: Number(costCnyExact), at: 2 })

test('budget replay reserves exactly once and settles exact historical prices without rounding', () => {
  let state = projection.init()
  for (const e of [reserve(), reserve(), settle('r1', 'call1', '0.1'), settle('r1', 'call1', '0.1'), reserve(), reserve('r2'), settle('r2', 'call2', '0.2')]) state = projection.apply(state, e)
  assert.equal(state.budget.spentCnyExact, '0.3')
  assert.deepEqual(state.budget.children, ['child'])
  assert.equal(Object.keys(state.budget.reservations).length, 0)
  projection.stateSchema.parse(state)
  projection.wire.viewSchema.parse(projection.wire.view(state))
})

test('unknown reservations survive replay and malformed or forked events never release them', () => {
  const events = [reserve(), event(AUTOMATION_RECORD, { kind: 'unknown', id: 'r1', reason: 'usage missing' }), settle('r1', 'bad', '-2')]
  const state = events.reduce(projection.apply, projection.init())
  assert.equal(projection.wire.view(state).reservedCny, 1)
  assert.equal(projection.wire.view(state).unknownReservations, 1)
  assert.equal(state.budget.reservations.r1.reason, 'usage missing')
  assert.deepEqual(events.reduce(projection.apply, projection.init({}, 10)), projection.init({}, 10))
})

test('verification statuses are durable distinct facts, duplicate delivery never recounts', () => {
  let state = projection.init()
  for (const status of ['executed','reused','failed','unknown']) {
    const record = event(VERIFICATION_RECORD, { checkId: 'config', status, detail: 'safe summary', source: { sessionId: 's', callId: status, originalCallId: status === 'reused' ? 'executed' : '' }, inputHash: 'not exposed in projection' })
    state = projection.apply(state, record); state = projection.apply(state, record)
  }
  const view = projection.wire.view(state)
  for (const key of ['executed','reused','failed','unknown']) assert.equal(view.verification[key], 1)
  assert.equal(view.verification.last.length, 4)
  assert.equal('seen' in view.verification, false)
  projection.stateSchema.parse(state)
  projection.wire.viewSchema.parse(view)
})
