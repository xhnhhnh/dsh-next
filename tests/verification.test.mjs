import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createVerificationCore, installVerification, normalizeVerificationChecks, readVerificationSnapshot, VERIFICATION_OUTPUT } from '../lib/verification.js'

const root = resolve('verification-fixture'), file = resolve(root, 'input.json'), schemaFile = resolve(root, 'schema.json')
const spec = { id: 'config', workspace: root, kind: 'json-syntax', file: 'input.json' }
const schemaSpec = { ...spec, kind: 'json-schema', schemaFile: 'schema.json' }
const signal = () => new AbortController().signal
const copy = value => structuredClone(value)
function fixture(extra = {}) {
  const records = []
  let text = '{"count":2}', version = 'v1', schema = '{"type":"object"}', schemaVersion = 's1', kind = 'json-syntax', epoch = 0, enabled = true, reads = 0, validateRuns = 0
  let onRead
  const options = {
    isEnabled: () => enabled, getEpoch: () => epoch,
    getChecks: () => [kind === 'json-schema' ? schemaSpec : spec],
    readSnapshot: async () => {
      reads += 1
      await onRead?.(reads)
      return { workspace: root, file, target: file, version, content: text, schemaFile, schemaTarget: schemaFile, schemaVersion, schemaContent: schema }
    },
    assertSupportedJsonSchema(value) { if (value.$ref) throw new Error('Unsupported schema') },
    validateJsonSchemaValue(_schema, value) { validateRuns += 1; return typeof value.count === 'number' ? [] : ['count must be a number'] },
    onRecord: record => records.push(record), ...extra,
  }
  const core = createVerificationCore(options)
  const agent = { session: { id: 'one', header: { cwd: root } } }
  const execution = (id = `call-${records.length}`) => ({ agent, name: 'next_verify', callId: id, token: Symbol(id), signal: signal() })
  async function verify(args = {}, { settle = true, exec = execution(), final = value => ({ isError: false, value: copy(value) }) } = {}) {
    const value = await core.verify({ check_id: 'config', ...args }, exec)
    if (settle) core.settle(exec, final(value))
    return { value, exec }
  }
  return { core, options, records, agent, execution, verify,
    setText: value => { text = value }, setVersion: value => { version = value },
    setSchema: value => { schema = value }, setSchemaVersion: value => { schemaVersion = value },
    setKind: value => { kind = value }, invalidate: () => { epoch += 1 }, setEnabled: value => { enabled = value }, onRead: fn => { onRead = fn },
    counts: () => ({ reads, validateRuns }),
  }
}

test('check registration rejects commands, duplicate ids, traversal and remote schema paths', () => {
  assert.deepEqual(normalizeVerificationChecks([spec]), [spec])
  for (const item of [
    [{ ...spec, command: 'npm test' }], [spec, spec], [{ ...spec, file: '../outside.json' }],
    [{ ...spec, workspace: 'relative' }], [{ ...spec, kind: 'bash' }], [{ ...schemaSpec, schemaFile: '../external.json' }],
  ]) assert.throws(() => normalizeVerificationChecks(item))
})

test('only accepted final success admits cache; reuse carries the original actual call id', async () => {
  const f = fixture()
  const pending = await f.verify({}, { settle: false, exec: f.execution('unsettled') })
  assert.equal(pending.value.status, 'executed')
  assert.equal((await f.verify({}, { exec: f.execution('accepted') })).value.status, 'executed')
  const reused = (await f.verify({}, { exec: f.execution('repeated') })).value
  assert.equal(reused.status, 'reused'); assert.equal(reused.passed, true)
  assert.equal(reused.source.originalCallId, 'accepted')
  assert.match(reused.inputHash, /^[a-f0-9]{64}$/)
  assert.equal(f.core.reports(f.agent).at(-1).status, 'reused')
})

test('post-policy error or replacement cannot cache an executed result', async () => {
  for (const final of [() => ({ isError: true }), value => ({ isError: false, value: { ...value, detail: 'replaced' } })]) {
    const f = fixture()
    await f.verify({}, { final })
    assert.equal(f.records[0].status, 'unknown')
    assert.equal((await f.verify()).value.status, 'executed')
  }
})

