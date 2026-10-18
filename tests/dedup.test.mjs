import test from 'node:test'
import assert from 'node:assert/strict'
import { installDedup, readReference } from '../lib/dedup.js'

const full = [{ type: 'text', text: 'line 1\n' + 'Native original file text.\n'.repeat(100) }]
const value = { path: 'C:\\repo\\file.txt', offset: 1, lines: [{ number: 1, text: 'Native original file text.' }], totalLines: 1 }
const copy = (x) => structuredClone(x)

class Session {
  constructor(id = 'session') { this.id = id; this.events = []; this.surface = { nodes: [] }; this.header = { cwd: 'C:\\repo' }; this.projections = new Map() }
  eventAt(seq) { return this.events[seq] }
  deriveEventMessage(event) { return this.projections.get(event.seq) ?? event.data.message }
  append(type, data, options = { surfaceOp: 'append' }) {
    const event = { type, data: copy(data), seq: this.events.length, ...copy(options) }
    if (options.surfaceOp?.op === 'replace') {
      const index = this.surface.nodes.indexOf(options.surfaceOp.startSeq)
      assert.ok(index >= 0)
      assert.equal(options.surfaceOp.startSeq, options.surfaceOp.endSeq)
      const original = copy(this.events[options.surfaceOp.startSeq].data)
      const changed = copy(data)
      original.message.content = null; changed.message.content = null
      assert.deepEqual(changed, original, 'replacement may change only content')
      assert.ok(options.sourceEventSeqs.includes(options.surfaceOp.startSeq))
      this.surface.nodes.splice(index, 1, event.seq)
    } else this.surface.nodes.push(event.seq)
    this.events.push(event)
    return event
  }
  result(callId, content = full) {
    return this.append('tool/result', { message: { id: `message-${callId}`, role: 'tool', toolCallId: callId, source: { kind: 'tool', callId, name: 'read' }, content }, meta: { original: true } })
  }
}

function fixture(options = {}) {
  const handlers = new Map(), native = {}, fake = {}
  let enabled = true, definition = native, version = 'v1', executions = 0, statFails = false
  const ctx = {
    on(name, fn, options = {}) {
      const list = handlers.get(name) ?? []; options.prepend ? list.unshift(fn) : list.push(fn); handlers.set(name, list)
      return () => list.splice(list.indexOf(fn), 1)
    },
    tools: { get: () => definition },
    fs: {
      processPath: () => value.path,
      resolve: async () => ({ targetKey: 'local-realpath', displayPath: value.path }),
      stat: async () => { if (statFails) throw new Error('stat failed'); return { type: 'file', version } },
    },
  }
  const agent = { session: new Session() }
  const controller = installDedup(ctx, { isEnabled: () => enabled, minChars: 1, ...options })
  async function emit(name, ...args) { for (const fn of handlers.get(name) ?? []) await fn(...args) }
  async function waterfall(name, payload, last = async () => ({})) {
    const list = handlers.get(name) ?? []
    const run = (index) => index >= list.length ? last() : list[index](payload, () => run(index + 1))
    return run(0)
  }
  async function read(callId, { observed = true, content = full, args = {}, target = 'local-realpath', changeDefinition = false } = {}) {
    const exec = { name: 'read', callId, token: Symbol(callId), arguments: { file_path: value.path, ...args }, agent, signal: new AbortController().signal }
    const result = { content: copy(content), value: copy(value) }
    const returned = await waterfall('tools/execute', exec, async () => {
      executions += 1
      if (observed) await emit('fs/observed', { targetKey: target, displayPath: value.path }, { kind: 'present', version }, exec)
      if (changeDefinition) definition = fake
      return result
    })
    assert.equal(returned, result, 'native canonical result is returned unchanged')
    assert.deepEqual(returned.value, value)
    await emit('tools/result', exec, returned)
    const event = agent.session.result(callId, returned.content)
    return { event, result, exec }
  }
  return { ctx, agent, controller, read, emit, waterfall,
    setEnabled: (x) => { enabled = x }, setVersion: (x) => { version = x },
    setStatFails: (x) => { statFails = x }, getExecutions: () => executions }
}

