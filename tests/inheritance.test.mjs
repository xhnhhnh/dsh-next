import test from 'node:test'
import assert from 'node:assert/strict'
import { inheritanceScheduler } from '../lib/inheritance.js'

test('only successful NEXT changes and new agents schedule a batched inheritance scan', () => {
  let scans = 0
  const queued = [], parent = { active: false }, child = { active: true }
  const scheduler = inheritanceScheduler({ active: session => session.active, sync: () => scans++, enqueue: fn => queued.push(fn) })
  const run = (session, id, name, args) => scheduler.sessionEvent(session, { type: 'command/run', data: { commandId: id, name, args } })
  const done = (session, id, kind = 'success') => scheduler.sessionEvent(session, { type: 'command/done', data: { commandId: id, kind } })
  for (const name of ['plan', 'goal', 'next']) {
    run(parent, name, name, 'status'); done(parent, name)
  }
  run(parent, 'failed', 'next', 'on'); done(parent, 'failed', 'error')
  run(parent, 'noop', 'next', 'off'); done(parent, 'noop')
  assert.equal(queued.length, 0)
  run(parent, 'changed', 'next', 'on'); parent.active = true; done(parent, 'changed')
  run(child, 'local', 'next', 'off'); child.active = false; done(child, 'local')
  scheduler.agentCreated(); scheduler.agentCreated()
  assert.equal(queued.length, 1)
  queued.shift()()
  assert.equal(scans, 1)
  scheduler.agentCreated()
  scheduler.dispose()
  queued.shift()()
  assert.equal(scans, 1)
})

test('pending commands are isolated by session and errors remain observable', () => {
  const a = { active: false }, b = { active: false }, queue = [], errors = []
  const scheduler = inheritanceScheduler({ active: s => s.active, sync: () => { throw new Error('persist failed') }, reportFailure: e => errors.push(e.message), enqueue: fn => queue.push(fn) })
  scheduler.sessionEvent(a, { type: 'command/run', data: { commandId: 'shared', name: 'next', args: 'on' } })
  b.active = true
  scheduler.sessionEvent(b, { type: 'command/done', data: { commandId: 'shared', kind: 'success' } })
  assert.equal(queue.length, 0)
  a.active = true
  scheduler.sessionEvent(a, { type: 'command/done', data: { commandId: 'shared', kind: 'success' } })
  queue.shift()()
  assert.deepEqual(errors, ['persist failed'])
})
