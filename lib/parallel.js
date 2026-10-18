import { randomUUID } from 'node:crypto'
import { canReserveBudget, createMeter, estimateCallReservation } from './meter.js'

const positive = value => Number.isSafeInteger(value) && value > 0
const abortError = () => Object.assign(new Error('NEXT parallel work was cancelled.'), { name: 'AbortError' })
const admissionError = (code, message) => Object.assign(new Error(message), { nextAdmissionCode: code })
const boundedError = error => error?.name === 'AbortError' ? 'Cancelled.' : 'NEXT parallel work could not complete; see the host log.'
const terminalReasons = new Set(['completed', 'aborted', 'error', 'max-tokens', 'refusal'])
const resultSchema = { type: 'object', properties: { summary: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'findings'], additionalProperties: false }

/** Exact nonnegative CNY addition for durable reservation strings. */
function sumCny(values) {
  const parsed = values.map(value => {
    const text = String(value), match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(text)
    if (!match || text.length > 80 || Math.abs(Number(match[3] ?? 0)) > 40) throw new TypeError('Invalid NEXT budget amount.')
    const scale = (match[2]?.length ?? 0) - Number(match[3] ?? 0)
    const units = BigInt(match[1] + (match[2] ?? ''))
    return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale }
  })
  const scale = Math.max(0, ...parsed.map(value => value.scale))
  const units = parsed.reduce((sum, value) => sum + value.units * 10n ** BigInt(scale - value.scale), 0n)
  if (units === 0n) return '0'
  const digits = units.toString().padStart(scale + 1, '0')
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/u, '')
}

function validateTasks(args) {
  if (!args || typeof args.benefit !== 'string' || !args.benefit.trim() || args.benefit.length > 2000
    || !Array.isArray(args.tasks) || args.tasks.length < 1 || args.tasks.length > 8) throw new TypeError('NEXT parallel requires a benefit and 1..8 tasks.')
  const tasks = args.tasks.map(task => {
    if (!task || typeof task.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(task.id)
      || typeof task.prompt !== 'string' || !task.prompt.trim() || task.prompt.length > 16000
      || !Array.isArray(task.depends_on) || !task.depends_on.every(id => typeof id === 'string')) throw new TypeError('Invalid NEXT parallel task.')
    return { id: task.id, prompt: task.prompt, depends_on: [...new Set(task.depends_on)] }
  })
  const byId = new Map(tasks.map(task => [task.id, task]))
  if (byId.size !== tasks.length) throw new TypeError('NEXT parallel task ids must be unique.')
  const visited = new Set(), visiting = new Set()
  const visit = id => {
    if (!byId.has(id)) throw new TypeError('NEXT parallel dependency is missing.')
    if (visiting.has(id)) throw new TypeError('NEXT parallel dependencies must be acyclic.')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id).depends_on) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const task of tasks) visit(task.id)
  return tasks
}

/**
 * Host adapters own durable projection state. reserve must be durable BEFORE provider
 * dispatch; settle removes only its reservation, unknown never releases one. Default
 * public meter behavior is untouched. Only this module's reserved children are metered.
 *
 * options: defineTool, isEnabled(agent), getRoot(agent), getPrices(), priceValidUntil,
 * getBudget(root), appendBudget(root,event), flush(root), readOnlyDefinitions Map.
 * getBudget: {limitCny,spentCny,spentCnyExact?,reservations:{[id]:{amountCny,amountCnyExact}},settledIds:[]}.
 */
