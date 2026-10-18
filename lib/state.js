import { z } from 'zod'

export const RECORDS = Object.freeze({ usage: 'plugin:next/usage', inherit: 'plugin:next/inherit', dedup: 'plugin:next/dedup' })

/** Successful native commands, rather than client state, own the durable switch. */
export const nextProjection = {
  key: 'next',
  stateVersion: 2,
  stateSchema: z.object({
    active: z.boolean(), explicit: z.boolean(), inherited: z.boolean(), lastApplied: z.number(), inheritedUntil: z.number(),
    running: z.record(z.string(), z.object({ wanted: z.boolean(), seq: z.number() })),
  }).strict(),
  init: (_header, inheritedEventCount=0) => ({ active: false, explicit: false, inherited: false, lastApplied: -1, inheritedUntil: inheritedEventCount, running: {} }),
  apply(state, event) {
    if (event.type === 'command/run' && event.data.name === 'next') {
      const choice = event.data.args?.trim()
      if (choice !== 'on' && choice !== 'off') return state
      return { ...state, running: { ...state.running, [event.data.commandId]: { wanted: choice === 'on', seq: event.seq } } }
    }
    if (event.type === 'command/done') {
      const pending = state.running[event.data.commandId]
      if (!pending) return state
      const running = { ...state.running }
      delete running[event.data.commandId]
      return event.data.kind === 'success' && pending.seq > state.lastApplied
        ? { ...state, active: pending.wanted, explicit: pending.seq>=state.inheritedUntil, inherited: pending.seq<state.inheritedUntil, lastApplied: pending.seq, running }
        : { ...state, running }
    }
    if (event.type === RECORDS.inherit && event.ignorable === true && !state.explicit) {
      const active = event.data.active
      if (typeof active === 'boolean') return { ...state, active, inherited: true }
    }
    return state
  },
  wire: {
    viewSchema: z.object({ active: z.boolean(), inherited: z.boolean() }).strict(),
    view: state => ({ active: state.active, inherited: state.inherited }),
  },
}

const tokenFields = { input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadTokens', cacheWrite: 'cacheWriteTokens' }
export const metricsViewSchema = z.object({
  calls: z.number(), inputTokens: z.number().nullable(), outputTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(), cacheWriteTokens: z.number().nullable(), elapsedMs: z.number(),
  costCny: z.number().nullable(), unknownUsageCalls: z.number(), unknownPriceCalls: z.number(),
  deduplicatedReads: z.number(), coverage: z.literal('host-routed'), warnings: z.array(z.string()),
}).strict()

export function emptyMetrics() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, elapsedMs: 0,
    costCny: 0, unknownUsageCalls: 0, unknownPriceCalls: 0, deduplicatedReads: 0, coverage: 'host-routed', warnings: [] }
}

/** Incremental aggregation never prices old calls using today's price table. */
export const metricsProjection = {
  key: 'nextMetrics', stateVersion: 2,
  stateSchema: z.object({ view: metricsViewSchema, seen: z.array(z.string()), inheritedUntil:z.number() }).strict(),
  init: (_header, inheritedEventCount=0) => ({ view: emptyMetrics(), seen: [], inheritedUntil:inheritedEventCount }),
  apply(state, event) {
    if(event.seq<state.inheritedUntil)return state
    if (event.ignorable !== true) return state
    if (event.type === RECORDS.dedup) {
      return { ...state, view: { ...state.view, deduplicatedReads: state.view.deduplicatedReads + 1 } }
    }
    if (event.type !== RECORDS.usage || typeof event.data?.id !== 'string' || state.seen.includes(event.data.id)) return state
    const record = event.data
    if (record.version !== 1 || typeof record.usageComplete !== 'boolean' || !record.tokens) return state
    const view = { ...state.view, calls: state.view.calls + 1,
      elapsedMs: state.view.elapsedMs + Math.max(0, record.durationMs ?? 0),
      unknownUsageCalls: state.view.unknownUsageCalls + (record.usageComplete ? 0 : 1),
      unknownPriceCalls: state.view.unknownPriceCalls + (record.priceKnown ? 0 : 1),
      costCny: state.view.costCny === null || record.costCny === null ? null : state.view.costCny + record.costCny,
    }
    for (const [bucket, field] of Object.entries(tokenFields)) {
      const amount = record.tokens[bucket]
      view[field] = state.view[field] === null || !record.usageComplete || !Number.isSafeInteger(amount) ? null : state.view[field] + amount
    }
    return { ...state, view, seen: [...state.seen, record.id] }
  },
  wire: { viewSchema: metricsViewSchema, view: state => state.view },
}

/** A local choice wins; otherwise resolve the nearest live ancestor or saved inheritance. */
export function effectiveState(ctx, session) {
  const origin = ctx.sessionProjections.stateOf(session, 'next')
  if (!origin) throw new Error('NEXT session projection is unavailable')
  const visited = new Set()
  let current = session
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const state = ctx.sessionProjections.stateOf(current, 'next')
    if (state?.explicit) return { active: state.active, inherited: current !== session }
    const parent = current.header.parentSession
    if (!parent) return { active: state?.active ?? origin.active, inherited: current !== session || origin.inherited }
    current = ctx.sessions.get(parent)
  }
  return { active: origin.active, inherited: origin.inherited }
}