test('runs both native reads, shortens only model surface and preserves original logs/values', async () => {
  const f = fixture(); const a = await f.read('a'), b = await f.read('b')
  const config = { model: 'test' }
  assert.equal(await f.waterfall('agent/request', { agent: f.agent }, async () => config), config)
  assert.equal(f.getExecutions(), 2)
  const short = f.agent.session.eventAt(f.agent.session.surface.nodes[1])
  assert.deepEqual(readReference(short.data.message.content), { source: a.event.seq, restore: b.event.seq, hash: readReference(short.data.message.content).hash })
  assert.deepEqual(f.agent.session.eventAt(b.event.seq).data.message.content, full)
  assert.deepEqual(b.result.content, full)
  assert.equal(f.controller.stats.shortened, 1)
})

test('same-named MCP read without the native fs observation is not deduplicated', async () => {
  const f = fixture(); await f.read('a'); await f.read('mcp', { observed: false })
  assert.equal(f.controller.prepareSession(f.agent).shortened, 0)
})

test('rejects mismatched local targets, changed handles, ranges, versions, or actual content', async () => {
  for (const mutation of [
    { target: 'remote-target' }, { changeDefinition: true }, { args: { limit: 20 } },
    { content: [{ type: 'text', text: 'changed'.repeat(500) }] },
  ]) {
    const f = fixture(); await f.read('a'); await f.read('b', mutation)
    assert.equal(f.controller.prepareSession(f.agent).shortened, 0)
  }
  const f = fixture(); await f.read('a'); f.setVersion('v2'); await f.read('b')
  assert.equal(f.controller.prepareSession(f.agent).shortened, 0)
})

test('NEXT off preserves full reads and restores previously shortened nodes', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  f.setEnabled(false)
  assert.equal(f.controller.prepareSession(f.agent).restored, 1)
  assert.deepEqual(f.agent.session.eventAt(f.agent.session.surface.nodes[1]).data.message.content, full)
  await f.read('c'); assert.equal(f.controller.prepareSession(f.agent).shortened, 0)
})

test('source removed by compaction restores full duplicate before next main request', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  f.agent.session.surface.nodes.shift()
  await f.waterfall('agent/request', { agent: f.agent })
  assert.deepEqual(f.agent.session.eventAt(f.agent.session.surface.nodes[0]).data.message.content, full)
  assert.equal(f.controller.stats.restored, 1)
})

test('source changed by message projection causes restoration; source projection prevents new shortening', async () => {
  const f = fixture(); const a = await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  f.agent.session.projections.set(a.event.seq, { ...a.event.data.message, content: [{ type: 'text', text: 'pruned' }] })
  assert.equal(f.controller.prepareSession(f.agent).restored, 1)
  assert.deepEqual(f.agent.session.eventAt(f.agent.session.surface.nodes[1]).data.message.content, full)
})

test('native pruning of the short reference itself remains recoverable through source ancestry', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  const session = f.agent.session, short = session.eventAt(session.surface.nodes[1])
  session.append('tool/result', { ...short.data, message: { ...short.data.message, content: [{ type: 'text', text: 'pruned reference' }] } }, {
    surfaceOp: { op: 'replace', startSeq: short.seq, endSeq: short.seq }, sourceEventSeqs: [short.seq],
  })
  assert.equal(f.controller.prepareSession(f.agent, { restoreAll: true }).restored, 1)
  assert.deepEqual(session.eventAt(session.surface.nodes[1]).data.message.content, full)
})

test('pre-step restores all short references before native compaction callback runs', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  await f.waterfall('agent/pre-step', { agent: f.agent }, async () => {
    for (const seq of f.agent.session.surface.nodes) assert.equal(readReference(f.agent.session.eventAt(seq).data.message.content), null)
    return { kind: 'enter' }
  })
  assert.equal(f.controller.stats.restored, 1)
})

test('request-error recovery and turn-stopping restore before durable turn closure', async () => {
  for (const name of ['agent/request-error', 'agent/turn-stopping']) {
    const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
    const assertFull = () => {
      for (const seq of f.agent.session.surface.nodes) assert.equal(readReference(f.agent.session.eventAt(seq).data.message.content), null)
    }
    if (name === 'agent/request-error') await f.waterfall(name, { agent: f.agent }, async () => { assertFull(); return { kind: 'retry' } })
    else { await f.emit(name, { agent: f.agent, status: 'idle' }); assertFull() }
    assert.equal(f.controller.stats.restored, 1)
  }
})

test('restored outputs are not rewritten again, and reference text is stable across request cycles', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  const before = copy(f.agent.session.eventAt(f.agent.session.surface.nodes[1]).data.message.content)
  f.controller.prepareSession(f.agent, { restoreAll: true })
  const count = f.agent.session.events.length
  assert.equal(f.controller.prepareSession(f.agent, { restoreAll: true }).restored, 0)
  assert.equal(f.agent.session.events.length, count)
  f.controller.prepareSession(f.agent)
  assert.deepEqual(f.agent.session.eventAt(f.agent.session.surface.nodes[1]).data.message.content, before)
})