export function installParallel(ctx, options) {
  const required = ['isEnabled', 'getRoot', 'getPrices', 'getBudget', 'appendBudget', 'flush']
  if (!options || required.some(key => typeof options[key] !== 'function')) throw new TypeError('NEXT parallel requires durable budget and capability adapters.')
  const children = new Map(), orphanedChildren = new Set(), activeRoots = new Set(), locks = new Map(), blockedRoots = new Set(), batches = new Set(), off = []
  const waiters = new Map()
  const wake = root => { const waiting = waiters.get(root.id); waiters.delete(root.id); for (const finish of waiting ?? []) finish() }
  const waitForBudget = (root,signal) => {
    const waiting = waiters.get(root.id) ?? new Set(); waiters.set(root.id,waiting)
    return new Promise((resolve,reject) => {
      const finish = () => { waiting.delete(finish); signal?.removeEventListener('abort',cancel); resolve() }
      const cancel = () => { waiting.delete(finish); signal?.removeEventListener('abort',cancel); reject(abortError()) }
      waiting.add(finish); signal?.addEventListener('abort',cancel,{once:true}); if(signal?.aborted)cancel()
    })
  }
  let disposed = false
  const warn = error => { try { ctx.logger?.warn?.(`NEXT parallel: ${error?.message ?? 'host operation failed'}`) } catch {} }
  const now = options.now ?? Date.now
  const childEnabled = child => Boolean(child.agent) && options.isEnabled(child.parent) && options.isEnabled(child.agent)
  const serial = async (root, operation) => {
    const previous = locks.get(root.id) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    locks.set(root.id, current)
    try { return await current }
    finally { if (locks.get(root.id) === current) locks.delete(root.id) }
  }
  const persist = async (root, event) => {
    try { await options.appendBudget(root, event); await options.flush(root); if(event.kind!=='reserve')wake(root) }
    catch (error) { blockedRoots.add(root.id); wake(root); warn(error); throw new Error('NEXT automation budget could not be persisted.') }
  }
  const rootOf = async agent => {
    const root = await options.getRoot(agent)
    if (!root?.id || !agent?.session) throw new Error('NEXT automation root is unavailable.')
    const seen = new Set()
    let current = agent.session
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      if (!current.header.parentSession) {
        if (current.id === root.id) return root
        break
      }
      current = ctx.sessions?.get(current.header.parentSession)
    }
    throw new Error('NEXT automation requires complete session lineage.')
  }
  const pricesFor = async (provider, model) => {
    const rawExpiry = typeof options.priceValidUntil === 'function' ? await options.priceValidUntil() : options.priceValidUntil
    const expiresAt = typeof rawExpiry === 'number' ? rawExpiry : Date.parse(rawExpiry)
    if (!Number.isFinite(expiresAt) || now() >= expiresAt) throw admissionError('prices-unavailable', 'NEXT automation prices are missing or expired.')
    const all = await options.getPrices()
    const matched = Array.isArray(all) ? all.filter(price => price.provider === provider && price.model === model) : []
    if (matched.length !== 1) throw admissionError('prices-unavailable', 'NEXT automation needs one confirmed price for the selected model.')
    return { price: matched[0], expiresAt }
  }

  async function reserve(child, request) {
    if (disposed || child.stopping || !child.ready || !childEnabled(child) || request.signal?.aborted) throw abortError()
    if (request.provider !== child.route.provider || request.model !== child.route.model || request.reasoningEffort !== child.route.reasoningEffort) {
      throw admissionError('route-mismatch', 'NEXT automation cannot change the selected model or reasoning effort.')
    }
    if (!child.markerFlushed && options.flushChild) { await options.flushChild(child.id); child.markerFlushed = true }
    const { price, expiresAt } = await pricesFor(request.provider, request.model)
    const info = await ctx.llm.resolveModelInfo(request.provider, request.model, request.signal)
    const inputTokens = info?.context?.contextWindow, maxOutputTokens = request.maxTokens ?? info?.defaultMaxTokens
    if (!positive(inputTokens) || !positive(maxOutputTokens)) throw admissionError('model-bounds-unavailable', 'NEXT automation cannot confirm the model context or maximum output.')
    const estimate = estimateCallReservation({ inputTokens, maxOutputTokens, price })
    while(true) {
    const admitted = await serial(child.root, async () => {
      if (blockedRoots.has(child.root.id) || now() >= expiresAt || request.signal?.aborted || !childEnabled(child)) throw admissionError('budget-unavailable', 'NEXT automation admission is unavailable.')
      const budget = await options.getBudget(child.root)
      if (request.signal?.aborted || !childEnabled(child)) throw abortError()
      if (!budget || !budget.reservations || typeof budget.reservations !== 'object') throw admissionError('budget-unavailable', 'NEXT automation budget is unavailable.')
      if (Object.values(budget.reservations).some(item=>item.unknown||item.reason)) throw admissionError('budget-unavailable','NEXT automation has unsettled consumption; no new request was started.')
      const configuredLimit = Number(budget.limitCny)
      if (!Number.isFinite(configuredLimit) || configuredLimit < 0) throw admissionError('budget-unavailable', 'NEXT automation budget is invalid.')
      const spentCny = sumCny([budget.spentCnyExact ?? budget.spentCny])
      const reservedCny = sumCny(Object.values(budget.reservations).map(item => item?.amountCnyExact ?? item?.amountCny))
      const limitCny = Math.min(3,configuredLimit)
      if (!canReserveBudget({ limitCny, spentCny, reservedCny }, estimate.costCnyExact)) {
        const outstanding = Object.values(budget.reservations)
        if (canReserveBudget({limitCny,spentCny},estimate.costCnyExact) && outstanding.length
          && outstanding.every(item=>!item.unknown&&!item.reason&&children.has(item.childId))) {
          return { waiting: waitForBudget(child.root,request.signal) }
        }
        throw admissionError('budget-exhausted', 'NEXT automation budget cannot admit another request.')
      }
      const id = randomUUID()
      await persist(child.root, { kind: 'reserve', id, childId: child.id, amountCny: estimate.costCny, amountCnyExact: estimate.costCnyExact, provider: request.provider, model: request.model, maxInputTokens: inputTokens, maxOutputTokens, at: now() })
      return { id, price, expiresAt, amountCnyExact: estimate.costCnyExact }
    })
    if (!admitted.waiting) return admitted
    await admitted.waiting
    }
  }

  function wrap(request, next) {
    if (orphanedChildren.has(request.sessionId)) throw new Error('A previous NEXT automation child cannot resume outside a newly budgeted batch.')
    const child = children.get(request.sessionId)
    if (!child) {
      const session = request.sessionId && ctx.sessions?.get(request.sessionId)
      if (!session?.header.parentSession) return next()
      // Own child markers are synchronous even when lineage observers have not finished.
      if (options.isOwnedSession?.(session) === true) throw new Error('A previous NEXT automation child cannot resume outside a newly budgeted batch.')
      return next()
    }
    return (async function* () {
      let reservation
      try { reservation = await reserve(child, request) }
      catch (error) {
        if (error?.nextAdmissionCode) child.admissionFailure = { code: error.nextAdmissionCode, message: error.message }
        throw error
      }
      let settled = false, dispatchStarted = false
      const releaseUndispatched = () => serial(child.root, () => persist(child.root, {
        kind: 'settle', id: reservation.id, recordId: `undispatched:${reservation.id}`, costCny: 0, costCnyExact: '0', at: now(),
      }))
      const meter = createMeter({ prices: [reservation.price], retainRecords: false, onRecord: async record => {
        settled = true
        // A switch can change while the durable reservation is being flushed.
        // Until the downstream continuation starts, no provider can have charged it.
        if (!dispatchStarted) {
          try { await releaseUndispatched() } catch { child.budgetError = true }
          return
        }
        if (record.costCnyExact === null) child.unknownUsage = true
        else if (!canReserveBudget({ limitCny: reservation.amountCnyExact }, record.costCnyExact)) {
          blockedRoots.add(child.root.id); child.budgetError = true
        }
        try {
          await serial(child.root, () => persist(child.root, record.costCnyExact === null
            ? { kind: 'unknown', id: reservation.id, recordId: record.id, reason: record.unknownReasons.join(',') || 'usage-incomplete', at: now() }
            : { kind: 'settle', id: reservation.id, recordId: record.id, costCny: record.costCny, costCnyExact: record.costCnyExact, at: now() }))
        } catch { child.budgetError = true }
      } })
      try {
        if (request.signal?.aborted || disposed || child.stopping || !childEnabled(child)) throw abortError()
        if (now() >= reservation.expiresAt) throw admissionError('prices-unavailable', 'NEXT automation prices expired before dispatch.')
        yield* meter.wrap(request, () => {
          if (request.signal?.aborted || disposed || child.stopping || !childEnabled(child)) throw abortError()
          dispatchStarted = true
          return next()
        })
      } finally {
        if (!settled) {
          try {
            if (!dispatchStarted) await releaseUndispatched()
            else await serial(child.root, () => persist(child.root, { kind: 'unknown', id: reservation.id, reason: 'dispatch-not-settled', at: now() }))
          }
          catch { child.budgetError = true }
        }
      }
    })()
  }

  const created = async ({ agent }) => {
    const child = children.get(agent.id)
    if (!child) {
      if(options.isOwnedSession?.(agent.session)===true) {
        orphanedChildren.add(agent.id)
        agent.ctx.tools.guard(()=>'Resume NEXT automation through a newly budgeted parent batch.')
        return
      }
      // Durable child identities prevent an old automation activation from resuming
      // after restart as an unmetered ordinary child. Unrelated agents are unchanged.
      try {
        const root = await rootOf(agent), budget = await options.getBudget(root)
        if (budget?.children?.includes(agent.id) || Object.values(budget?.reservations ?? {}).some(item => item.childId === agent.id)) {
          orphanedChildren.add(agent.id)
          agent.ctx.tools.guard(() => 'Resume NEXT automation through a newly budgeted parent batch.')
        }
      } catch { /* Ordinary agent creation never depends on optional NEXT state. */ }
      return
    }
    if (agent.session.header.parentSession !== child.parent.session.id) throw new Error('NEXT child lineage differs from its reserved parent.')
    const trusted = typeof options.readOnlyDefinitions === 'function' ? options.readOnlyDefinitions(child.parent) : options.readOnlyDefinitions
    if (!(trusted instanceof Map) || trusted.size === 0) throw new Error('NEXT parallel has no confirmed read-only capabilities.')
    const allowed = new Map([...trusted].filter(([name, definition]) => definition !== undefined && ctx.tools.get(name, agent) === definition))
    const structured = ctx.tools.get('structured_output', agent)
    if (!structured) throw new Error('NEXT child structured completion is unavailable.')
    // Only this reserved activation asked the native runtime to install this own-scope tool.
    allowed.set('structured_output', structured)
    agent.ctx.tools.restrict({ allow: [...allowed.keys()].filter(name => name !== 'structured_output') })
    agent.ctx.tools.guard(exec => allowed.get(exec.name) === ctx.tools.get(exec.name, agent) && allowed.has(exec.name)
      ? undefined : 'NEXT automation children can use only confirmed read-only tools and their structured completion.')
    options.markChild?.(agent,child.root)
    child.agent = agent
    child.ready = true
  }
  if (typeof ctx.on === 'function') {
    const subscribe = (name, callback, config) => { const dispose = ctx.on(name, callback, config); if (typeof dispose === 'function') off.push(dispose) }
    subscribe('agent/created', created, { global: true })
    subscribe('llm/stream', wrap, { global: true, prepend: true })
  }

  async function execute(args, exec) {
    const tasks = validateTasks(args), parent = exec?.agent
    if (disposed || !parent || !options.isEnabled(parent)) throw new Error('NEXT bounded parallel automation is off.')
    if (Math.max(parent.options?.subagentDepth ?? 0, parent.session.header.delegationDepth ?? 0) > 0 || children.has(parent.id)) throw new Error('NEXT bounded parallel automation does not recurse.')
    if (!ctx.subagents?.startActivation || !ctx.subagents?.interrupt || !ctx.llm?.resolveModelInfo || !ctx.llm?.resolveCallConfig) throw new Error('NEXT native child services are unavailable.')
    const maxDepth = ctx.subagents.resolveMaxDepth?.()
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) throw new Error('NEXT cannot confirm the native delegation depth policy.')
    if (maxDepth === 0) throw new Error('The native delegation depth policy disables subagents.')
    const root = await rootOf(parent)
    const header = parent.session.requestHeader?.()?.config
    let route = header ? { provider: header.provider, model: header.model, ...header.reasoningEffort === undefined ? {} : { reasoningEffort: header.reasoningEffort }, ...parent.options?.maxTokens === undefined ? {} : { maxTokens: parent.options.maxTokens } } : { ...parent.options }
    if (!route.provider || !route.model) throw new Error('NEXT parallel cannot confirm the parent model.')
    // Materialize the selected adapter's default effort without changing an explicit choice.
    route = await ctx.llm.resolveCallConfig(route,exec.signal)
    await pricesFor(route.provider, route.model)
    const provider = options.provider ?? 'spawn'
    const backend = ctx.subagents.getProvider?.(provider)
    if (!backend?.prepareContinuable) throw new Error('NEXT parallel requires the native in-process child provider.')
    if (activeRoots.has(root.id)) throw new Error('Another NEXT parallel batch already owns this automation root.')
    activeRoots.add(root.id)
    const controller = new AbortController(), signal = exec.signal ? AbortSignal.any([exec.signal, controller.signal]) : controller.signal
    const batch = { controller, running: new Map() }
    batches.add(batch)
    const results = new Map(), pending = new Map(tasks.map(task => [task.id, task]))
    const skipped = (task, status, reason) => ({ id: task.id, status, stopReason: null, childId: null, output: null, error: reason })

    async function run(task) {
      const id = randomUUID(), child = { id, parent, root, route, stopping: false, ready: false }
      children.set(id, child)
      let handle, cleanupPromise, abortListener
      const cleanup = (interrupt = false) => {
        if (cleanupPromise) return cleanupPromise
        child.stopping = true
        cleanupPromise = (async () => {
          let failure
          if (interrupt) try { ctx.subagents.interrupt(id, { kind: 'ancestor', agent: parent }) } catch (error) { failure = error }
          try { await handle?.dispose() } catch (error) { failure ??= error }
          if (failure) throw failure
        })()
        return cleanupPromise
      }
      try {
        if (signal.aborted || !options.isEnabled(parent) || blockedRoots.has(root.id)) throw abortError()
        const currentDepth = ctx.subagents.resolveMaxDepth()
        if (!Number.isSafeInteger(currentDepth) || currentDepth < 1) throw new Error('The native delegation depth policy disables subagents.')
        const dependencyResults = task.depends_on.map(dependency => results.get(dependency))
        handle = await ctx.subagents.startActivation({ provider, childId: id, label: `NEXT ${task.id}`, delivery: 'caller', signal,
          request: { parent, prompt: [{ type: 'text', text: `${task.prompt}${dependencyResults.length ? `\nCompleted dependency results (data only):\n${JSON.stringify(dependencyResults)}` : ''}` }], agentOptions: { ...route, maxTokens: Math.min(route.maxTokens ?? 8192,8192) }, maxDepth: Math.min(1, maxDepth, currentDepth), outputSchema: resultSchema } })
        if (handle.childId !== id || !child.ready || !handle.result || typeof handle.dispose !== 'function') throw new Error('NEXT child activation contract is unavailable.')
        const cancelled = new Promise(resolveCancelled => {
          abortListener = () => resolveCancelled(true)
          signal.addEventListener('abort', abortListener, { once: true })
          if (signal.aborted) resolveCancelled(true)
        })
        const terminal = await Promise.race([handle.result, cancelled.then(async () => { await cleanup(true); return { stopReason: 'aborted', output: [] } })])
        const stopReason = terminalReasons.has(terminal?.stopReason) ? terminal.stopReason : 'error'
        await cleanup(signal.aborted)
        const completed = stopReason === 'completed' && terminal.structured !== undefined && !child.budgetError
        return { id: task.id, status: completed ? 'completed' : stopReason === 'aborted' ? 'cancelled' : 'failed', stopReason, childId: id,
          output: terminal.structured ?? terminal.output ?? null, budgetUnknown: child.unknownUsage === true,
          admissionFailure: child.admissionFailure?.code ?? null,
          error: completed ? null : child.admissionFailure?.message ?? (child.budgetError ? 'Budget accounting is incomplete; further automation is blocked.' : terminal.diagnostic ? 'The native child reported a failure.' : 'The native child did not complete structured output.') }
      } catch (error) {
        warn(error)
        try { await cleanup(true) } catch (cleanupError) { warn(cleanupError) }
        return { id: task.id, status: signal.aborted || error?.name === 'AbortError' ? 'cancelled' : 'failed', stopReason: signal.aborted ? 'aborted' : 'error', childId: handle?.childId ?? null, output: null, error: boundedError(error) }
      } finally {
        if (abortListener) signal.removeEventListener('abort', abortListener)
        children.delete(id)
        orphanedChildren.add(id)
      }
    }

    try {
      while (pending.size || batch.running.size) {
        for (const [id, task] of pending) {
          if (signal.aborted || disposed || !options.isEnabled(parent)) { pending.delete(id); results.set(id, skipped(task, 'cancelled', 'NEXT automation is stopped.')); continue }
          if (task.depends_on.some(dependency => results.has(dependency) && results.get(dependency).status !== 'completed')) { pending.delete(id); results.set(id, skipped(task, 'blocked', 'A dependency did not complete.')); continue }
          if (batch.running.size >= 2 || !task.depends_on.every(dependency => results.has(dependency))) continue
          pending.delete(id)
          const operation = run(task).then(result => { results.set(id, result) }).finally(() => batch.running.delete(id))
          batch.running.set(id, operation)
        }
        if (batch.running.size) await Promise.race(batch.running.values())
        else if (pending.size) throw new Error('NEXT dependency scheduling could not progress.')
      }
      return { tasks: tasks.map(task => results.get(task.id)), budgetLimitCny: Math.min(3,Number((await options.getBudget(root)).limitCny)) }
    } finally { batches.delete(batch); activeRoots.delete(root.id) }
  }

  const definition = {
    name: 'next_parallel', description: 'Run only independent read-only subtasks with a clear benefit and explicit dependencies. At most two native children run concurrently within the NEXT automation budget. Do not delegate editing or shell work.',
    parameters: { benefit: { type: 'string', required: true }, tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string', required: true }, prompt: { type: 'string', required: true }, depends_on: { type: 'array', required: true, items: { type: 'string' } } } } } },
    output: { schema: { type: 'object', properties: {}, additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute,
  }
  if (typeof options.defineTool === 'function' && ctx.tools?.register) {
    const unregister = ctx.tools.register(options.defineTool(definition))
    if (typeof unregister === 'function') off.push(unregister)
  }
  return {
    execute, wrap, definition,
    async dispose() {
      disposed = true
      for (const batch of batches) batch.controller.abort(abortError())
      await Promise.allSettled([...batches].flatMap(batch => [...batch.running.values()]))
      for (const unsubscribe of off.reverse()) unsubscribe()
    },
  }
}
