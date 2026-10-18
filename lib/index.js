import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { createMeter } from './meter.js'
import { installDedup } from './dedup.js'
import { effectiveState, metricsProjection, nextProjection, RECORDS } from './state.js'
import { resolvePreferences, preferencePrompt, executionGuidance } from './preferences.js'
import { inheritanceScheduler } from './inheritance.js'
import { defineTool, assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installVerification, normalizeVerificationChecks } from './verification.js'
import { automationProjection, AUTOMATION_RECORD, VERIFICATION_RECORD } from './automation-state.js'
import { installToolVisibility } from './visibility.js'
import { isAbsolute, relative, sep } from 'node:path'
import { installParallel } from './parallel.js'
import { DEFAULT_OPTIMIZATION_TAGS, normalizeModelSettings, createModelPreferenceResolver, selectedRoute, sessionRoute, modelKey, installModelPolicyAssembly } from './model-preferences.js'
import { capabilitiesProjection } from './capabilities.js'
import { installProduction } from './production.js'

export const name = 'dsh-next'
export const inject = ['sessionProjections', 'sessions', 'systemPrompt', 'llm', 'tools', 'fs', 'workingDirectory', 'agents']
const price = z.object({ provider: z.string().min(1), model: z.string().min(1), input: z.union([z.string(), z.number()]),
  cacheRead: z.union([z.string(), z.number()]), cacheWrite: z.union([z.string(), z.number()]), output: z.union([z.string(), z.number()]) }).strict()
const configSchema = z.object({
  deduplicateReads: z.boolean().default(true), efficiencyGuidance: z.boolean().default(false),
  methodGuidance: z.boolean().default(true), targetedVerification: z.boolean().default(true), benefitBasedParallelism: z.boolean().default(true),
  outputLanguage: z.enum(['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko']).default('auto'),
  responseStyle: z.enum(['standard', 'concise', 'detailed']).default('standard'),
  expandTokenDetails: z.boolean().default(false), prices: z.array(price).default([]),
  automationEnabled: z.boolean().default(true), automationVerification: z.boolean().default(true),
  automationParallelism: z.boolean().default(true), automationBudgetCny: z.number().min(0).max(3).default(3),
  modelProfiles: z.array(z.unknown()).default([]), optimizationTags: z.array(z.unknown()).default([]),
  automationPricesValidUntil: z.string().default(''),
  verificationChecks: z.array(z.unknown()).default([]),
}).strict()

