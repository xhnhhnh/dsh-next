import { z } from 'zod'
import { sumCnyExact } from './meter.js'

export const AUTOMATION_RECORD = 'plugin:next/automation'
export const VERIFICATION_RECORD = 'plugin:next/verification'
const exact = z.string().regex(/^\d+(?:\.\d+)?$/)
const source = z.object({ sessionId: z.string(), callId: z.string(), originalCallId: z.string() }).strict()
const summary = z.object({ checkId: z.string(), status: z.enum(['executed','reused','failed','unknown','expired']), detail: z.string(), source }).strict()
const reservation = z.object({ id: z.string(), childId: z.string(), amountCny: z.number().nonnegative(), amountCnyExact: exact,
  provider: z.string(), model: z.string(), maxInputTokens: z.number(), maxOutputTokens: z.number(), at: z.number(),
  unknown: z.boolean().optional(), reason: z.string().optional() }).strict()
const budget = z.object({ spentCny: z.number().nonnegative(), spentCnyExact: exact, reservations: z.record(z.string(), reservation), settledIds: z.array(z.string()), children: z.array(z.string()) }).strict()
const verification = z.object({ executed: z.number(), reused: z.number(), failed: z.number(), unknown: z.number(), last: z.array(summary), seen: z.array(z.string()) }).strict()

/** Only this session's own durable facts are counted; forked prefixes never rebill usage. */
export const automationProjection = {
  key: 'nextAutomation', stateVersion: 2,
  stateSchema: z.object({ budget, verification, inheritedUntil: z.number(), ownerRootId: z.string().nullable() }).strict(),
  init: (_header, inheritedUntil = 0) => ({
    budget: { spentCny: 0, spentCnyExact: '0', reservations: {}, settledIds: [], children: [] },
    verification: { executed: 0, reused: 0, failed: 0, unknown: 0, last: [], seen: [] }, inheritedUntil, ownerRootId: null,
  }),
  apply(state, event) {
    if (event.ignorable !== true || event.seq < state.inheritedUntil) return state
    const data = event.data
    if (event.type === AUTOMATION_RECORD && data?.kind === 'owner' && typeof data.rootId === 'string') return { ...state, ownerRootId: data.rootId }
    if (event.type === VERIFICATION_RECORD) {
      const record = summary.safeParse(data && Object.fromEntries(['checkId','status','detail','source'].map(key => [key, data[key]])))
      if (!record.success || !record.data.source.callId) return state
      const id = JSON.stringify([record.data.source.sessionId, record.data.source.callId])
      if (record.data.status === 'expired') {
        const expiredId = `${id}:expired`
        if (state.verification.seen.includes(expiredId)) return state
        return { ...state, verification: { ...state.verification, unknown: state.verification.unknown + 1,
          last: [...state.verification.last.filter(item => JSON.stringify([item.source.sessionId,item.source.callId]) !== id),record.data].slice(-8),
          seen: [...state.verification.seen, ...(state.verification.seen.includes(id) ? [] : [id]), expiredId] } }
      }
      if (state.verification.seen.includes(id)) return state
      return { ...state, verification: { ...state.verification,
        [record.data.status]: state.verification[record.data.status] + 1,
        last: [...state.verification.last, record.data].slice(-8), seen: [...state.verification.seen, id] } }
    }
    if (event.type !== AUTOMATION_RECORD || !data || typeof data.id !== 'string') return state
    const current = state.budget
    if (data.kind === 'reserve') {
      const parsed = reservation.safeParse(Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'kind')))
      if (!parsed.success || current.reservations[data.id] || current.settledIds.includes(`reservation:${data.id}`)) return state
      return { ...state, budget: { ...current, reservations: { ...current.reservations, [data.id]: parsed.data },
        children: current.children.includes(data.childId) ? current.children : [...current.children, data.childId] } }
    }
    if (!current.reservations[data.id]) return state
    if (data.kind === 'unknown') return { ...state, budget: { ...current, reservations: { ...current.reservations,
      [data.id]: { ...current.reservations[data.id], unknown: true, reason: String(data.reason ?? 'Unsettled consumption').slice(0, 240) } } } }
    if (data.kind === 'settle' && typeof data.recordId === 'string' && !current.settledIds.includes(data.recordId) && exact.safeParse(data.costCnyExact).success) {
      const reservations = { ...current.reservations }; delete reservations[data.id]
      const spentCnyExact = sumCnyExact([current.spentCnyExact, data.costCnyExact])
      return { ...state, budget: { ...current, spentCnyExact, spentCny: Number(spentCnyExact), reservations,
        settledIds: [...current.settledIds, data.recordId, `reservation:${data.id}`] } }
    }
    return state
  },
  wire: { viewSchema: z.object({ verification: verification.omit({ seen: true }), spentCny: z.number(), reservedCny: z.number(), unknownReservations: z.number() }).strict(),
    view(state) {
      const { seen: _seen, ...verification } = state.verification
      const reservations = Object.values(state.budget.reservations)
      return { verification, spentCny: state.budget.spentCny,
        reservedCny: Number(sumCnyExact(reservations.map(item => item.amountCnyExact))), unknownReservations: reservations.filter(item => item.unknown).length }
    },
  },
}
