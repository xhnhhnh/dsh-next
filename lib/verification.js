import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { normalizeVerificationChecks, ProjectCheckExpiredError, readProjectCommandSnapshot, inspectProjectCheckStatus, validateArtifact } from './project-checks.js'
export { normalizeVerificationChecks, scanProjectChecks } from './project-checks.js'

export const VERIFICATION_VERSION = 'next-project-native-read-v3+dsh.0.2.1-alpha.5'
export const VERIFICATION_INPUT_FORMAT = 'native-read-lines-v1'
const TOOL = 'next_verify'
const LIMITS = Object.freeze({ checks: 64, entries: 32, bytes: 1024 * 1024, reports: 64 })
const hash = value => createHash('sha256').update(value).digest('hex')
const clone = value => JSON.parse(JSON.stringify(value))
const abort = signal => signal?.throwIfAborted()
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) }
const bounded = value => String(value).slice(0, 240)
const errorsOf = errors => errors.slice(0, 6).map(bounded)
const DIRTY_ALL = Symbol('all-registered-check-inputs')
class VerificationObservationError extends Error {}
function limit(value, fallback, cap) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('NEXT verification limits must be positive safe integers.')
  return Math.min(value, cap)
}

function snapshotFor(check, raw, version, maxBytes) {
  if (!raw || ['workspace', 'file', 'target', 'version', 'content'].some(key => typeof raw[key] !== 'string' || (key !== 'content' && raw[key].length === 0))) throw new Error('Incomplete input observation.')
  if (Buffer.byteLength(raw.content, 'utf8') > maxBytes) throw new Error('Input exceeds the verification size limit.')
  const fields = {
    checkerVersion: version, inputFormat: VERIFICATION_INPUT_FORMAT, kind: check.kind, checkId: check.id,
    workspace: raw.workspace, file: raw.file, target: raw.target, version: raw.version,
    inputHash: hash(raw.content), schemaFile: '', schemaTarget: '', schemaVersion: '', schemaHash: '',
  }
  if (check.kind === 'json-schema') {
    if (['schemaFile', 'schemaTarget', 'schemaVersion', 'schemaContent'].some(key => typeof raw[key] !== 'string' || (key !== 'schemaContent' && raw[key].length === 0))) throw new Error('Incomplete schema observation.')
    if (Buffer.byteLength(raw.schemaContent, 'utf8') > maxBytes) throw new Error('Schema exceeds the verification size limit.')
    Object.assign(fields, { schemaFile: raw.schemaFile, schemaTarget: raw.schemaTarget, schemaVersion: raw.schemaVersion, schemaHash: hash(raw.schemaContent) })
  }
  return { raw, fields, fingerprint: hash(JSON.stringify(check.kind === 'artifact' ? { fields, format: check.format, requiredColumns: check.requiredColumns ?? [], requiredText: check.requiredText ?? [] } : fields)) }
}

