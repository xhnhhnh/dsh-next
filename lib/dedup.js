import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'

const PREFIX = '[NEXT_READ_REF v1 '
const REFERENCE = /^\[NEXT_READ_REF v1 source=(\d+) restore=(\d+) sha256=([a-f0-9]{64})\]\nSame local file read as event \d+; the complete content remains earlier in this request\.$/u
const digest = (value) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex')
const clone = (value) => structuredClone(value)
const messageOf = (event) => event?.type === 'tool/result' ? event.data?.message : undefined
const callOf = (event) => messageOf(event)?.source?.callId
// Content is deliberately excluded before serialization: ancestry compares metadata,
// and copying a large tool body only to discard it makes even disabled sessions costly.
const identity = (event) => JSON.stringify({ ...event.data, message: { ...event.data.message, content: null } })

/** A persisted reference contains its own original-result locator, so restart recovery needs no cache. */
export function readReference(content) {
  if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text') return null
  if (typeof content[0].text !== 'string' || !content[0].text.startsWith(PREFIX)) return null
  const match = REFERENCE.exec(content[0].text)
  if (match === null) return null
  const source = Number(match[1]), restore = Number(match[2])
  if (!Number.isSafeInteger(source) || !Number.isSafeInteger(restore)) return null
  return { source, restore, hash: match[3] }
}

function referenceContent(source, restore, hash) {
  return [{ type: 'text', text: `${PREFIX}source=${source} restore=${restore} sha256=${hash}]\nSame local file read as event ${source}; the complete content remains earlier in this request.` }]
}

function surfaceSupported(session) {
  return typeof session?.eventAt === 'function' && typeof session?.append === 'function'
    && typeof session?.deriveEventMessage === 'function' && Array.isArray(session?.surface?.nodes)
}

/** Follow native pruning/replacement ancestry without crossing to a different tool call. */
function referenceAncestor(scan, event) {
  // An original, non-reference result with no replacement ancestry cannot hide a
  // persisted reference. This also avoids serializing unrelated MCP metadata.
  if (readReference(messageOf(event).content) === null && !(event.sourceEventSeqs?.length > 0)) return null
  const wanted = scan.identity(event), queue = [event], seen = new Set()
  let cursor = 0
  for (let count = 0; cursor < queue.length && count < 512; count += 1) {
    const candidate = queue[cursor++]
    if (seen.has(candidate.seq)) continue
    seen.add(candidate.seq)
    if (candidate.type !== 'tool/result' || scan.identity(candidate) !== wanted) continue
    const ref = readReference(messageOf(candidate).content)
    if (ref !== null) {
      const full = scan.eventAt(ref.restore)
      if (full?.type !== 'tool/result' || full.seq >= candidate.seq || scan.identity(full) !== wanted
        || !candidate.sourceEventSeqs?.includes(ref.restore) || scan.content(messageOf(full).content).hash !== ref.hash) return null
      return { ref, full, marker: candidate }
    }
    for (const seq of candidate.sourceEventSeqs ?? []) {
      const source = scan.eventAt(seq)
      if (source !== undefined && source.seq < candidate.seq) queue.push(source)
    }
  }
  return null
}

/** Caches are local to one synchronous preparation, never across host projection changes. */
function createScan(session) {
  const events = new Map(), identities = new WeakMap(), contents = new WeakMap(), references = new Map()
  const nodes = [...session.surface.nodes], positions = new Map(nodes.map((seq, index) => [seq, index]))
  const scan = {
    nodes, positions,
    eventAt(seq) {
      if (!events.has(seq)) events.set(seq, session.eventAt(seq))
      return events.get(seq)
    },
    identity(event) {
      if (!identities.has(event)) identities.set(event, identity(event))
      return identities.get(event)
    },
    content(content) {
      if (content !== null && typeof content === 'object' && contents.has(content)) return contents.get(content)
      const serialized = JSON.stringify(content) ?? 'undefined'
      const result = { hash: createHash('sha256').update(serialized).digest('hex'), length: serialized.length }
      if (content !== null && typeof content === 'object') contents.set(content, result)
      return result
    },
    reference(event) {
      if (!references.has(event.seq)) references.set(event.seq, referenceAncestor(scan, event))
      return references.get(event.seq)
    },
    replace(event, content, extraSources) {
      const replacement = replaceContent(session, event, content, extraSources)
      const position = positions.get(event.seq)
      positions.delete(event.seq)
      positions.set(replacement.seq, position)
      events.set(replacement.seq, replacement)
      return replacement
    },
  }
  return scan
}