// Only volatile fields are editable through the native settings document.
// Existing pricing remains a normal config field and is preserved by form edits.
const preferenceOverrides = Schema.object({
  outputLanguage: Schema.union(['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko']),
  responseStyle: Schema.union(['standard', 'concise', 'detailed']),
  deduplicateReads: Schema.boolean(), efficiencyGuidance: Schema.boolean(),
  methodGuidance: Schema.boolean(), targetedVerification: Schema.boolean(), benefitBasedParallelism: Schema.boolean(),
  expandTokenDetails: Schema.boolean(), automationEnabled: Schema.boolean(),
  automationVerification: Schema.boolean(), automationParallelism: Schema.boolean(),
  automationBudgetCny: Schema.number().min(0).max(3),
})
export const Config = Schema.object({
  outputLanguage: Schema.union(['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko']).default('auto').volatile(),
  responseStyle: Schema.union(['standard', 'concise', 'detailed']).default('standard').volatile(),
  deduplicateReads: Schema.boolean().default(true).volatile(),
  efficiencyGuidance: Schema.boolean().default(false).volatile(),
  methodGuidance: Schema.boolean().default(true).volatile(),
  targetedVerification: Schema.boolean().default(true).volatile(),
  benefitBasedParallelism: Schema.boolean().default(true).volatile(),
  expandTokenDetails: Schema.boolean().default(false).volatile(),
  automationEnabled: Schema.boolean().default(true).volatile(),
  automationVerification: Schema.boolean().default(true).volatile(),
  automationParallelism: Schema.boolean().default(true).volatile(),
  automationBudgetCny: Schema.number().min(0).max(3).default(3).volatile(),
  modelProfiles: Schema.array(Schema.object({ provider: Schema.string().required(), model: Schema.string().required(),
    tags: Schema.array(Schema.string()).default([]), overrides: preferenceOverrides.default({}),
  })).default([]).volatile(),
  optimizationTags: Schema.array(Schema.object({ id: Schema.string().required(), name: Schema.string().required(),
    preferences: preferenceOverrides.default({}),
  })).default(structuredClone(DEFAULT_OPTIMIZATION_TAGS)).volatile(),
  automationPricesValidUntil: Schema.string().default('').volatile(),
  verificationChecks: Schema.array(Schema.object({ id: Schema.string().required(), workspace: Schema.string().required(),
    kind: Schema.union(['json-syntax', 'json-schema', 'command', 'artifact']).required(), file: Schema.string(), schemaFile: Schema.string(),
    command: Schema.string(), timeoutMs: Schema.number().min(1000).max(120000),
    bindings: Schema.array(Schema.object({ file: Schema.string().required(), sha256: Schema.string().required() })),
    format: Schema.union(['csv', 'json', 'markdown']), requiredColumns: Schema.array(Schema.string()), requiredText: Schema.array(Schema.string()),
  })).default([]).volatile(),
  prices: Schema.array(Schema.object({ provider: Schema.string().required(), model: Schema.string().required(),
    input: Schema.union([Schema.string(), Schema.number()]).required(),
    cacheRead: Schema.union([Schema.string(), Schema.number()]).required(),
    cacheWrite: Schema.union([Schema.string(), Schema.number()]).required(),
    output: Schema.union([Schema.string(), Schema.number()]).required(),
  })).default([]).volatile(),
})

export const efficiencyGuidance = executionGuidance({ efficiencyGuidance: true })