/** Session-local cache. Only settle() receiving an identical final successful tool value admits an entry. */
export function createVerificationCore(options) {
  const maxEntries = limit(options.maxEntries, LIMITS.entries, 64)
  const maxBytes = limit(options.maxBytes, LIMITS.bytes, 4 * LIMITS.bytes)
  const version = options.checkerVersion ?? VERIFICATION_VERSION
  const caches = new WeakMap(), reports = new WeakMap(), pending = new Map()
  let disposed = false
  const sessionOf = exec => exec.agent?.session
  const enabled = exec => !disposed && Boolean(sessionOf(exec)) && options.isEnabled?.(exec.agent) !== false
  const epoch = () => options.getEpoch?.() ?? 0
  const cacheOf = session => { if (!caches.has(session)) caches.set(session, new Map()); return caches.get(session) }
  const checks = agent => normalizeVerificationChecks(options.getChecks?.(agent) ?? [])
  const inspect = async (check, exec) => { abort(exec.signal); const raw = await options.readSnapshot(check, exec, maxBytes); abort(exec.signal); return snapshotFor(check, raw, version, maxBytes) }
  function publish(record, exec) {
    const session = sessionOf(exec)
    if (session) {
      const current = reports.get(session) ?? new Map()
      current.delete(record.checkId); current.set(record.checkId, record)
      while (current.size > LIMITS.reports) current.delete(current.keys().next().value)
      reports.set(session, current)
    }
    try { options.onRecord?.(clone(record), exec.agent) } catch (error) { try { options.onError?.('NEXT could not record verification.', error) } catch {} }
    return record
  }
  function unknownFinal(exec, checkId, detail) {
    return publish({ status: 'unknown', passed: null, checkId, checkerVersion: version, inputFormat: VERIFICATION_INPUT_FORMAT,
      workspace: '', file: '', target: '', inputVersion: '', inputHash: '', schemaFile: '', schemaTarget: '', schemaVersion: '', schemaHash: '', fingerprint: '',
      source: { sessionId: sessionOf(exec)?.id ?? '', callId: exec.callId ?? '', originalCallId: '' },
      startedAt: Date.now(), endedAt: Date.now(), detail, errors: [],
    }, exec)
  }
  function rememberPending(exec, result, snapshot, startEpoch, cacheable = true) {
    if (exec.token !== undefined && pending.size < 256) pending.set(exec.token, { session: sessionOf(exec), result: JSON.stringify(result), value: clone(result), snapshot, epoch: startEpoch, cacheable })
    return result
  }
  async function verify(args, exec) {
    const startedAt = Date.now(), startEpoch = epoch()
    let snapshot, check
    const result = (status, passed, detail, errors = [], originalCallId = '') => ({
      status, passed, checkId: typeof args?.check_id === 'string' ? args.check_id.slice(0, 64) : '', checkerVersion: version, inputFormat: VERIFICATION_INPUT_FORMAT,
      workspace: snapshot?.fields.workspace ?? '', file: snapshot?.fields.file ?? '', target: snapshot?.fields.target ?? '',
      inputVersion: snapshot?.fields.version ?? '', inputHash: snapshot?.fields.inputHash ?? '', schemaFile: snapshot?.fields.schemaFile ?? '', schemaTarget: snapshot?.fields.schemaTarget ?? '',
      schemaVersion: snapshot?.fields.schemaVersion ?? '', schemaHash: snapshot?.fields.schemaHash ?? '', fingerprint: snapshot?.fingerprint ?? '',
      source: { sessionId: sessionOf(exec)?.id ?? '', callId: exec.callId ?? '', originalCallId },
      startedAt, endedAt: Date.now(), detail, errors: errorsOf(errors),
    })
    const unknown = detail => rememberPending(exec, result('unknown', null, detail), null, startEpoch)
    try {
      abort(exec.signal)
      if (!enabled(exec)) return unknown('NEXT verification is not enabled for this session.')
      if (!args || typeof args.check_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(args.check_id) || (args.force !== undefined && typeof args.force !== 'boolean')) return unknown('Invalid verification request.')
      check = checks(exec.agent).find(item => item.id === args.check_id)
      if (!check) return unknown('No matching registered project check.')
      if (check.kind === 'command' && Math.max(exec.agent?.depth ?? 0, exec.agent?.options?.subagentDepth ?? 0, exec.agent?.session?.header?.delegationDepth ?? 0) > 0) return unknown('Registered project commands are not available to read-only child agents.')
      snapshot = await inspect(check, exec)
      if (!enabled(exec) || startEpoch !== epoch()) return unknown('Files or NEXT state changed while verification inputs were being observed.')
      const cacheable = check.kind !== 'command'
      const cache = cacheOf(sessionOf(exec)), cached = cacheable ? cache.get(snapshot.fingerprint) : undefined
      if (args.force === true) cache.delete(snapshot.fingerprint)
      else if (cached) {
        cache.delete(snapshot.fingerprint); cache.set(snapshot.fingerprint, cached)
        return rememberPending(exec, result('reused', true, 'Reused an earlier successful verification of these exact observed inputs.', [], cached.source.callId), snapshot, startEpoch)
      }
      if (check.kind === 'command' || check.kind === 'artifact') {
        let violations = [], commandResult
        if (check.kind === 'command') {
          if (typeof options.runCommand !== 'function') return unknown('The native command capability is unavailable.')
          commandResult = await options.runCommand(check, exec)
          if (commandResult.status === 'unknown') return unknown(commandResult.detail)
          violations = commandResult.passed ? [] : [commandResult.detail]
        } else violations = validateArtifact(check, snapshot.raw.content)
        const after = await inspect(check, exec)
        if (!enabled(exec) || startEpoch !== epoch() || after.fingerprint !== snapshot.fingerprint) return rememberPending(exec, result('expired', null, 'Project inputs changed while this check was running; the result is no longer current.'), null, startEpoch, false)
        return rememberPending(exec, violations.length ? result('failed', false, check.kind === 'command' ? commandResult.detail : 'Artifact did not satisfy its registered checks.', violations)
          : result('executed', true, check.kind === 'command' ? commandResult.detail : `${check.format.toUpperCase()} artifact passed its registered checks in this execution.`), snapshot, startEpoch, cacheable)
      }
      let data
      try { data = JSON.parse(snapshot.raw.content) }
      catch { return rememberPending(exec, result('failed', false, 'JSON syntax is invalid.', ['Input is not valid JSON.']), snapshot, startEpoch) }
      let violations = []
      if (check.kind === 'json-schema') {
        let schema
        try { schema = JSON.parse(snapshot.raw.schemaContent) }
        catch { return unknown('The registered schema is not valid JSON.') }
        if (typeof options.assertSupportedJsonSchema !== 'function' || typeof options.validateJsonSchemaValue !== 'function') return unknown('The native JSON schema validator is unavailable.')
        try { options.assertSupportedJsonSchema(schema) }
        catch { return unknown('The registered schema is outside the native supported JSON schema subset.') }
        violations = options.validateJsonSchemaValue(schema, data, '')
        if (!Array.isArray(violations) || violations.some(item => typeof item !== 'string')) return unknown('The native validator did not return a recognized result.')
      }
      // Re-observe identities, bytes and versions after checking. A moving input is never a passing receipt.
      const after = await inspect(check, exec)
      if (!enabled(exec) || startEpoch !== epoch() || after.fingerprint !== snapshot.fingerprint) return unknown('Verification inputs or NEXT state changed before completion.')
      return rememberPending(exec, violations.length ? result('failed', false, 'JSON does not satisfy the registered schema.', violations)
        : result('executed', true, check.kind === 'json-syntax' ? 'JSON syntax passed in this execution.' : 'JSON passed the native supported schema validator in this execution.'), snapshot, startEpoch)
    } catch (error) {
      if (error instanceof ProjectCheckExpiredError) return rememberPending(exec, result('expired', null, error.message), null, startEpoch, false)
      return unknown(exec.signal?.aborted ? 'Verification was cancelled; no reusable success was recorded.'
        : error instanceof VerificationObservationError ? error.message : 'Verification inputs could not be safely observed or checked.')
    }
  }
  function settle(exec, finalResult) {
    const item = pending.get(exec.token)
    pending.delete(exec.token)
    if (disposed) return null
    if (!item) return finalResult?.isError === true && typeof exec.arguments?.check_id === 'string'
      ? unknownFinal(exec, exec.arguments.check_id.slice(0, 64), 'Native verification dispatch was denied, cancelled, or failed before producing a trusted receipt.') : null
    const record = clone(item.value)
    if (finalResult?.isError === true || JSON.stringify(finalResult?.value) !== item.result) {
      record.status = 'unknown'; record.passed = null; record.detail = 'Native final policy did not accept this verification result unchanged.'
    } else if (!enabled(exec) || epoch() !== item.epoch) {
      // The native final value remains untouched; an invalidation is an audit fact, never a cached pass.
      record.status = 'unknown'; record.passed = null; record.detail = 'Verification was invalidated before final settlement.'
    }
    if (record.status === 'executed' && record.passed === true && item.snapshot && item.cacheable) {
      const cache = cacheOf(item.session)
      cache.delete(record.fingerprint); cache.set(record.fingerprint, clone(record))
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
    }
    return publish(record, exec)
  }
  return {
    verify, settle, checks, owns: exec => pending.has(exec.token),
    reports: agent => [...(reports.get(agent?.session)?.values() ?? [])].map(clone),
    clear: agent => { if (agent?.session) caches.delete(agent.session) },
    invalidate(agent, { clearCache = true, path } = {}) {
      if (!agent?.session) return
      if (clearCache) caches.delete(agent.session)
      for (const record of reports.get(agent.session)?.values() ?? []) {
        if (path && !(record.file === path || record.schemaFile === path || (record.file === record.workspace && inside(record.workspace, path)))) continue
        if (record.passed === true) {
          record.status = 'expired'; record.passed = null; record.detail = 'A later project mutation invalidated this receipt.'
          try { options.onRecord?.(clone(record), agent) } catch (error) { try { options.onError?.('NEXT could not record expired verification.', error) } catch {} }
        }
      }
    },
    dispose() { disposed = true; pending.clear() },
  }
}

