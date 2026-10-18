import { randomUUID } from 'node:crypto'

const BUCKETS = ['input', 'cacheRead', 'cacheWrite', 'output']
const USAGE_FIELDS = { input: 'inputTokens', cacheRead: 'cacheReadTokens', cacheWrite: 'cacheWriteTokens', output: 'outputTokens' }
const count = value => Number.isSafeInteger(value) && value >= 0
const emptyTokens = () => ({ input: null, cacheRead: null, cacheWrite: null, output: null, total: null })

/** Parse a nonnegative decimal without rounding intermediate money calculations. */
function decimal(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError('CNY values must be numbers or decimal strings')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('CNY values must be finite')
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match || String(value).length > 80) throw new TypeError('CNY values must be nonnegative decimals')
  const exponent = Number(match[3] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40) throw new TypeError('CNY exponent is out of range')
  const digits = match[1] + (match[2] ?? '')
  const scale = (match[2]?.length ?? 0) - exponent
  return scale < 0 ? { units: BigInt(digits) * 10n ** BigInt(-scale), scale: 0 } : { units: BigInt(digits), scale }
}

function add(left, right) {
  const scale = Math.max(left.scale, right.scale)
  return { units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale), scale }
}

function exact(value) {
  if (value.units === 0n) return '0'
  const digits = value.units.toString().padStart(value.scale + 1, '0')
  return value.scale === 0 ? digits : `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(/\.?0+$/, '')
}

function money(value) {
  const result = Number(exact(value))
  if (!Number.isFinite(result)) throw new RangeError('CNY amount exceeds the display range')
  return result
}

/** Add durable nonnegative money strings without binary rounding. */
export function sumCnyExact(values) {
  return exact([...values].reduce((total, value) => add(total, decimal(value)), { units: 0n, scale: 0 }))
}

function validatePrice(price) {
  if (!price || typeof price.provider !== 'string' || !price.provider || typeof price.model !== 'string' || !price.model) {
    throw new TypeError('Each price needs an exact provider and model')
  }
  return { ...price, rates: Object.fromEntries(BUCKETS.map(key => [key, decimal(price[key])])) }
}

function normalizeUsage(usage) {
  const invalid = () => ({ tokens: emptyTokens(), reason: 'usage-invalid' })
  if (!usage || typeof usage !== 'object') return invalid()
  const tokens = emptyTokens()
  for (const key of BUCKETS) {
    const value = usage[USAGE_FIELDS[key]]
    if (value !== undefined && !count(value)) return invalid()
    tokens[key] = value ?? null
  }
  if (tokens.input === null || tokens.output === null) return invalid()
  if (usage.reasoningTokens !== undefined && (!count(usage.reasoningTokens) || usage.reasoningTokens > tokens.output)) return invalid()
  if (usage.totalTokens !== undefined && !count(usage.totalTokens)) return invalid()
  const knownSum = BUCKETS.reduce((sum, key) => sum + (tokens[key] ?? 0), 0)
  if (!count(knownSum)) return invalid()
  if (usage.totalTokens !== undefined) {
    tokens.total = usage.totalTokens
    const remainder = tokens.total - knownSum
    if (remainder < 0) return invalid()
    const missing = BUCKETS.filter(key => tokens[key] === null)
    if (missing.length === 0 && remainder !== 0) return invalid()
    if (missing.length === 1) tokens[missing[0]] = remainder
    else if (remainder === 0) for (const key of missing) tokens[key] = 0
  } else if (BUCKETS.every(key => tokens[key] !== null)) tokens.total = knownSum
  return { tokens, reason: BUCKETS.every(key => tokens[key] !== null) ? null : 'usage-buckets-incomplete' }
}

function quote(tokens, price) {
  let total = { units: 0n, scale: 0 }
  if (price) for (const key of BUCKETS) {
    if (tokens[key] !== null) total = add(total, { units: BigInt(tokens[key]) * price.rates[key].units, scale: price.rates[key].scale + 6 })
  }
  return total
}

/**
 * Price canonical provider usage in CNY. Prices are per million tokens and all
 * four disjoint buckets are required; reasoning is already included in output.
 * Missing/ambiguous usage remains unknown; knownCostCny is only a lower bound.
 */
export function priceTokenUsage(usage, price) {
  const normalized = normalizeUsage(usage)
  const resolvedPrice = price === undefined ? undefined : validatePrice(price)
  const value = quote(normalized.tokens, resolvedPrice)
  const complete = normalized.reason === null && resolvedPrice !== undefined
  return {
    tokens: normalized.tokens,
    costCny: complete ? money(value) : null,
    costCnyExact: complete ? exact(value) : null,
    knownCostCny: money(value),
    knownCostCnyExact: exact(value),
    usageComplete: normalized.reason === null,
  }
}

/**
 * Conservatively reserve uncached input plus the configured maximum output.
 * The caller must include auxiliary calls separately; this does not contact an API.
 */
export function estimateCallReservation({ inputTokens, maxOutputTokens, price }) {
  if (!count(inputTokens) || !count(maxOutputTokens)) throw new TypeError('Reservation tokens must be nonnegative safe integers')
  const resolved = validatePrice(price)
  const inputRate = ['input', 'cacheRead', 'cacheWrite'].map(key => resolved.rates[key]).reduce((left, right) => {
    const scale = Math.max(left.scale, right.scale)
    return left.units * 10n ** BigInt(scale - left.scale) >= right.units * 10n ** BigInt(scale - right.scale) ? left : right
  })
  const value = add(
    { units: BigInt(inputTokens) * inputRate.units, scale: inputRate.scale + 6 },
    { units: BigInt(maxOutputTokens) * resolved.rates.output.units, scale: resolved.rates.output.scale + 6 },
  )
  return { costCny: money(value), costCnyExact: exact(value) }
}

/** Pure exact check for a caller-owned budget, including outstanding reservations. */
export function canReserveBudget({ limitCny, spentCny = 0, reservedCny = 0 }, reservationCny) {
  const limit = decimal(limitCny)
  const proposed = add(add(decimal(spentCny), decimal(reservedCny)), decimal(reservationCny))
  const scale = Math.max(limit.scale, proposed.scale)
  return proposed.units * 10n ** BigInt(scale - proposed.scale) <= limit.units * 10n ** BigInt(scale - limit.scale)
}

function validateRecord(record) {
  if (!record || record.version !== 1 || typeof record.id !== 'string' || !record.id
    || !['completed', 'failed', 'cancelled'].includes(record.status)
    || !record.tokens || !BUCKETS.concat('total').every(key => record.tokens[key] === null || count(record.tokens[key]))
    || typeof record.usageComplete !== 'boolean' || typeof record.usageObserved !== 'boolean' || typeof record.priceKnown !== 'boolean'
    || !Array.isArray(record.unknownReasons) || !record.unknownReasons.every(reason => typeof reason === 'string')
    || !Number.isFinite(record.startedAt) || !Number.isFinite(record.endedAt)
    || !Number.isFinite(record.durationMs) || record.durationMs < 0
    || ![record.sessionId, record.provider, record.model, record.purpose].every(value => value === null || typeof value === 'string')) {
    throw new TypeError('Invalid NEXT meter record')
  }
  decimal(record.knownCostCnyExact)
  if (record.costCnyExact !== null) decimal(record.costCnyExact)
}

/**
 * Aggregate persisted v1 records by unique id, without consulting current prices.
 * elapsedMs spans their wall clock; totalDurationMs sums individual call times,
 * including overlaps. Known token totals are lower bounds when usage is partial.
 */
export function summarizeRecords(input) {
  const unique = new Map()
  for (const record of input) {
    validateRecord(record)
    if (!unique.has(record.id)) unique.set(record.id, record)
  }
  const selected = [...unique.values()]
  const overflowedTokenBuckets = []
  const knownTokens = Object.fromEntries(BUCKETS.concat('total').map(key => {
    const sum = selected.reduce((total, record) => total + BigInt(record.tokens[key] ?? 0), 0n)
    if (sum > BigInt(Number.MAX_SAFE_INTEGER)) { overflowedTokenBuckets.push(key); return [key, null] }
    return [key, Number(sum)]
  }))
  const tokens = Object.fromEntries(BUCKETS.concat('total').map(key => [key, selected.some(record => record.tokens[key] === null) ? null : knownTokens[key]]))
  const value = selected.reduce((sum, record) => add(sum, decimal(record.knownCostCnyExact)), { units: 0n, scale: 0 })
  const costComplete = selected.every(record => record.costCnyExact !== null)
  return {
    calls: selected.length,
    completed: selected.filter(record => record.status === 'completed').length,
    failed: selected.filter(record => record.status === 'failed').length,
    cancelled: selected.filter(record => record.status === 'cancelled').length,
    usageComplete: selected.every(record => record.usageComplete) && overflowedTokenBuckets.length === 0,
    tokens,
    knownTokens,
    overflowedTokenBuckets,
    costCny: costComplete ? money(value) : null,
    costCnyExact: costComplete ? exact(value) : null,
    knownCostCny: money(value),
    knownCostCnyExact: exact(value),
    unknownUsageCalls: selected.filter(record => !record.usageComplete).length,
    unknownPriceCalls: selected.filter(record => !record.priceKnown).length,
    elapsedMs: selected.length === 0 ? 0 : Math.max(0, Math.max(...selected.map(record => record.endedAt)) - Math.min(...selected.map(record => record.startedAt))),
    totalDurationMs: selected.reduce((sum, record) => sum + record.durationMs, 0),
    records: structuredClone(selected),
  }
}

/**
 * Create a dependency-free LLM waterfall meter. wrap() never changes a request or
 * chunk and invokes next() exactly once when iteration starts. Its admitted call
 * is settled even if the caller later disables NEXT. onRecord is awaited once;
 * callback failures are counted without masking the provider's original outcome.
 *
 * prices: [{provider, model, input, cacheRead, cacheWrite, output}], CNY/million.
 * snapshot(id, {descendants: iterableOfSessionIds}) includes each record once.
 * snapshot() includes every record. restore() replays persisted v1 records once.
 */
export function createMeter({ prices = [], now = Date.now, onRecord, records: initialRecords = [], retainRecords = true } = {}) {
  if (typeof retainRecords !== 'boolean') throw new TypeError('retainRecords must be a boolean')
  if (!retainRecords && initialRecords.length) throw new TypeError('History is unavailable when retainRecords is false')
  const priceMap = new Map()
  for (const price of prices) {
    const resolved = validatePrice(price)
    const key = JSON.stringify([price.provider, price.model])
    if (priceMap.has(key)) throw new TypeError('Duplicate provider/model price')
    priceMap.set(key, resolved)
  }
  const records = new Map()
  let recordErrors = 0

  function restore(record) {
    if (!retainRecords) throw new Error('History is unavailable when retainRecords is false')
    validateRecord(record)
    if (records.has(record.id)) return false
    records.set(record.id, structuredClone(record))
    return true
  }

  async function* wrap(options, next) {
    const startedAt = now()
    const attribution = { sessionId: options.sessionId ?? null, provider: options.provider ?? null, model: options.model ?? null, purpose: options.purpose ?? null }
    let observed = false
    let normalized = { tokens: emptyTokens(), reason: 'usage-missing' }
    let ended = false
    let finished = false
    let finishReason
    let hasFailure = false
    let failure
    try {
      const source = next()
      for await (const chunk of source) {
        if (chunk.type === 'usage') {
          observed = true
          normalized = normalizeUsage(chunk.usage)
        }
        if (chunk.type === 'finish') { finished = true; finishReason = chunk.reason?.kind }
        yield chunk
      }
      ended = true
    } catch (error) {
      hasFailure = true
      failure = error
      throw error
    } finally {
      const endedAt = now()
      const price = priceMap.get(JSON.stringify([attribution.provider, attribution.model]))
      const complete = normalized.reason === null && (ended || finished)
      const value = quote(normalized.tokens, price)
      const cancelled = finishReason === 'aborted' || failure?.name === 'AbortError'
        || (!finished && options.signal?.aborted === true) || (!hasFailure && !ended && !finished)
      const status = hasFailure ? (cancelled ? 'cancelled' : 'failed') : finishReason === 'error' ? 'failed' : cancelled ? 'cancelled' : 'completed'
      const record = {
        version: 1,
        id: randomUUID(),
        ...attribution,
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        status,
        usageObserved: observed,
        usageComplete: complete,
        priceKnown: price !== undefined,
        tokens: normalized.tokens,
        costCny: complete && price ? money(value) : null,
        costCnyExact: complete && price ? exact(value) : null,
        knownCostCny: money(value),
        knownCostCnyExact: exact(value),
        unknownReasons: [normalized.reason, !ended && !finished ? 'stream-incomplete' : null, !price ? 'price-missing' : null].filter(Boolean),
      }
      if (retainRecords) restore(record)
      if (onRecord) {
        try { await onRecord(structuredClone(record)) }
        catch (_error) { recordErrors += 1 }
      }
    }
  }

  function snapshot(sessionId, { descendants = [] } = {}) {
    if (!retainRecords) throw new Error('History is unavailable when retainRecords is false')
    if (typeof descendants === 'string' || descendants === null || typeof descendants[Symbol.iterator] !== 'function') {
      throw new TypeError('descendants must be an iterable of session IDs')
    }
    const sessions = new Set([sessionId, ...descendants])
    const selected = [...records.values()].filter(record => sessionId === undefined || sessions.has(record.sessionId))
    return { ...summarizeRecords(selected), recordErrors }
  }

  for (const record of initialRecords) restore(record)
  return { wrap, snapshot, restore }
}