test('force rechecks unchanged inputs, schema checks use the injected native validator', async () => {
  const f = fixture(); f.setKind('json-schema')
  assert.equal((await f.verify()).value.status, 'executed')
  assert.equal((await f.verify()).value.status, 'reused')
  assert.equal((await f.verify({ force: true })).value.status, 'executed')
  assert.equal(f.counts().validateRuns, 2)
})

test('source bytes, source version, schema bytes and schema version each invalidate cache', async () => {
  for (const change of [f => f.setText('{"count":3}'), f => f.setVersion('v2'), f => f.setSchema('{"type":"object","properties":{}}'), f => f.setSchemaVersion('s2')]) {
    const f = fixture(); f.setKind('json-schema'); await f.verify(); change(f)
    assert.equal((await f.verify()).value.status, 'executed')
  }
})

test('cache belongs to the exact session and does not survive a new controller', async () => {
  const f = fixture(); await f.verify()
  const child = { session: { id: 'child', header: { cwd: root, parentSession: f.agent.session.id } } }
  const exec = { ...f.execution(), agent: child }
  assert.equal((await f.verify({}, { exec })).value.status, 'executed')
  const restarted = createVerificationCore(f.options)
  assert.equal((await restarted.verify({ check_id: 'config' }, f.execution())).status, 'executed')
})

test('invalid JSON and failed schema validation are real failures and never reusable', async () => {
  const f = fixture(); f.setText('{')
  assert.equal((await f.verify()).value.status, 'failed')
  assert.equal((await f.verify()).value.status, 'failed')
  f.setKind('json-schema'); f.setText('{"count":"bad"}')
  assert.equal((await f.verify()).value.passed, false)
  assert.equal((await f.verify()).value.status, 'failed')
})

test('unsupported/malformed schema, missing validator, inaccessible or oversized inputs remain unknown', async () => {
  const unsupported = fixture(); unsupported.setKind('json-schema'); unsupported.setSchema('{"$ref":"remote"}')
  assert.equal((await unsupported.verify()).value.status, 'unknown')
  unsupported.setSchema('{')
  assert.equal((await unsupported.verify()).value.status, 'unknown')
  const noValidator = fixture({ validateJsonSchemaValue: undefined }); noValidator.setKind('json-schema')
  assert.equal((await noValidator.verify()).value.status, 'unknown')
  const denied = fixture({ readSnapshot: async () => { throw new Error('access denied secret') } })
  assert.equal((await denied.verify()).value.status, 'unknown')
  assert.doesNotMatch(JSON.stringify(denied.records), /secret/)
  const large = fixture({ maxBytes: 2 })
  assert.equal((await large.verify()).value.status, 'unknown')
})

test('a change during validation or before final settlement invalidates the proof', async () => {
  const f = fixture(); f.onRead(read => { if (read === 2) f.setText('{"count":3}') })
  assert.equal((await f.verify()).value.status, 'unknown')
  const g = fixture(); const candidate = await g.verify({}, { settle: false }); g.invalidate()
  assert.equal(g.core.settle(candidate.exec, { isError: false, value: candidate.value }).status, 'unknown')
  assert.equal((await g.verify()).value.status, 'executed')
})

test('cancelled and disabled checks cannot publish reusable success', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort()
  assert.equal((await f.verify({}, { exec: { ...f.execution(), signal: controller.signal } })).value.status, 'unknown')
  f.setEnabled(false)
  assert.equal((await f.verify()).value.status, 'unknown')
  f.setEnabled(true)
  const candidate = await f.verify({}, { settle: false }); f.setEnabled(false)
  assert.equal(f.core.settle(candidate.exec, { value: candidate.value }).status, 'unknown')
})

test('LRU cache is bounded and reports contain no input or schema contents', async () => {
  const f = fixture({ maxEntries: 1 }); await f.verify(); f.setText('{"count":3}'); await f.verify(); f.setText('{"count":2}')
  assert.equal((await f.verify()).value.status, 'executed')
  assert.doesNotMatch(JSON.stringify(f.records), /"content"|schemaContent/)
})

