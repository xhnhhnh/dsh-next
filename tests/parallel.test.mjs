import test from 'node:test'
import assert from 'node:assert/strict'
import { installParallel } from '../lib/parallel.js'

const task = (id, depends_on = []) => ({ id, prompt: `Inspect ${id} without modifying files.`, depends_on })
const args = tasks => ({ benefit: 'The independent file inspections avoid serial waiting.', tasks })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const collect = async source => { const chunks = []; for await (const chunk of source) chunks.push(chunk); return chunks }
const complete = async function* () {
  yield { type: 'usage', usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 1010 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture(overrides = {}) {
  const handlers = new Map(), trustedRead = {}, sessions = new Map(), nativeStructured = new Map()
  const budget = overrides.budget ?? { limitCny: 3, spentCny: 0, spentCnyExact: '0', reservations: {}, settledIds: [], children: [] }
  const events = [], activations = [], guards = new Map(), filters = new Map(), interrupted = [], disposed = []
  const parent = { id: 'root', options: { provider: 'fixture', model: 'fixed', reasoningEffort: 'max', maxTokens: 100 }, session: { id: 'root', header: {}, requestHeader: () => ({ config: { provider: 'fixture', model: 'fixed', reasoningEffort: 'max' } }) } }
  sessions.set(parent.id, parent.session)
  let enabled = true, active = 0, maxActive = 0, dispatches = 0, flushed = new Set()
  let controller
  const emit = async (name, ...payload) => { for (const callback of handlers.get(name) ?? []) await callback(...payload) }
  const request = childId => ({ sessionId: childId, provider: 'fixture', model: 'fixed', reasoningEffort: 'max', maxTokens: 100, signal: new AbortController().signal })
  const runStream = async (childId, source = complete, changes = {}) => collect(controller.wrap({ ...request(childId), ...changes }, () => {
    dispatches++
    assert.ok(Object.values(budget.reservations).some(item => item.childId === childId && flushed.has(item.id)), 'a durable reservation precedes dispatch')
    return source()
  }))
  const ctx = {
    logger: { warn() {} },
    sessions: { get: id => sessions.get(id) },
    on(name, callback) { const list = handlers.get(name) ?? []; list.push(callback); handlers.set(name, list); return () => list.splice(list.indexOf(callback), 1) },
    tools: { get: (name, agent) => name === 'read' ? trustedRead : name === 'structured_output' ? nativeStructured.get(agent.id) : undefined, register: () => () => {} },
    llm: { resolveCallConfig: async route => ({...route,...overrides.defaultEffort&&route.reasoningEffort===undefined?{reasoningEffort:overrides.defaultEffort}:{}}), resolveModelInfo: async () => overrides.info ?? { context: { contextWindow: 1_000_000 }, defaultMaxTokens: 100 } },
    subagents: {
      getProvider: name => name === 'spawn' ? { prepareContinuable() {} } : undefined,
      resolveMaxDepth: () => overrides.depth ?? 1,
      interrupt(id, authority) { assert.equal(authority.kind, 'ancestor'); assert.equal(authority.agent, parent); interrupted.push(id) },
      async startActivation(spec) {
        activations.push(spec); active++; maxActive = Math.max(maxActive, active)
        const child = { id: spec.childId, options: { ...spec.request.agentOptions, subagentDepth: 1 }, session: { id: spec.childId, header: { parentSession: parent.id } }, ctx: { tools: {
          restrict(filter) { filters.set(child.id, filter) }, guard(guard) { guards.set(child.id, guard) },
        } } }
        sessions.set(child.id, child.session); nativeStructured.set(child.id, {})
        const outcome = deferred(), release = deferred()
        let released = false
        const handle = { childId: child.id, result: outcome.promise, async dispose() {
          if (!released) { released = true; disposed.push(child.id); active--; release.resolve(); outcome.resolve({ stopReason: 'aborted', output: [] }) }
        } }
        await emit('agent/created', { agent: child })
        void Promise.resolve().then(async () => {
          try {
            const terminal = overrides.work
              ? await overrides.work({ spec, child, runStream, release: release.promise })
              : (await runStream(child.id), { stopReason: 'completed', structured: { summary: spec.label, findings: [] }, output: [] })
            outcome.resolve(terminal)
          } catch { outcome.resolve({ stopReason: 'error', output: [] }) }
        })
        return handle
      },
    },
  }
  const options = {
    defineTool: value => value, isEnabled: () => enabled, getRoot: () => parent.session,
    getPrices: () => overrides.prices ?? [{ provider: 'fixture', model: 'fixed', input: 1, cacheRead: 0.1, cacheWrite: 1, output: 1 }],
    priceValidUntil: overrides.expiry ?? Date.now() + 60000,
    readOnlyDefinitions: new Map([['read', trustedRead]]),
    getBudget: () => budget,
    appendBudget(_root, event) {
      events.push(event)
      if (event.kind === 'reserve') { budget.reservations[event.id] = event; if (!budget.children.includes(event.childId)) budget.children.push(event.childId) }
      else if (event.kind === 'unknown') budget.reservations[event.id].reason = event.reason
      else if (event.kind === 'settle' && !budget.settledIds.includes(event.recordId)) {
        budget.settledIds.push(event.recordId); delete budget.reservations[event.id]
        budget.spentCny = Number((budget.spentCny + event.costCny).toFixed(10)); budget.spentCnyExact = String(budget.spentCny)
      }
    },
    async flush() { if (overrides.flushFails || overrides.settleFlushFails && events.at(-1)?.kind === 'settle') throw new Error('disk unavailable'); flushed = new Set(Object.keys(budget.reservations)) },
  }
  controller = installParallel(ctx, options)
  return { controller, parent, options, ctx, budget, events, activations, guards, filters, interrupted, disposed, emit, runStream,
    execute: (tasks, signal) => controller.execute(args(tasks), { agent: parent, signal }),
    setEnabled: value => { enabled = value }, maxActive: () => maxActive, dispatches: () => dispatches }
}

test('runs a dependency DAG with two native children, preserved route and confirmed read-only capabilities', async () => {
  const gates = [deferred(), deferred()]
  const f = fixture({ work: async ({ spec, child, runStream }) => {
    if (spec.label !== 'NEXT c') await gates[spec.label === 'NEXT a' ? 0 : 1].promise
    await runStream(child.id)
    return { stopReason: 'completed', structured: { summary: spec.label, findings: [] } }
  } })
  const execution = f.execute([task('a'), task('b'), task('c', ['a', 'b'])])
  for (let pass = 0; pass < 10 && f.activations.length < 2; pass++) await tick()
  assert.equal(f.activations.length, 2)
  gates.forEach(gate => gate.resolve())
  const result = await execution
  assert.deepEqual(result.tasks.map(item => item.status), ['completed', 'completed', 'completed'])
  assert.equal(f.maxActive(), 2)
  assert.equal(f.dispatches(), 3)
  for (const spec of f.activations) {
    assert.equal(spec.provider, 'spawn'); assert.equal(spec.delivery, 'caller'); assert.equal(spec.request.parent, f.parent)
    assert.deepEqual(spec.request.agentOptions, f.parent.options); assert.equal(spec.request.maxDepth, 1)
    assert.deepEqual(f.filters.get(spec.childId), { allow: ['read'] })
    assert.equal(f.guards.get(spec.childId)({ name: 'read' }), undefined)
    assert.match(f.guards.get(spec.childId)({ name: 'bash' }), /read-only/u)
  }
  assert.match(f.activations[2].request.prompt[0].text, /Completed dependency results/u)
  assert.equal(f.disposed.length, 3)
  assert.equal(Object.keys(f.budget.reservations).length, 0)
  assert.equal(f.budget.spentCny, 0.00303)
  await f.controller.dispose()
})

test('rejects malformed, duplicate and cyclic tasks before creating any child', async () => {
  const f = fixture()
  await assert.rejects(f.controller.execute({ tasks: [task('a')] }, { agent: f.parent }), /benefit/u)
  for (const tasks of [[task('a'), task('a')], [task('a', ['missing'])], [task('a', ['b']), task('b', ['a'])]]) await assert.rejects(f.execute(tasks))
  assert.equal(f.activations.length, 0)
  f.parent.options.subagentDepth = 1
  await assert.rejects(f.execute([task('a')]), /recurse/u)
})

test('budget reservation is serialized before dispatch and cannot overspend under two simultaneous children', async () => {
  const gate = deferred()
  const f = fixture({ budget: { limitCny: 1.5, spentCny: 0, reservations: {}, settledIds: [], children: [] }, work: async ({ child, runStream }) => {
    await runStream(child.id, async function* () { await gate.promise; yield* complete() })
    return { stopReason: 'completed', structured: { summary: 'ok', findings: [] } }
  } })
  const execution = f.execute([task('a'), task('b')])
  for (let pass = 0; pass < 10 && f.dispatches() < 1; pass++) await tick()
  assert.equal(f.dispatches(), 1)
  assert.equal(Object.keys(f.budget.reservations).length, 1)
  gate.resolve()
  const result = await execution
  assert.equal(result.tasks.filter(item => item.status === 'completed').length, 2)
  assert.equal(result.tasks.filter(item => item.status === 'failed').length, 0)
  assert.equal(f.dispatches(),2,'the second child waits for the first reservation to settle')
})

test('ordinary requests pass through and disabled, expired or missing prices never create automatic paid work', async () => {
  const f = fixture(), source = complete()
  assert.equal(f.controller.wrap({ sessionId: 'ordinary' }, () => source), source)
  f.setEnabled(false)
  await assert.rejects(f.execute([task('a')]), /off/u)
  for (const options of [{ expiry: Date.now() - 1 }, { prices: [] }]) {
    const invalid = fixture(options)
    await assert.rejects(invalid.execute([task('a')]))
    assert.equal(invalid.activations.length, 0)
    assert.equal(invalid.dispatches(), 0)
  }
})

test('unknown usage holds durable reservations across restart and historical children cannot resume unmetered', async () => {
  const f = fixture({ work: async ({ child, runStream }) => {
    await runStream(child.id, async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
    return { stopReason: 'completed', structured: { summary: 'answer', findings: [] } }
  } })
  const first = await f.execute([task('a'), task('b'), task('c')])
  assert.equal(f.dispatches(), 2)
  assert.equal(Object.keys(f.budget.reservations).length, 2)
  assert.equal(first.tasks.filter(item => item.budgetUnknown).length, 2)
  await f.controller.dispose()
  const resumed = fixture({ budget: f.budget })
  const again = await resumed.execute([task('d')])
  assert.equal(again.tasks[0].status, 'failed')
  assert.equal(resumed.dispatches(), 0)
  const oldId = f.budget.children[0]
  await resumed.emit('agent/created', { agent: { id: oldId, session: { id: oldId, header: { parentSession: 'root' } }, ctx: { tools: { guard() {} } } } })
  // getRoot needs complete lineage; the mock's root is present, as in the native session store.
  assert.throws(() => resumed.controller.wrap({ sessionId: oldId }, () => { throw new Error('provider must not run') }), /previous NEXT/u)
})

test('cancellation interrupts and disposes admitted children, while pending tasks never start', async () => {
  const f = fixture({ work: async ({ release }) => { await release; return { stopReason: 'aborted', output: [] } } })
  const cancel = new AbortController(), execution = f.execute([task('a'), task('b'), task('c')], cancel.signal)
  for (let pass = 0; pass < 10 && f.activations.length < 2; pass++) await tick()
  cancel.abort()
  const result = await execution
  assert.equal(f.activations.length, 2)
  assert.equal(f.interrupted.length, 2)
  assert.equal(f.disposed.length, 2)
  assert.ok(result.tasks.every(item => item.status === 'cancelled'))
})

test('persistence failure before dispatch fails closed without limiting ordinary work', async () => {
  const f = fixture({ flushFails: true })
  const result = await f.execute([task('a')])
  assert.equal(result.tasks[0].status, 'failed')
  assert.equal(f.dispatches(), 0)
  assert.equal(Object.keys(f.budget.reservations).length, 1)
  let ordinary = 0
  f.controller.wrap({ sessionId: 'ordinary' }, () => { ordinary++; return complete() })
  assert.equal(ordinary, 1)
})

test('missing model bounds and changed child routes cannot dispatch providers', async () => {
  const unknown = fixture({ info: { defaultMaxTokens: 100 } })
  assert.equal((await unknown.execute([task('a')])).tasks[0].status, 'failed')
  assert.equal(unknown.dispatches(), 0)
  const route = fixture({ work: async ({ child, runStream }) => {
    await runStream(child.id, complete, { model: 'other-model' })
    return { stopReason: 'completed', structured: {} }
  } })
  assert.equal((await route.execute([task('a')])).tasks[0].status, 'failed')
  assert.equal(route.dispatches(), 0)
})

test('every retry settles separately, cumulative usage settles once, and dependency failures block downstream work', async () => {
  const f = fixture({ work: async ({ child, runStream }) => {
    await assert.rejects(runStream(child.id, async function* () { yield* complete(); throw new Error('attempt failed') }))
    await runStream(child.id, async function* () { yield* complete(); yield* complete() })
    return { stopReason: 'error', output: [] }
  } })
  const result = await f.execute([task('a'), task('b', ['a'])])
  assert.deepEqual(result.tasks.map(item => item.status), ['failed', 'blocked'])
  assert.equal(f.dispatches(), 2)
  assert.equal(f.events.filter(event => event.kind === 'settle').length, 2)
  assert.equal(f.budget.spentCny, 0.00202)
  assert.equal(Object.keys(f.budget.reservations).length, 0)
})

test('a root cannot create overlapping batches that exceed the two-child concurrency cap', async () => {
  const gate = deferred()
  const f = fixture({ work: async ({ release }) => { await Promise.race([gate.promise, release]); return { stopReason: 'completed', structured: {} } } })
  const first = f.execute([task('a'), task('b')])
  for (let pass = 0; pass < 10 && f.activations.length < 2; pass++) await tick()
  await assert.rejects(f.execute([task('c')]), /Another NEXT parallel batch/u)
  gate.resolve(); await first
  assert.equal(f.maxActive(), 2)
})

test('a setting change preserves an admitted call settlement and blocks the next child request', async () => {
  const admitted = deferred(), finish = deferred()
  const f = fixture({ work: async ({ child, runStream }) => {
    await runStream(child.id, async function* () { admitted.resolve(); await finish.promise; yield* complete() })
    await assert.rejects(runStream(child.id), /cancelled/u)
    return { stopReason: 'completed', structured: { summary: 'completed admitted call', findings: [] } }
  } })
  const execution = f.execute([task('a'), task('b', ['a'])])
  await admitted.promise
  f.setEnabled(false); finish.resolve()
  const result = await execution
  assert.equal(f.dispatches(), 1)
  assert.equal(f.events.filter(event => event.kind === 'settle').length, 1)
  assert.equal(result.tasks[0].status, 'completed')
  assert.equal(result.tasks[1].status, 'cancelled')
})

test('failed durable settlement blocks further automation and is visible in the task result', async () => {
  const f = fixture({ settleFlushFails: true })
  const result = await f.execute([task('a'), task('b', ['a'])])
  assert.equal(f.dispatches(), 1)
  assert.deepEqual(result.tasks.map(item => item.status), ['failed', 'blocked'])
  assert.match(result.tasks[0].error, /accounting/u)
})

test('incomplete lineage rejects automated children without affecting the normal parent stream', async () => {
  const f = fixture()
  f.parent.session.header.parentSession = 'missing-ancestor'
  await assert.rejects(f.execute([task('a')]), /complete session lineage/u)
  assert.equal(f.activations.length, 0)
  const stream = complete()
  assert.equal(f.controller.wrap({ sessionId: f.parent.id }, () => stream), stream)
})

test('partial usage after an interrupted provider retains its reservation and reports unknown budget', async () => {
  const f = fixture({ work: async ({ child, runStream }) => {
    await assert.rejects(runStream(child.id, async function* () { yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } }; throw new Error('transport lost') }))
    return { stopReason: 'error', output: [] }
  } })
  const result = await f.execute([task('a')])
  assert.equal(result.tasks[0].status, 'failed')
  assert.equal(result.tasks[0].budgetUnknown, true)
  assert.equal(Object.keys(f.budget.reservations).length, 1)
  assert.equal(f.budget.spentCny, 0)
})

test('unload cancels and disposes only NEXT children before releasing its hooks', async () => {
  const f = fixture({ work: async ({ release }) => { await release; return { stopReason: 'aborted', output: [] } } })
  const execution = f.execute([task('a'), task('b')])
  for (let pass = 0; pass < 10 && f.activations.length < 2; pass++) await tick()
  await f.controller.dispose()
  assert.ok((await execution).tasks.every(item => item.status === 'cancelled'))
  assert.equal(f.interrupted.length, 2)
  assert.equal(f.disposed.length, 2)
})

test('the native depth-zero setting disables delegation and a larger setting never permits NEXT recursion', async () => {
  const disabled = fixture({ depth: 0 })
  await assert.rejects(disabled.execute([task('a')]), /depth policy disables/u)
  assert.equal(disabled.activations.length, 0)
  assert.equal(disabled.dispatches(), 0)
  const deeper = fixture({ depth: 8 })
  assert.equal((await deeper.execute([task('a')])).tasks[0].status, 'completed')
  assert.equal(deeper.activations[0].request.maxDepth, 1)
})

test('adapter default effort is materialized, explicit effort is preserved and automatic child output is capped', async () => {
  const f=fixture({defaultEffort:'max'})
  delete f.parent.options.reasoningEffort
  f.parent.session.requestHeader=()=>undefined
  f.parent.options.maxTokens=384000
  const result=await f.execute([task('a')])
  assert.equal(result.tasks[0].status,'completed')
  assert.equal(f.activations[0].request.agentOptions.reasoningEffort,'max')
  assert.equal(f.activations[0].request.agentOptions.maxTokens,8192)
  assert.equal(f.parent.options.maxTokens,384000,'the parent output choice is untouched')
  const explicit=fixture({defaultEffort:'low'})
  await explicit.execute([task('a')])
  assert.equal(explicit.activations[0].request.agentOptions.reasoningEffort,'max')
})

test('a durable owner marker blocks orphan dispatch before an asynchronous created observer can run', () => {
  const f=fixture()
  f.options.isOwnedSession=()=>true
  f.ctx.sessions.get=id=>id==='orphan'?{id,header:{parentSession:'unloaded-root'}}:undefined
  assert.throws(()=>f.controller.wrap({sessionId:'orphan'},()=>{throw new Error('Provider must not run')}),/previous NEXT automation child/)
})

test('cold owned children receive a tool guard even when the parent chain is not loaded', async () => {
  const f=fixture()
  f.options.isOwnedSession=()=>true
  f.options.getRoot=()=>{throw new Error('Parent is not loaded')}
  let guard
  await f.emit('agent/created',{agent:{id:'orphan',session:{id:'orphan',header:{parentSession:'unloaded-parent'}},ctx:{tools:{guard(value){guard=value}}}}})
  assert.match(guard({name:'write'}),/newly budgeted parent batch/)
})

test('waiting for reservation capacity is cancellable and does not admit an additional provider', async () => {
  const admitted=deferred(),cancel=new AbortController()
  const f=fixture({budget:{limitCny:1.5,spentCny:0,spentCnyExact:'0',reservations:{},settledIds:[],children:[]},work:async({child,runStream})=>{
    await runStream(child.id,async function*(){admitted.resolve();await new Promise(resolve=>cancel.signal.addEventListener('abort',resolve,{once:true}));yield*complete()})
    return {stopReason:'completed',structured:{summary:'finished admitted call',findings:[]}}
  }})
  const running=f.execute([task('a'),task('b')],cancel.signal)
  await admitted.promise
  await tick()
  assert.equal(f.dispatches(),1)
  cancel.abort()
  const result=await running
  assert.equal(f.dispatches(),1)
  assert.ok(result.tasks.every(item=>item.status==='cancelled'||item.status==='completed'))
})

test('an automatic child with its own NEXT explicitly off cannot dispatch its first request', async () => {
  const ready=deferred(),go=deferred(),states=new Map([['root',true]])
  let childId
  const f=fixture({work:async({child,runStream})=>{
    childId=child.id;ready.resolve();await go.promise
    await runStream(child.id)
    return {stopReason:'completed',structured:{summary:'must not complete',findings:[]}}
  }})
  f.options.isEnabled=agent=>states.get(agent.id)!==false
  const execution=f.execute([task('a')]);await ready.promise
  states.set(childId,false);go.resolve()
  const result=await execution
  assert.notEqual(result.tasks[0].status,'completed')
  assert.equal(f.dispatches(),0);assert.equal(f.events.filter(e=>e.kind==='reserve').length,0)
})

test('an admitted child call settles after its local NEXT turns off, and the next call is rejected',async()=>{
  const states=new Map([['root',true]])
  const f=fixture({work:async({child,runStream})=>{
    await runStream(child.id,async function*(){states.set(child.id,false);yield*complete()})
    await assert.rejects(runStream(child.id),/cancelled/)
    return {stopReason:'completed',structured:{summary:'admitted work finished',findings:[]}}
  }})
  f.options.isEnabled=agent=>states.get(agent.id)!==false
  await f.execute([task('a')])
  assert.equal(f.dispatches(),1);assert.equal(f.events.filter(e=>e.kind==='settle').length,1)
  assert.equal(Object.keys(f.budget.reservations).length,0);assert.equal(f.budget.spentCny,0.00101)
})

test('a local switch change during model lookup is rechecked before a reservation is persisted',async()=>{
  const states=new Map([['root',true]])
  const f=fixture({work:async({child,runStream})=>{
    f.ctx.llm.resolveModelInfo=async()=>{states.set(child.id,false);return{context:{contextWindow:1000000},defaultMaxTokens:100}}
    await runStream(child.id)
    return {stopReason:'completed',structured:{}}
  }})
  f.options.isEnabled=agent=>states.get(agent.id)!==false
  await f.execute([task('a')])
  assert.equal(f.dispatches(),0);assert.equal(f.events.length,0)
})

test('closing NEXT while reservation flushes releases only the known undispatched reservation',async()=>{
  const states=new Map([['root',true]])
  const f=fixture()
  f.options.isEnabled=agent=>states.get(agent.id)!==false
  const originalFlush=f.options.flush
  f.options.flush=async()=>{
    await originalFlush()
    const reservation=Object.values(f.budget.reservations)[0]
    if(reservation)states.set(reservation.childId,false)
  }
  await f.execute([task('a')])
  assert.equal(f.dispatches(),0)
  assert.equal(Object.keys(f.budget.reservations).length,0)
  assert.equal(f.budget.spentCny,0)
  assert.equal(f.events.filter(e=>e.kind==='unknown').length,0)
  assert.equal(f.events.filter(e=>e.kind==='settle'&&e.costCnyExact==='0').length,1)
})