/** Mount once at profile scope; the selected preset keeps control of its workflow. */
export function apply(ctx, input = {}) {
  const readConfig = field => input[field] && typeof input[field].get === 'function' ? input[field].get() : input[field]
  const modelPreferences = createModelPreferenceResolver(input)
  const assembledRoutes = new WeakMap()
  const preferences = (agent, currentSelection = false) => modelPreferences(!currentSelection && assembledRoutes.get(agent) || selectedRoute(ctx, agent))
  const config = configSchema.parse({ ...input, ...Object.fromEntries(['prices','automationPricesValidUntil','verificationChecks'].map(field=>[field,readConfig(field)])), ...resolvePreferences(input), ...normalizeModelSettings(input) })
  let checksValue, registeredChecks
  const registered = () => { const value=readConfig('verificationChecks')??config.verificationChecks; if(value!==checksValue){registeredChecks=normalizeVerificationChecks(value);checksValue=value}return registeredChecks }
  registered()
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.sessionProjections.register(nextProjection)
  ctx.sessionProjections.register(metricsProjection)
  ctx.sessionProjections.register(automationProjection)
  ctx.sessionProjections.register(capabilitiesProjection)
  let production
  const enabledSession = session => effectiveState(ctx, session).active
  const enabledAgent = agent => Boolean(agent?.session && enabledSession(agent.session))
  const projectChecks = agent => {
    if (!agent?.session) return []
    const cwd = ctx.workingDirectory.get(agent.session)
    return registered().filter(check => {
      const path = relative(check.workspace, cwd)
      return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
    })
  }
  const verification = installVerification(ctx, { defineTool, createUserMessage, assertSupportedJsonSchema, validateJsonSchemaValue,
    isEnabled: enabledAgent,
    autoEnabled: agent => enabledAgent(agent) && preferences(agent).automationEnabled && preferences(agent).automationVerification,
    getChecks: projectChecks,
    onRecord(record, agent) { for (const target of lineage(agent.session)) appendPluginRecord(target, VERIFICATION_RECORD, record);production?.record(record,agent) },
  })
  const parallelEnabled = (agent, currentSelection = false) => enabledAgent(agent) && preferences(agent, currentSelection).automationEnabled && preferences(agent, currentSelection).automationParallelism
  const rootSession = agent => {
    const chain = lineage(agent.session), root = chain.at(-1)
    if (!root || root.header.parentSession) throw new Error('NEXT automation requires the complete parent session tree.')
    return root
  }
  let parallel,visibility
  ctx.inject(['subagents'], own => {
    parallel = installParallel(own,{ defineTool,isEnabled: parallelEnabled,getRoot: rootSession,
      getPrices:()=>readConfig('prices')??config.prices, priceValidUntil:()=>readConfig('automationPricesValidUntil')??config.automationPricesValidUntil,
      getBudget:root=>({...ctx.sessionProjections.stateOf(root,'nextAutomation').budget,limitCny:Math.min(3,modelPreferences(sessionRoute(ctx,root,assembledRoutes)).automationBudgetCny)}),
      appendBudget:(root,event)=>appendPluginRecord(root,AUTOMATION_RECORD,event), flush:root=>ctx.sessions.flush(root),
      markChild:(agent,root)=>appendPluginRecord(agent.session,AUTOMATION_RECORD,{kind:'owner',rootId:root.id}),
      flushChild:id=>ctx.sessions.flush(ctx.sessions.get(id)),
      isOwnedSession:session=>typeof ctx.sessionProjections.stateOf(session,'nextAutomation')?.ownerRootId==='string',
      readOnlyDefinitions:parent=>new Map(['read','glob','grep'].map(name=>[name,ctx.tools.get(name,parent)]).filter(([,definition])=>definition!==undefined)),
    })
    own.effect(()=>()=>parallel.dispose(),'next.parallel()')
    visibility?.syncAll()
  })
  production=installProduction(ctx,{isEnabled:enabledAgent,preferences:modelPreferences,verification,getChecks:projectChecks,
    getPrices:()=>readConfig('prices')??config.prices,getPriceExpiry:()=>readConfig('automationPricesValidUntil')??config.automationPricesValidUntil,
    getBudget:agent=>({...ctx.sessionProjections.stateOf(rootSession(agent),'nextAutomation').budget,limitCny:Math.min(3,modelPreferences(sessionRoute(ctx,rootSession(agent),assembledRoutes)).automationBudgetCny)}),
  })
  visibility = installToolVisibility(ctx, { names: ['next_verify','next_parallel'],isVisible:production.visible })
  production.setVisibility(visibility)
  ctx.systemPrompt.context({ name: 'next:registered-checks', order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY') + 1,
    text({ agent }) {
      if (!enabledAgent(agent) || !projectChecks(agent).length) return ''
      return `NEXT registered project checks: ${verification.checks(agent).map(check => `${check.id} (${check.kind})`).join(', ')}. When automation is enabled, one concise notice reports actual checks after edits. A passed notice covers only its stated inputs until they change; do not run the same unchanged check again merely to produce another receipt. Call next_verify(check_id) when proof is missing or expired. Unknown and expired are not passing. Registered command checks execute through Host permissions and are never cached across tasks.`
    },
  })
  let disposed = false
  const reportFailure = (message, error) => ctx.logger?.warn?.(`${message}: ${error instanceof Error ? error.message : String(error)}`)

  function lineage(session) {
    const result = []
    const seen = new Set()
    while (session && !seen.has(session.id)) {
      seen.add(session.id)
      result.push(session)
      session = session.header.parentSession ? ctx.sessions.get(session.header.parentSession) : undefined
    }
    return result
  }

  function syncInheritance() {
    if (disposed) return
    for (const session of ctx.sessions.list()) {
      const local = ctx.sessionProjections.stateOf(session, 'next')
      if (local?.explicit || !session.header.parentSession) continue
      const state = effectiveState(ctx, session)
      if (local.active !== state.active || !local.inherited) {
        appendPluginRecord(session, RECORDS.inherit, { active: state.active, parentSession: session.header.parentSession })
      }
    }
    visibility.syncAll()
  }

  const recordUsage = record => {
    const session = record.sessionId && ctx.sessions.get(record.sessionId)
    if (!session) return
    try {
      for (const target of lineage(session)) appendPluginRecord(target, RECORDS.usage, record)
    } catch (error) {
      reportFailure('NEXT could not persist usage; statistics may be incomplete', error)
      throw error
    }
  }
  let meterPrices, meter
  const currentMeter = () => {
    const prices=readConfig('prices')??config.prices
    if(!meter||meterPrices!==prices){
      try{meter=createMeter({prices,retainRecords:false,onRecord:recordUsage})}
      catch(error){
        // A malformed live price edit must not prevent the user's main task.
        // Empty rates preserve usage while explicitly leaving cost unknown.
        reportFailure('NEXT pricing is invalid; cost estimates are unknown',error)
        meter=createMeter({prices:[],retainRecords:false,onRecord:recordUsage})
      }
      meterPrices=prices
    }
    return meter
  }
  ctx.on('llm/stream', (options, next) => {
    const session = options.sessionId && ctx.sessions.get(options.sessionId)
    return session && enabledSession(session) ? currentMeter().wrap(options, next) : next()
  }, { global: true })

  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({ definitionId: '@local/dsh-next', name: 'next',
      description: 'Toggle NEXT efficiency for this session without sending a message.', input: { hint: 'on|off|status' },
      async handler({ agent, rawInput }) {
        const choice = rawInput.trim()
        if (choice === 'status') {
          const state = effectiveState(ctx, agent.session)
          const metrics = ctx.sessionProjections.stateOf(agent.session, 'nextMetrics')?.view
          const capabilities=await production.refresh(agent,{inspect:true})
          return { kind: 'success', text: `NEXT ${state.active ? 'on' : 'off'}${state.inherited ? ' (inherited)' : ''}. ${JSON.stringify({metrics,capabilities})}` }
        }
        if (choice !== 'on' && choice !== 'off') return { kind: 'error', text: 'Use /next on, /next off or /next status.' }
        return { kind: 'success', text: `NEXT ${choice}.` }
      },
    })
  })

  ctx.systemPrompt.section({ name: 'next:efficiency', order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 20,
    text(context) {
      const agent = context.agent
      if (!enabledAgent(agent)) return ''
      return executionGuidance(preferences(agent, true))
    },
  })

  ctx.systemPrompt.section({ name: 'next:preferences', order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 21,
    text(context) { return enabledAgent(context.agent) ? preferencePrompt(preferences(context.agent, true)) : '' },
  })

  // The native selector snapshots the route before its asynchronous waterfall.
  // Recompute only our existing sections from the final assembly route, so a
  // concurrent switch cannot apply model B's policies to model A's request.
  installModelPolicyAssembly(ctx, { preferences: modelPreferences, isEnabled: enabledAgent,
    onRoute(agent, route) { if (route) assembledRoutes.set(agent, route); else assembledRoutes.delete(agent) },
    selectRoute: agent => selectedRoute(ctx, agent), executionGuidance, preferencePrompt,
  })
  ctx.on('agent/request', async ({ agent }, next) => {
    const request = await next()
    if (modelKey(request)) assembledRoutes.set(agent, { provider: request.provider, model: request.model })
    return request
  }, { global: true, prepend: true })

  const dedup = installDedup(ctx, {
    isEnabled: agent => enabledAgent(agent) && preferences(agent).deduplicateReads,
    onShorten({ agent, originalSeq, sourceSeq, savedChars }) {
      for (const session of lineage(agent.session)) appendPluginRecord(session, RECORDS.dedup, {
        sessionId: agent.session.id, originalSeq, sourceSeq, savedChars,
      })
    },
  })
  const inheritance = inheritanceScheduler({ active: enabledSession, sync: syncInheritance,
    reportFailure: error => reportFailure('NEXT inheritance sync failed', error) })
  ctx.on('session/event', (session, event) => inheritance.sessionEvent(session, event), { global: true })
  ctx.on('agent/created', () => inheritance.agentCreated(), { global: true })
  visibility.syncAll()
  ctx.effect(() => () => { disposed = true; inheritance.dispose(); production.dispose(); visibility.dispose(); verification.dispose(); dedup?.dispose?.() }, 'next.lifecycle()')
}