test('disabling NEXT during a repeated input observation prevents reuse', async () => {
  const f = fixture(); await f.verify()
  f.onRead(() => f.setEnabled(false))
  assert.equal((await f.verify()).value.status, 'unknown')
})

test('an unsuccessful forced run removes the previous cached success', async () => {
  let passed = true
  const f = fixture({ validateJsonSchemaValue: () => passed ? [] : ['controlled validator failure'] }); f.setKind('json-schema')
  await f.verify(); passed = false
  assert.equal((await f.verify({ force: true })).value.status, 'failed')
  assert.equal((await f.verify()).value.status, 'failed')
})

test('audit callback errors cannot turn a real successful check into a failed native task', async () => {
  const f = fixture({ onRecord() { throw new Error('storage failed') }, onError() { throw new Error('logging failed') } })
  assert.equal((await f.verify()).value.status, 'executed')
})

function hostFixture(extra = {}) {
  const handlers = new Map(), definitions = new Map(), rows = new Map([
    [root, { type: 'directory', version: 'root' }],
    [file, { type: 'file', version: '1', content: '{"count":2}' }],
    [schemaFile, { type: 'file', version: 's1', content: '{"type":"object"}' }],
  ])
  const records = [], executions = [], allExecutions = []
  const agent = { session: { id: 'native-agent', header: { cwd: root } } }
  let active = true, auto = true, denied = false, malformed = false, deniedRead = null, truncateRead = false
  const nativeWrite = {}, nativeEdit = {}
  definitions.set('write', nativeWrite); definitions.set('edit', nativeEdit)
  async function emit(name, ...args) { for (const fn of handlers.get(name) ?? []) await fn(...args) }
  const ctx = {
    logger: { warn() {} },
    on(name, fn, options = {}) { const list = handlers.get(name) ?? []; options.prepend ? list.unshift(fn) : list.push(fn); handlers.set(name, list); return () => list.splice(list.indexOf(fn), 1) },
    fs: {
      async resolve(path, { cwd = root, signal: cancellation } = {}) { cancellation?.throwIfAborted(); const canonical = resolve(cwd, path); return { targetKey: canonical, displayPath: canonical } },
      processPath: target => target.targetKey,
      async stat(target) { if (denied) throw new Error('permission denied'); const row = rows.get(target.targetKey); return row && { type: row.type, version: row.version, size: Buffer.byteLength(row.content ?? '') } },
      async readText(target) { if (denied) throw new Error('permission denied'); return rows.get(target.targetKey).content },
    },
    workingDirectory: { ensure: async current => current.session.header.cwd },
    tools: {
      register(definition) { definitions.set(definition.name, definition); return () => definitions.delete(definition.name) },
      get: name => definitions.get(name),
      async execute(input) {
        allExecutions.push(input)
        if (input.name === 'next_verify') executions.push(input)
        const exec = { ...input, token: Symbol(input.callId) }
        if (input.name === 'read' && deniedRead === input.arguments.file_path) {
          const result = { isError: true, error: { message: 'read denied by current path policy' } }
          await emit('tools/result', exec, result)
          return result
        }
        const list = [...(handlers.get('tools/execute') ?? [])]
        const execute = async index => index < list.length ? list[index](exec, () => execute(index + 1))
          : { isError: false, value: copy(await definitions.get(input.name).execute(input.arguments, exec)) }
        const dispatched = await execute(0)
        const result = malformed ? { isError: true } : dispatched
        await emit('tools/result', exec, result)
        return result
      },
    },
  }
  definitions.set('read', { async execute(args, exec) {
    if (denied) throw new Error('permission denied')
    const row = rows.get(args.file_path)
    const raw = row.content.replace(/\r\n/g, '\n')
    const lines = raw === '' ? [] : raw.replace(/\n$/, '').split('\n')
    await emit('fs/observed', { targetKey: args.file_path }, { kind: 'present', version: row.version }, exec)
    return { path: args.file_path, offset: args.offset, totalLines: lines.length,
      lines: lines.slice(args.offset - 1, args.offset - 1 + args.limit).map((text, i) => ({ number: args.offset + i, text: truncateRead ? text.slice(0, 2) + '... (line truncated to 2 chars)' : text })) }
  } })
  const options = {
    defineTool: value => value, createUserMessage: value => ({ role: 'user', ...value }), isEnabled: () => active, autoEnabled: () => auto,
    getChecks: () => [schemaSpec], assertSupportedJsonSchema: () => {}, validateJsonSchemaValue: () => [],
    onRecord: record => records.push(record), ...extra,
  }
  const controller = installVerification(ctx, options)
  async function mutate({ name = 'write', success = true, observe = true, at = file, targetAgent = agent } = {}) {
    const exec = { agent: targetAgent, name, token: Symbol('mutation'), callId: 'write-id', signal: signal() }
    if (observe) await emit('fs/observed', { targetKey: at, displayPath: at }, { kind: 'present', version: '2' }, exec)
    await emit('tools/result', exec, { isError: !success, value: { path: at } })
  }
  async function step({ signal: stepSignal = signal(), decision = { kind: 'enter', messages: [] } } = {}) {
    const list = handlers.get('agent/pre-step') ?? []
    const payload = { agent, signal: stepSignal }
    const run = index => index < list.length ? list[index](payload, () => run(index + 1)) : Promise.resolve(decision)
    return run(0)
  }
  return { ctx, controller, agent, mutate, step, emit, rows, records, executions, allExecutions, definitions,
    setActive: value => { active = value }, setAuto: value => { auto = value }, setDenied: value => { denied = value }, setMalformed: value => { malformed = value },
    denyRead: value => { deniedRead = value }, truncateRead: value => { truncateRead = value } }
}