/** Only complete native read-tool text is inspected. Its line view normalizes CRLF and the final newline. */
export async function readVerificationSnapshot(ctx, check, exec, maxBytes = LIMITS.bytes) {
  abort(exec.signal)
  const cwd = ctx.workingDirectory?.ensure ? await ctx.workingDirectory.ensure(exec.agent, exec.signal) : exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('No current native working directory.')
  const root = await ctx.fs.resolve(check.workspace, { signal: exec.signal })
  const rootInfo = await ctx.fs.stat(root, exec.signal), workspace = ctx.fs.processPath(root)
  const cwdTarget = await ctx.fs.resolve(cwd, { signal: exec.signal }), current = ctx.fs.processPath(cwdTarget)
  if (rootInfo?.type !== 'directory' || !isAbsolute(workspace) || !isAbsolute(current) || !inside(workspace, current)) throw new Error('The registered check belongs to a different project.')
  async function read(path) {
    abort(exec.signal)
    const target = await ctx.fs.resolve(path, { cwd: workspace, signal: exec.signal })
    const file = ctx.fs.processPath(target)
    if (!isAbsolute(file) || !inside(workspace, file) || typeof target.targetKey !== 'string') throw new Error('Only canonical local project files may be verified.')
    const before = await ctx.fs.stat(target, exec.signal)
    if (before?.type !== 'file' || typeof before.version !== 'string' || (before.size !== undefined && before.size > maxBytes)) throw new Error('The verification file is missing, unversioned, or too large.')
    const definition = ctx.tools.get('read', exec.agent)
    if (!definition) throw new VerificationObservationError('The native read capability is unavailable.')
    const lines = []
    let offset = 1, total = null, bytes = 0
    for (let page = 0; page < 64; page += 1) {
      abort(exec.signal)
      const callId = randomUUID()
      let observation, dispatchedValue, dispatchedContent
      const off = ctx.on('fs/observed', (observed, info, actor) => {
        if (actor?.name === 'read' && actor.callId === callId && actor.agent === exec.agent && info?.kind === 'present') observation = { target: observed, version: info.version }
      }, { global: true })
      const offDispatch = ctx.on('tools/execute', async (actor, next) => {
        const result = await next()
        if (actor.name === 'read' && actor.callId === callId && actor.agent === exec.agent && result?.isError !== true) {
          dispatchedValue = clone(result.value)
          dispatchedContent = JSON.stringify(result.content)
        }
        return result
      }, { global: true, prepend: true })
      let result
      try {
        // Every page, including a repeated check, passes the CURRENT read-path policy, approvals and guards.
        result = await ctx.tools.execute({ name: 'read', callId, rootCallId: exec.rootCallId ?? exec.callId,
          ...(exec.token === undefined ? {} : { parent: exec.token }),
          arguments: { file_path: file, offset, limit: 2000 }, agent: exec.agent, signal: exec.signal })
      } finally { if (typeof off === 'function') off(); if (typeof offDispatch === 'function') offDispatch() }
      const value = result?.value
      if (result?.isError === true || ctx.tools.get('read', exec.agent) !== definition || !observation || dispatchedValue === undefined
        || JSON.stringify(dispatchedValue) !== JSON.stringify(value) || dispatchedContent !== JSON.stringify(result?.content)
        || observation.target?.targetKey !== target.targetKey || observation.version !== before.version
        || value?.path !== file || value.offset !== offset || !Array.isArray(value.lines)
        || !Number.isSafeInteger(value.totalLines) || value.totalLines < 0
        || (total !== null && total !== value.totalLines)) throw new VerificationObservationError('Native read permission or complete input observation was unavailable.')
      total = value.totalLines
      if (value.lines.length === 0 && !(total === 0 && offset === 1)) throw new VerificationObservationError('Native read did not provide the complete file.')
      for (const line of value.lines) {
        if (line?.number !== offset || typeof line.text !== 'string' || /\.\.\. \(line truncated to \d+ chars\)$/.test(line.text)) throw new VerificationObservationError('Native read was truncated or discontinuous; the complete JSON cannot be verified with the current host read limits.')
        bytes += Buffer.byteLength(line.text, 'utf8') + (lines.length === 0 ? 0 : 1)
        if (bytes > maxBytes || offset > total) throw new Error('Native read exceeded the verification limits.')
        lines.push(line.text); offset += 1
      }
      if (offset > total) break
      if (page === 63) throw new VerificationObservationError('Native read pagination exceeded the verification limit.')
    }
    const content = lines.join('\n')
    const again = await ctx.fs.resolve(path, { cwd: workspace, signal: exec.signal }), after = await ctx.fs.stat(again, exec.signal)
    if (again.targetKey !== target.targetKey || ctx.fs.processPath(again) !== file || after?.type !== 'file' || after.version !== before.version) throw new Error('Verification input changed while being read.')
    return { file, target: target.targetKey, version: before.version, content }
  }
  const input = await read(check.file)
  const schema = check.kind === 'json-schema' ? await read(check.schemaFile) : null
  abort(exec.signal)
  return { workspace, ...input, ...(schema ? { schemaFile: schema.file, schemaTarget: schema.target, schemaVersion: schema.version, schemaContent: schema.content } : {}) }
}