test('restart recovery reconstructs original output using only persisted native replacement events', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  // Simulate a process crash: no graceful-disposal callback is run.
  f.agent.session.surface.nodes.shift()
  const resumed = installDedup(f.ctx, { isEnabled: () => false })
  assert.equal(resumed.prepareSession(f.agent).restored, 1)
  assert.deepEqual(f.agent.session.eventAt(f.agent.session.surface.nodes[0]).data.message.content, full)
})

test('optional stat verification failure never changes successful native read behavior', async () => {
  const f = fixture(); await f.read('a'); f.setStatFails(true); await f.read('b')
  assert.equal(f.controller.prepareSession(f.agent).shortened, 0)
  assert.equal(f.controller.stats.rejected, 1)
})

test('graceful unload restores all active short references before removing hooks', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  f.controller.dispose()
  for (const seq of f.agent.session.surface.nodes) assert.equal(readReference(f.agent.session.eventAt(seq).data.message.content), null)
})

test('unavailable native verification preserves full reads and reports the reason', () => {
  const controller = installDedup({ on: () => () => {}, tools: { get() {} } }, { isEnabled: () => true })
  assert.equal(controller.available, false)
  assert.match(controller.stats.reason, /unavailable/u)
})

test('different sessions never share native read evidence', async () => {
  const f = fixture(); await f.read('a'); f.agent.session = new Session('other'); await f.read('b')
  assert.equal(f.controller.prepareSession(f.agent).shortened, 0)
})

test('onShorten runs only after a committed replacement and callback failures cannot fail the request', async () => {
  const notifications = []
  const f = fixture({ onShorten(info) {
    assert.notEqual(readReference(info.agent.session.eventAt(info.agent.session.surface.nodes[1]).data.message.content), null)
    notifications.push(info)
    throw new Error('optional telemetry failed')
  } })
  const warnings = []; f.ctx.logger = { warn: (message) => warnings.push(message) }
  await f.read('a'); await f.read('b')
  assert.equal(f.controller.prepareSession(f.agent).shortened, 1)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].originalSeq, 1)
  assert.equal(notifications[0].sourceSeq, 0)
  assert.ok(notifications[0].savedChars > 0)
  assert.match(warnings[0], /statistics callback failed/u)
})

test('surface restoration failures are visible and disable further optional optimization', async () => {
  const f = fixture(); const warnings = []; f.ctx.logger = { warn: (message) => warnings.push(message) }
  await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  f.agent.session.append = () => { throw new Error('native append rejected') }
  await f.waterfall('agent/pre-step', { agent: f.agent })
  assert.equal(f.controller.stats.restoreFailures, 1)
  assert.match(warnings.join('\n'), /could not restore/u)
  assert.match(f.controller.stats.reason, /disabled/u)
})

test('a missing source with failed recovery cannot enter another model request', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  f.agent.session.surface.nodes.shift()
  f.agent.session.append = () => { throw new Error('native append rejected') }
  let dispatched = false
  await assert.rejects(f.waterfall('agent/pre-step', {agent:f.agent}, async () => { dispatched=true; return {} }), /native append rejected/)
  assert.equal(dispatched,false)
})

test('unrelated tool bodies are never cloned and each visible event is loaded once per preparation', () => {
  const f = fixture(), session = f.agent.session
  f.setEnabled(false)
  for (let index = 0; index < 1000; index++) session.result(`unrelated-${index}`, [{ type: 'text', text: 'x'.repeat(16384) }])
  let lookups = 0, clones = 0
  const eventAt = session.eventAt.bind(session), originalClone = globalThis.structuredClone
  session.eventAt = seq => { lookups++; return eventAt(seq) }
  globalThis.structuredClone = (...args) => { clones++; return originalClone(...args) }
  try {
    assert.deepEqual(f.controller.prepareSession(f.agent), { shortened: 0, restored: 0, available: true })
    assert.equal(lookups, 1000)
    assert.equal(clones, 0)
  } finally { globalThis.structuredClone = originalClone }
})

test('existing valid references use indexed positions and remain tracked for graceful disposal', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  const nodes = f.agent.session.surface.nodes
  nodes.includes = nodes.indexOf = () => { throw new Error('linear source position scan') }
  try {
    assert.equal(f.controller.prepareSession(f.agent).restored, 0)
    assert.notEqual(readReference(f.agent.session.eventAt(nodes[1]).data.message.content), null)
  } finally { delete nodes.includes; delete nodes.indexOf }
  f.controller.dispose()
  assert.deepEqual(f.agent.session.eventAt(nodes[1]).data.message.content, full)
})