test('native snapshot uses full canonical project files and rereads permission even on a cache hit', async () => {
  const h = hostFixture()
  const snapshot = await readVerificationSnapshot(h.ctx, schemaSpec, { agent: h.agent, signal: signal() })
  assert.equal(snapshot.file, file); assert.equal(snapshot.content, '{"count":2}')
  const run = () => h.ctx.tools.execute({ name: 'next_verify', callId: 'manual', arguments: { check_id: 'config' }, agent: h.agent, signal: signal() })
  assert.equal((await run()).value.status, 'executed'); assert.equal((await run()).value.status, 'reused')
  h.setDenied(true)
  assert.equal((await run()).value.status, 'unknown')
})

test('a current read-path deny prevents both input and schema reuse and remains unknown', async () => {
  for (const deniedPath of [file, schemaFile]) {
    const h = hostFixture()
    const run = () => h.ctx.tools.execute({ name: 'next_verify', callId: `manual-${h.records.length}`, arguments: { check_id: 'config' }, agent: h.agent, signal: signal() })
    assert.equal((await run()).value.status, 'executed')
    h.denyRead(deniedPath)
    const denied = await run()
    assert.equal(denied.value.status, 'unknown'); assert.equal(denied.value.passed, null)
    assert.ok(h.allExecutions.some(exec => exec.name === 'read' && exec.arguments.file_path === deniedPath))
    assert.ok(h.allExecutions.filter(exec => exec.name === 'read').every(exec => exec.parent !== undefined), 'nested reads retain actual native parent identity')
    h.denyRead(null)
    assert.equal((await run()).value.status, 'reused')
  }
})

test('truncated native line content is unknown rather than a successful partial JSON check', async () => {
  const h = hostFixture(); h.truncateRead(true)
  const result = await h.ctx.tools.execute({ name: 'next_verify', callId: 'truncated', arguments: { check_id: 'config' }, agent: h.agent, signal: signal() })
  assert.equal(result.value.status, 'unknown'); assert.equal(result.value.passed, null)
})