const stringField = () => ({ type: 'string', required: true })
export const VERIFICATION_OUTPUT = Object.freeze({
  type: 'object', properties: {
    status: { type: 'string', enum: ['executed', 'reused', 'failed', 'unknown', 'expired'], required: true },
    passed: { required: true, oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    ...Object.fromEntries(['checkId', 'checkerVersion', 'inputFormat', 'workspace', 'file', 'target', 'inputVersion', 'inputHash', 'schemaFile', 'schemaTarget', 'schemaVersion', 'schemaHash', 'fingerprint', 'detail'].map(key => [key, stringField()])),
    source: { type: 'object', required: true, properties: { sessionId: stringField(), callId: stringField(), originalCallId: stringField() }, additionalProperties: false },
    startedAt: { type: 'number', required: true }, endedAt: { type: 'number', required: true },
    errors: { type: 'array', items: { type: 'string' }, required: true },
  }, additionalProperties: false,
})

/** Commands retain the native dispatch/policy chain. A promoted job is stopped, never treated as a pass. */
export async function runRegisteredCommand(ctx, check, exec, onCall = () => {}) {
  abort(exec.signal)
  const name = ctx.tools.get('pwsh', exec.agent) ? 'pwsh' : ctx.tools.get('bash', exec.agent) ? 'bash' : null
  if (!name) return { status: 'unknown', passed: null, detail: 'The native command capability is unavailable.' }
  const definition = ctx.tools.get(name, exec.agent), controller = new AbortController()
  const cancel = () => controller.abort(exec.signal?.reason)
  exec.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('Registered project command timed out.')), check.timeoutMs + 100)
  let dispatched, dispatchedValue, result
  const callId = randomUUID()
  const off = ctx.on('tools/execute', async (actor, next) => {
    const value = await next()
    if (actor.name === name && actor.callId === callId && actor.agent === exec.agent) { dispatched = JSON.stringify(value); dispatchedValue = value?.value === undefined ? undefined : clone(value.value) }
    return value
  }, { global: true })
  onCall(callId, true)
  try {
    result = await ctx.tools.execute({ name, callId, rootCallId: exec.rootCallId ?? exec.callId,
      ...(exec.token === undefined ? {} : { parent: exec.token }),
      arguments: { description: `NEXT registered project check: ${check.id}`, command: check.command, workdir: check.workspace, timeoutMs: check.timeoutMs, run_in_background: false },
      agent: exec.agent, signal: controller.signal })
    const value = result?.value
    const ownRunningValue = ctx.tools.get(name, exec.agent) === definition && ['promoted', 'background'].includes(dispatchedValue?.kind) && typeof dispatchedValue.jobId === 'string' ? dispatchedValue : null
    if (ownRunningValue) {
      // Only the precise job handle returned by our own dispatch is eligible for cleanup.
      if (ctx.tools.get('job_kill', exec.agent)) {
        const cleanup = new AbortController(), cleanupTimer = setTimeout(() => cleanup.abort(), 5000)
        try { await ctx.tools.execute({ name: 'job_kill', callId: randomUUID(), rootCallId: exec.rootCallId ?? exec.callId,
          ...(exec.token === undefined ? {} : { parent: exec.token }), arguments: { job_id: ownRunningValue.jobId, reason: 'NEXT registered verification deadline reached.' }, agent: exec.agent, signal: cleanup.signal }) }
        finally { clearTimeout(cleanupTimer) }
      }
      return { status: 'unknown', passed: null, detail: 'Project command reached its deadline or returned a running job; no success was inferred.' }
    }
    if (['promoted', 'background'].includes(value?.kind)) return { status: 'unknown', passed: null, detail: 'Native final policy returned an untrusted running handle; no success or ownership was inferred.' }
    if (controller.signal.aborted || result?.isError === true || ctx.tools.get(name, exec.agent) !== definition || dispatched === undefined || dispatched !== JSON.stringify(result)
      || value?.aborted || value?.timedOut || value?.stopped || value?.signal || value?.sandbox?.denied || value?.sandbox?.runnerFailed
      || !Number.isInteger(value?.exitCode) || value.cwd !== check.workspace) return { status: 'unknown', passed: null, detail: 'Native command was denied, interrupted, timed out, replaced, or did not return a complete foreground result.' }
    const paths = [value.stdout?.spillPath, value.stderr?.spillPath].filter(path => typeof path === 'string' && path.length <= 512)
    return { status: value.exitCode === 0 ? 'executed' : 'failed', passed: value.exitCode === 0,
      detail: `Registered command completed with exit code ${value.exitCode}.${paths.length ? ` Full output: ${paths.join(', ')}` : ''}` }
  } catch { return { status: 'unknown', passed: null, detail: exec.signal?.aborted ? 'Registered command was cancelled; no success was inferred.' : 'Registered command could not complete under the current native execution policy.' } }
  finally { clearTimeout(timer); exec.signal?.removeEventListener('abort', cancel); if (typeof off === 'function') off(); onCall(callId, false) }
}