function replaceContent(session, event, content, extraSources = []) {
  return session.append('tool/result', {
    ...event.data, message: { ...event.data.message, content: clone(content) },
  }, {
    surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq },
    sourceEventSeqs: [...new Set([event.seq, ...extraSources])],
  })
}

function readValue(value) {
  return value !== null && typeof value === 'object' && typeof value.path === 'string'
    && Number.isSafeInteger(value.offset) && value.offset > 0
    && Number.isSafeInteger(value.totalLines) && value.totalLines >= 0
    && Array.isArray(value.lines) && value.lines.every((line) => line !== null && typeof line === 'object'
      && Number.isSafeInteger(line.number) && line.number > 0 && typeof line.text === 'string')
}

/**
 * Model-surface deduplication over alpha.5's existing tool/result replacements.
 * Native reads always execute; this module never changes a tool result/value or frozen LLM request.
 * Host plugins are trusted to emit honest fs/observed events. A name/schema match alone never qualifies.
 */
export function installDedup(ctx, { isEnabled, minChars = 1024, maxEntries = 256, onShorten } = {}) {
  if (typeof isEnabled !== 'function') throw new TypeError('NEXT dedup requires isEnabled(agent)')
  if (!Number.isSafeInteger(minChars) || minChars < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('NEXT dedup limits must be positive safe integers')
  }
  const stats = { shortened: 0, restored: 0, charsSaved: 0, rejected: 0, restoreFailures: 0, reason: null }
  const admitted = new Map(), observed = new Map(), attested = new Map(), captures = new WeakMap(), blocked = new WeakSet()
  const sessionsWithReferences = new Map()
  const disposers = []
  let disposed = false
  const warn = (message, error) => {
    try { ctx?.logger?.warn?.(`${message}${error === undefined ? '' : `: ${error instanceof Error ? error.message : String(error)}`}`) } catch {}
  }
  const available = typeof ctx?.on === 'function' && typeof ctx?.tools?.get === 'function'
    && ['resolve', 'processPath', 'stat'].every((key) => typeof ctx?.fs?.[key] === 'function')
  if (!available) {
    stats.reason = 'Native filesystem observation/verification is unavailable; full reads are preserved.'
    warn(`NEXT dedup: ${stats.reason}`)
  }

  function remember(exec, result) {
    const proof = attested.get(exec.token)
    attested.delete(exec.token)
    observed.delete(exec.token)
    if (proof === undefined || result.isError === true || !readValue(result.value)
      || result.value.path !== proof.path || ctx.tools.get(exec.name, exec.agent) !== proof.definition
      || !Array.isArray(result.content) || result.content.length === 0
      || !result.content.every((block) => block.type === 'text' && typeof block.text === 'string')) return
    const session = exec.agent.session
    let entries = captures.get(session)
    if (entries === undefined) { entries = new Map(); captures.set(session, entries) }
    const key = digest({
      target: proof.target, path: proof.path, version: proof.version,
      offset: exec.arguments.offset ?? 1, limit: exec.arguments.limit ?? null,
      value: result.value, content: result.content,
    })
    entries.set(exec.callId, { key, contentHash: digest(result.content), definition: proof.definition })
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
  }

  function prepareSession(agent, { restoreAll = false } = {}) {
    const session = agent?.session
    if (!surfaceSupported(session)) return { shortened: 0, restored: 0, available: false }
    // The alpha.5 durable decoder admits tool/result rewrites only inside a turn.
    if (ctx.sessionProjections && ctx.sessionProjections.stateOf(session, 'turnBoundary')?.openTurnStartSeq == null) {
      return { shortened: 0, restored: 0, available }
    }
    const enabled = !disposed && available && !blocked.has(session) && isEnabled(agent) === true
    const scan = createScan(session), activeReferences = new Set()
    let restored = 0, shortened = 0
    // Native compaction may remove the source or prune either result. Restore from immutable original logs.
    for (const seq of scan.nodes) {
      const event = scan.eventAt(seq)
      if (event?.type !== 'tool/result') continue
      const reference = scan.reference(event)
      if (reference === null) continue
      const { ref, full, marker } = reference
      const contentHash = scan.content(session.deriveEventMessage(event)?.content).hash
      if (contentHash === ref.hash) continue // Already restored.
      const source = scan.eventAt(ref.source), sourcePosition = scan.positions.get(ref.source)
      const sourceVisible = source?.type === 'tool/result' && sourcePosition !== undefined
        && sourcePosition < scan.positions.get(seq)
        && scan.content(session.deriveEventMessage(source)?.content).hash === ref.hash
      const unchangedMarker = contentHash === scan.content(messageOf(marker).content).hash
      if (restoreAll || !enabled || !sourceVisible || !unchangedMarker) {
        try { scan.replace(event, messageOf(full).content, [full.seq]) }
        catch (error) {
          stats.restoreFailures += 1
          warn(`NEXT dedup could not restore full read output in session ${session.id}, event ${event.seq}`, error)
          // Never send a reference that no longer has its original in the request.
          if (!sourceVisible || !unchangedMarker) error.nextRequiredRecovery = true
          throw error
        }
        restored += 1
      } else if (readReference(session.deriveEventMessage(event)?.content) !== null) activeReferences.add(seq)
    }
    const entries = captures.get(session)
    if (!restoreAll && enabled && entries?.size > 0) {
      const earlier = new Map()
      for (const seq of [...session.surface.nodes]) {
        const event = scan.eventAt(seq)
        if (event?.type !== 'tool/result') continue
        const captured = entries.get(callOf(event))
        if (captured === undefined) continue
        const content = session.deriveEventMessage(event)?.content
        if (readReference(content) !== null || scan.content(content).hash !== captured.contentHash
          || scan.content(messageOf(event).content).hash !== captured.contentHash) continue
        const length = scan.content(content).length
        const source = earlier.get(captured.key)
        if (source !== undefined && source.definition === captured.definition && length >= minChars) {
          // Keep the original restore locator stable across pre-step restore/re-short cycles.
          // Identical model-visible text then remains eligible for provider prefix caching.
          const restoreSeq = scan.reference(event)?.ref.restore ?? event.seq
          const replacement = referenceContent(source.seq, restoreSeq, captured.contentHash)
          const replacementLength = JSON.stringify(replacement).length
          if (replacementLength < length) {
            const replaced = scan.replace(event, replacement, [source.seq, restoreSeq])
            activeReferences.add(replaced.seq)
            const savedChars = length - replacementLength
            stats.charsSaved += savedChars
            shortened += 1
            if (typeof onShorten === 'function') {
              try { onShorten({ agent, originalSeq: event.seq, sourceSeq: source.seq, savedChars }) }
              catch (error) { warn('NEXT dedup statistics callback failed', error) }
            }
            continue
          }
        }
        earlier.set(captured.key, { seq, definition: captured.definition })
      }
    }
    stats.restored += restored
    stats.shortened += shortened
    if (activeReferences.size > 0) sessionsWithReferences.set(session, agent)
    else sessionsWithReferences.delete(session)
    return { shortened, restored, available }
  }

  function safelyPrepare(agent, options) {
    try { return prepareSession(agent, options) }
    catch (error) {
      // A rejected replacement never changes the log. Disable new savings and preserve the native task.
      if (agent?.session !== undefined) blocked.add(agent.session)
      stats.reason = `Dedup disabled after a surface compatibility failure: ${error.message}`
      stats.rejected += 1
      warn(`NEXT dedup: ${stats.reason}`)
      if (error.nextRequiredRecovery === true) throw error
      return { shortened: 0, restored: 0, available: false }
    }
  }

  if (typeof ctx?.on === 'function') {
    const on = (name, listener, options) => { const off = ctx.on(name, listener, options); if (typeof off === 'function') disposers.push(off) }
    if (available) {
      on('fs/observed', (target, observation, actor) => {
        if (actor?.name !== 'read' || actor.agent === undefined || actor.token === undefined
          || admitted.get(actor.token)?.agent !== actor.agent
          || observation?.kind !== 'present' || typeof observation.version !== 'string'
          || typeof target?.targetKey !== 'string') return
        observed.set(actor.token, { target: clone(target), version: observation.version })
      })
      on('tools/execute', async (exec, next) => {
        if (exec.name !== 'read' || exec.agent === undefined || !isEnabled(exec.agent)) return next()
        const definition = ctx.tools.get(exec.name, exec.agent)
        observed.delete(exec.token)
        admitted.set(exec.token, exec)
        let result
        try { result = await next() } // Always run the real read; native exceptions propagate unchanged.
        catch (error) { observed.delete(exec.token); throw error }
        finally { admitted.delete(exec.token) }
        try {
          const observation = observed.get(exec.token)
          if (result.isError === true || definition === undefined || observation === undefined
            || ctx.tools.get(exec.name, exec.agent) !== definition || !readValue(result.value)) return result
          const path = ctx.fs.processPath(observation.target)
          if (!isAbsolute(path) || path !== result.value.path) return result
          // Re-resolve through this Host's filesystem: a remote/MCP target must not masquerade as local.
          const target = await ctx.fs.resolve(path, { signal: exec.signal })
          if (target.targetKey !== observation.target.targetKey || ctx.fs.processPath(target) !== path) return result
          const info = await ctx.fs.stat(target, exec.signal)
          if (info?.type !== 'file' || info.version !== observation.version) return result
          attested.set(exec.token, { definition, path, target: target.targetKey, version: info.version })
          return result
        } catch {
          // A failed optional verification must not turn a successful read into a failed tool.
          stats.rejected += 1
          return result
        } finally { observed.delete(exec.token) }
      })
      on('tools/result', (exec, result) => { try { remember(exec, result) } catch { attested.delete(exec.token); observed.delete(exec.token) } })
    }
    // Run before native compaction constructs any auxiliary model request.
    on('agent/pre-step', async ({ agent }, next) => {
      safelyPrepare(agent, { restoreAll: true })
      return next()
    }, { prepend: true })
    on('agent/request-error', async ({ agent }, next) => {
      safelyPrepare(agent, { restoreAll: true })
      return next()
    }, { prepend: true })
    on('agent/turn-stopping', ({ agent }) => {
      safelyPrepare(agent, { restoreAll: true })
    }, { prepend: true })
    // The normal loop logs these replacements before freezing model history.
    on('agent/request', async ({ agent }, next) => {
      const config = await next()
      safelyPrepare(agent)
      return config
    }, { prepend: true })
  }

  return {
    available, stats, prepareSession,
    dispose() {
      for (const agent of sessionsWithReferences.values()) safelyPrepare(agent, { restoreAll: true })
      disposed = true
      for (const off of disposers.reverse()) off()
      admitted.clear(); observed.clear(); attested.clear()
      sessionsWithReferences.clear()
    },
  }
}