test('only successful observed native write/edit schedules an awaited next-step verification', async () => {
  const h = hostFixture()
  await h.mutate()
  assert.equal(h.executions.length, 0, 'result observer does no background execution')
  const decision = await h.step()
  assert.equal(h.executions.length, 1); assert.equal(h.executions[0].name, 'next_verify')
  assert.equal(h.records[0].status, 'executed')
  assert.equal(decision.messages.length, 1); assert.match(decision.messages[0].content[0].text, /executed/)
  assert.equal(decision.messages[0].source.kind, 'plugin:next/verification')
  await h.step(); assert.equal(h.executions.length, 1)
  const notice=JSON.parse(decision.messages[0].content[0].text.split('\n')[1])
  assert.equal(notice.passed,true);assert.equal(notice.status,'executed');assert.equal(notice.file,file)
  assert.equal(notice.receipt,h.records[0].source.callId)
})

test('unknown tools, unobserved/failed writes and unrelated files do not trigger checks', async () => {
  const h = hostFixture()
  await h.mutate({ name: 'bash' }); await h.mutate({ name: 'mcp__write' }); await h.mutate({ observe: false }); await h.mutate({ success: false })
  await h.mutate({ at: resolve(root, 'unrelated.json') })
  await h.step(); assert.equal(h.executions.length, 0)
})

test('multiple edits are coalesced until the next step and schema mutations also trigger the check', async () => {
  const h = hostFixture()
  await h.mutate(); await h.mutate({ name: 'edit' }); await h.mutate({ at: schemaFile })
  await h.step(); assert.equal(h.executions.length, 1)
  await h.mutate({ at: schemaFile }); await h.step()
  assert.equal(h.executions.length, 2); assert.equal(h.records.at(-1).status, 'reused')
})

test('NEXT and auto switches gate scheduling, including changing NEXT after a dirty event', async () => {
  for (const control of ['setActive', 'setAuto']) {
    const h = hostFixture(); h[control](false); await h.mutate(); await h.step(); assert.equal(h.executions.length, 0)
    h[control](true); await h.mutate(); h[control](false); await h.step(); assert.equal(h.executions.length, 0)
  }
})

test('a completed check adds no notice when NEXT, automation or cancellation changes during a downstream pre-step wait', async t => {
  for (const scenario of ['NEXT off', 'automation off', 'payload cancelled', 'agent cancelled', 'unchanged']) {
    await t.test(scenario, async () => {
      let notices = 0, release, entered
      const waiting = new Promise(resolve => { entered = resolve })
      const blocked = new Promise(resolve => { release = resolve })
      const h = hostFixture({ createUserMessage(value) { notices += 1; return { role: 'user', ...value } } })
      const payloadCancellation = new AbortController(), agentCancellation = new AbortController()
      h.agent.signal = agentCancellation.signal
      const nativeMessage = { role: 'user', content: [{ type: 'text', text: 'native message' }] }
      const nativeDecision = { kind: 'enter', messages: [nativeMessage], nativeMarker: {} }
      const off = h.ctx.on('agent/pre-step', async (_payload, next) => {
        entered()
        await blocked
        return next()
      })
      await h.mutate()
      const pending = h.step({ signal: payloadCancellation.signal, decision: nativeDecision })
      await waiting
      assert.equal(h.executions.length, 1, 'the native check finishes before the downstream hook waits')
      assert.equal(h.records.length, 1)
      assert.equal(h.records[0].status, 'executed')
      if (scenario === 'NEXT off') h.setActive(false)
      if (scenario === 'automation off') h.setAuto(false)
      if (scenario === 'payload cancelled') payloadCancellation.abort()
      if (scenario === 'agent cancelled') agentCancellation.abort()
      release()
      const decision = await pending
      if (scenario === 'unchanged') {
        assert.equal(notices, 1)
        assert.equal(decision.messages.length, 2)
        assert.equal(decision.messages[0], nativeMessage)
        assert.equal(decision.messages[1].source.kind, 'plugin:next/verification')
      } else {
        assert.equal(notices, 0)
        assert.equal(decision, nativeDecision, 'the native decision is returned without cloning or changing its messages')
      }
      assert.equal(h.records.length, 1, 'completed verification audit remains available')
      assert.equal(h.records[0].status, 'executed')
      off(); h.setActive(true); h.setAuto(true); h.agent.signal = signal()
      await h.step()
      assert.equal(h.executions.length, 1, 'suppressed presentation does not schedule another check')
      assert.equal(h.records.length, 1)
    })
  }
})