/** Host adapter. Observer hooks only mark dirty; the awaited pre-step performs actual registered tool dispatch. */
export function installVerification(ctx, options = {}) {
  if (typeof options.defineTool !== 'function') throw new TypeError('NEXT verification requires the native defineTool function.')
  const disposers = [], observations = new Map(), resultReports = new WeakMap(), ownedCommandCalls = new Set()
  let dirty = new WeakMap(), dirtyParents = new WeakMap()
  let epoch = 0, disposed = false, definition
  const warn = (message, error) => { try { options.onError?.(message, error); ctx.logger?.warn?.(message) } catch {} }
  const enabled = agent => { try { return !disposed && options.isEnabled?.(agent) === true } catch { return false } }
  const automatic = agent => { try { return enabled(agent) && options.autoEnabled?.(agent) === true } catch { return false } }
  const core = createVerificationCore({ ...options, isEnabled: enabled, getEpoch: () => epoch,
    readSnapshot: (check, exec, maxBytes) => check.kind === 'command' ? readProjectCommandSnapshot(ctx, check, exec, maxBytes) : readVerificationSnapshot(ctx, check, exec, maxBytes),
    runCommand: (check, exec) => runRegisteredCommand(ctx, check, exec, (id, active) => active ? ownedCommandCalls.add(id) : ownedCommandCalls.delete(id)), onError: warn })
  const on = (name, listener, extra = {}) => { const off = ctx.on(name, listener, { global: true, ...extra }); if (typeof off === 'function') disposers.push(off) }
  definition = options.defineTool({ name: TOOL,
    description: 'Run an explicitly registered project command or JSON/CSV/Markdown artifact check through native permissions. Commands execute each time and expire when registered script/lock bindings change. Unknown or expired is not passing. Reused artifact receipts identify their original check. Use force only if an unchanged successful artifact genuinely needs a rerun.',
    parameters: { check_id: { type: 'string', required: true, description: 'Registered NEXT project check id.' }, force: { type: 'boolean', description: 'Execute the validator again even if a valid receipt exists.' } },
    output: { schema: VERIFICATION_OUTPUT, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    execute: (args, exec) => core.verify(args, exec),
  })
  const unregister = ctx.tools.register(definition)
  if (typeof unregister === 'function') disposers.push(unregister)
  on('fs/observed', (target, observation, actor) => {
    if (!['write', 'edit'].includes(actor?.name) || !actor.agent || actor.token === undefined || observation?.kind !== 'present' || typeof observation.version !== 'string' || typeof target?.targetKey !== 'string') return
    epoch += 1 // Actual mutation invalidates pending proof even when later policy blocks its presentation.
    let changedPath
    try { changedPath = ctx.fs.processPath(target) } catch {}
    core.invalidate(actor.agent, { clearCache: false, path: isAbsolute(changedPath ?? '') ? changedPath : undefined })
    if (observations.size >= 256) observations.delete(observations.keys().next().value)
    observations.set(actor.token, { target, definition: ctx.tools.get(actor.name, actor.agent) })
  })
  on('tools/result', (exec, result) => {
    if (exec.name === TOOL) {
      const current = ctx.tools.get(TOOL, exec.agent) === definition
      if (current || core.owns(exec)) core.settle(exec, current ? result : { isError: true })
      return
    }
    if (['pwsh', 'bash'].includes(exec.name) && exec.agent) {
      // Unknown shell effects invalidate receipts without scheduling a self-sustaining validation loop.
      if (!ownedCommandCalls.has(exec.callId)) epoch += 1
      core.invalidate(exec.agent)
    }
    const observation = observations.get(exec.token)
    observations.delete(exec.token)
    if (!observation || observation.definition === undefined || ctx.tools.get(exec.name, exec.agent) !== observation.definition || result?.isError === true || !automatic(exec.agent)) return
    let path
    try { path = ctx.fs.processPath(observation.target) } catch { return }
    if (!isAbsolute(path) || result?.value?.path !== path) return
    const pending = dirty.get(exec.agent) ?? new Set()
    if (!pending.has(DIRTY_ALL)) {
      pending.add(path)
      if (pending.size > 256) { pending.clear(); pending.add(DIRTY_ALL) }
    }
    dirty.set(exec.agent, pending)
    dirtyParents.set(exec.agent, { parent: exec.token, rootCallId: exec.rootCallId ?? exec.callId })
  })
  async function drain(agent, signal) {
    const changed = dirty.get(agent)
    if (!changed?.size || !automatic(agent) || signal?.aborted) return []
    const parent = dirtyParents.get(agent)
    dirty.delete(agent)
    dirtyParents.delete(agent)
    const results = []
    let checks
    try { checks = core.checks(agent) } catch (error) { warn('NEXT project check configuration is invalid; automatic verification was not run.', error); return [] }
    for (const check of checks) {
      if (!automatic(agent) || signal?.aborted || ctx.tools.get(TOOL, agent) !== definition) break
      try {
        const root = await ctx.fs.resolve(check.workspace, { signal })
        const workspace = ctx.fs.processPath(root)
        const paths = check.kind === 'command' ? [] : await Promise.all([check.file, ...(check.schemaFile ? [check.schemaFile] : [])].map(async path => ctx.fs.processPath(await ctx.fs.resolve(path, { cwd: workspace, signal }))))
        if (!changed.has(DIRTY_ALL) && !(check.kind === 'command' ? [...changed].some(path => typeof path === 'string' && inside(workspace, path)) : paths.some(path => changed.has(path)))) continue
        // Same process dispatch retains native pre-policy, guards, output validation, cancellation and post-policy.
        const callId = randomUUID()
        const result = await ctx.tools.execute({ name: TOOL, callId, ...parent, arguments: { check_id: check.id }, agent, signal: signal ?? new AbortController().signal })
        if (result && typeof result === 'object') resultReports.set(result, core.reports(agent).find(item => item.source.callId === callId))
        results.push(result)
      } catch (error) { warn('NEXT automatic verification could not run; no pass was inferred.', error) }
    }
    if (signal?.aborted || !automatic(agent)) {
      const retained = dirty.get(agent) ?? new Set()
      for (const path of changed) retained.add(path)
      dirty.set(agent, retained)
      if (!dirtyParents.has(agent) && parent) dirtyParents.set(agent, parent)
    }
    return results
  }
  on('agent/pre-step', async (payload, next) => {
    let results = []
    try { results = await drain(payload.agent, payload.signal ?? payload.agent?.signal) } catch (error) { warn('NEXT automatic verification could not finish.', error) }
    const decision = await next()
    // Downstream pre-step hooks may wait while NEXT is switched off or the turn is cancelled.
    // Keep the completed audit, but do not publish a new notice after that state change.
    if (decision.kind !== 'enter' || results.length === 0 || !automatic(payload.agent) || payload.signal?.aborted || payload.agent?.signal?.aborted || typeof options.createUserMessage !== 'function') return decision
    // The loop assembles prompt sections before pre-step; native accepted messages carry this step's fresh proof.
    const lines = results.slice(0, LIMITS.reports).map(result => {
      const record = resultReports.get(result)
      if (!record) return 'unknown: native verification dispatch did not produce an accepted receipt.'
      return JSON.stringify({ check: record.checkId, file: record.file, status: record.status, passed: record.passed, receipt: record.source.callId, ...(record.source.originalCallId ? { reusedReceipt: record.source.originalCallId } : {}) })
    })
    try {
      const message = options.createUserMessage({ source: { kind: 'plugin:next/verification', form: 'notice' }, content: [{ type: 'text', text: `NEXT automatic project verification (unknown or expired is not a pass):\n${lines.join('\n')}\nThese receipts cover only the recorded scope. Unchanged accepted artifact inputs do not need a force rerun; commands always execute.` }] })
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) { warn('NEXT could not attach its verification notice; the native step continues.', error); return decision }
  }, { prepend: true })
  // This native hook is serial/awaited. Cancellation never starts new checks or discards pending dirty inputs.
  on('agent/turn-stopping', async ({ agent, signal }) => {
    if (signal?.aborted) return
    try { await drain(agent, signal ?? agent?.signal) } catch (error) { warn('NEXT final verification could not finish; the native turn continues.', error) }
  })
  on('agent/disposed', ({ agent }) => { dirty.delete(agent); dirtyParents.delete(agent); core.clear(agent) })
  return {
    toolName: TOOL, drain, checks: core.checks, reports: core.reports, clear: core.clear,
    async checkStatus(agent, { signal } = {}) {
      let checks
      try { checks = core.checks(agent) } catch { return { checks: [], status: 'unavailable', reason: 'Project check registration is invalid.' } }
      const statuses = []
      for (const check of checks) statuses.push(await inspectProjectCheckStatus(ctx, check, { agent, signal }))
      return { checks: statuses, status: statuses.some(check => check.status === 'ready') ? 'ready' : 'unavailable', reason: statuses.length ? 'Only ready checks may be advertised as available.' : 'No project checks have been registered.' }
    },
    dispose() { disposed = true; core.dispose(); observations.clear(); dirty = new WeakMap(); dirtyParents = new WeakMap(); for (const off of disposers.reverse()) off() },
  }
}