test('moving a source after its reference restores the full result', async () => {
  const f = fixture(); await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  f.agent.session.surface.nodes.reverse()
  assert.equal(f.controller.prepareSession(f.agent).restored, 1)
  assert.deepEqual(f.agent.session.eventAt(f.agent.session.surface.nodes[0]).data.message.content, full)
})

test('per-preparation hashes never hide later in-place host projection changes', async () => {
  const f = fixture(); const a = await f.read('a'); await f.read('b'); f.controller.prepareSession(f.agent)
  const projection = { ...a.event.data.message, content: copy(full) }
  f.agent.session.projections.set(a.event.seq, projection)
  assert.equal(f.controller.prepareSession(f.agent).restored, 0)
  projection.content[0].text = 'changed by host projection'
  assert.equal(f.controller.prepareSession(f.agent).restored, 1)
  assert.deepEqual(f.agent.session.eventAt(f.agent.session.surface.nodes[1]).data.message.content, full)
})

test('metadata differences cannot recover a reference from a different tool call', async () => {
  const f = fixture(); await f.read('a'); const b = await f.read('b'); f.controller.prepareSession(f.agent)
  const session = f.agent.session, short = session.eventAt(session.surface.nodes[1])
  const alien = session.result('other-call', [{ type: 'text', text: 'different tool result' }])
  alien.sourceEventSeqs = [short.seq]
  session.surface.nodes = [alien.seq]
  const resumed = installDedup(f.ctx, { isEnabled: () => false })
  assert.equal(resumed.prepareSession(f.agent).restored, 0)
  assert.deepEqual(session.eventAt(alien.seq).data.message.content, alien.data.message.content)
  assert.deepEqual(session.eventAt(b.event.seq).data.message.content, full)
})

test('filesystem observations are accepted only during an admitted enabled read', async () => {
  const f = fixture()
  const exec = { name: 'read', callId: 'admitted', token: Symbol('admitted'), arguments: {}, agent: f.agent, signal: new AbortController().signal }
  // Inspecting this target would prove that an unrelated/disabled/late event was admitted.
  const uninspected = { get targetKey() { throw new Error('unadmitted target inspected') } }
  await f.emit('fs/observed', uninspected, { kind: 'present', version: 'v1' }, exec)
  f.setEnabled(false)
  await f.waterfall('tools/execute', exec, async () => {
    await f.emit('fs/observed', uninspected, { kind: 'present', version: 'v1' }, exec)
    return { isError: false, value, content: full }
  })
  f.setEnabled(true)
  const failure = new Error('native read failed after observation')
  await assert.rejects(f.waterfall('tools/execute', exec, async () => {
    await f.emit('fs/observed', { targetKey: 'local-realpath' }, { kind: 'present', version: 'v1' }, exec)
    throw failure
  }), error => error === failure)
  await f.emit('fs/observed', uninspected, { kind: 'present', version: 'v1' }, exec)
  await f.read('a'); await f.read('b')
  assert.equal(f.controller.prepareSession(f.agent).shortened, 1)
})

test('real alpha.5 Session validates and replays the surface replacements', {
  skip: !process.env.DSH_NATIVE_SESSION_MODULE,
}, async () => {
  const { Session: NativeSession } = await import(process.env.DSH_NATIVE_SESSION_MODULE)
  const f = fixture(), session = NativeSession.create('native-dedup-test')
  session.result = (callId, content = full) => session.append('tool/result', {
    message: { id: `message-${callId}`, role: 'tool', toolCallId: callId, source: { kind: 'tool', callId, name: 'read' }, content }, meta: { original: true },
  }, { surfaceOp: 'append' })
  f.agent.session = session
  await f.read('a'); await f.read('b')
  assert.equal(f.controller.prepareSession(f.agent).shortened, 1)
  assert.equal(readReference(session.deriveMessages()[1].content).source, 0)
  const replay = NativeSession.create('native-dedup-replay', session.snapshotEvents())
  assert.notEqual(readReference(replay.deriveMessages()[1].content), null)
  f.agent.session = replay
  f.setEnabled(false)
  assert.equal(f.controller.prepareSession(f.agent).restored, 1)
  assert.deepEqual(replay.deriveMessages()[1].content, full)
})