test('native post-policy rejection is unknown, not reusable success, and does not break the step', async () => {
  const h = hostFixture(); h.setMalformed(true); await h.mutate()
  const decision = await h.step(); assert.equal(decision.kind, 'enter')
  assert.equal(h.records[0].status, 'unknown'); assert.match(decision.messages[0].content[0].text, /unknown/)
  h.setMalformed(false)
  assert.equal((await h.ctx.tools.execute({ name: 'next_verify', callId: 'second', arguments: { check_id: 'config' }, agent: h.agent, signal: signal() })).value.status, 'executed')
})

test('foreign project, symlink escape, moving target and unversioned data cannot pass', async () => {
  const h = hostFixture()
  h.agent.session.header.cwd = resolve(root, '../other')
  await assert.rejects(readVerificationSnapshot(h.ctx, spec, { agent: h.agent, signal: signal() }))
  h.agent.session.header.cwd = root
  const original = h.ctx.fs.resolve
  h.ctx.fs.resolve = async (path, options) => path === 'input.json' ? { targetKey: resolve(root, '../external.json') } : original(path, options)
  await assert.rejects(readVerificationSnapshot(h.ctx, spec, { agent: h.agent, signal: signal() }))
  h.ctx.fs.resolve = original; h.rows.get(file).version = undefined
  await assert.rejects(readVerificationSnapshot(h.ctx, spec, { agent: h.agent, signal: signal() }))
})

test('a changed canonical target while reading is rejected even when its bytes match', async () => {
  const h = hostFixture(), original = h.ctx.fs.resolve
  let count = 0
  h.ctx.fs.resolve = async (path, options) => {
    const target = await original(path, options)
    if (path === 'input.json' && ++count === 2) return { targetKey: `${file}-replacement` }
    return target
  }
  h.rows.set(`${file}-replacement`, { type: 'file', version: '1', content: '{"count":2}' })
  await assert.rejects(readVerificationSnapshot(h.ctx, spec, { agent: h.agent, signal: signal() }))
})

test('normal turn stopping drains pending checks without starting a model loop', async () => {
  const h = hostFixture(); await h.mutate()
  await h.emit('agent/turn-stopping', { agent: h.agent, signal: signal() })
  assert.equal(h.executions.length, 1); assert.equal(h.records[0].status, 'executed')
  assert.equal(h.executions[0].name, 'next_verify')
})

test('cancelled turn stopping preserves dirty inputs for the next valid pre-step', async () => {
  const h = hostFixture(); await h.mutate()
  const cancelled = new AbortController(); cancelled.abort()
  await h.emit('agent/turn-stopping', { agent: h.agent, signal: cancelled.signal })
  assert.equal(h.executions.length, 0)
  await h.step(); assert.equal(h.executions.length, 1)
})

test('failure to build a context notice preserves the native enter decision', async () => {
  const h = hostFixture({ createUserMessage() { throw new Error('unavailable') } }); await h.mutate()
  const decision = await h.step()
  assert.equal(decision.kind, 'enter'); assert.deepEqual(decision.messages, [])
  assert.equal(h.records[0].status, 'executed')
})

test('native denial before the validator runs is recorded as unknown', async () => {
  const h = hostFixture()
  const exec = { name: 'next_verify', arguments: { check_id: 'config' }, callId: 'denied', token: Symbol(), agent: h.agent }
  await h.emit('tools/result', exec, { isError: true })
  assert.equal(h.records[0].status, 'unknown'); assert.equal(h.records[0].source.callId, 'denied')
  assert.equal(h.records[0].passed, null)
})

test('disposing unregisters the owned tool and prevents future automatic dispatch', async () => {
  const h = hostFixture(); await h.mutate(); h.controller.dispose()
  assert.equal(h.definitions.has('next_verify'), false)
  await h.step(); assert.equal(h.executions.length, 0)
})

test('output declares explicit host DSL bounds and all observable statuses', () => {
  assert.equal(VERIFICATION_OUTPUT.additionalProperties, false)
  assert.deepEqual(VERIFICATION_OUTPUT.properties.status.enum, ['executed', 'reused', 'failed', 'unknown', 'expired'])
})
