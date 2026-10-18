import { DEFAULT_PREFERENCES, resolvePreferences } from './preferences.js'

/** Optional labels: nothing is assigned to a model until the user chooses it. */
export const DEFAULT_OPTIMIZATION_TAGS = Object.freeze([
  Object.freeze({ id: 'economy', name: '低开销', preferences: Object.freeze({ responseStyle: 'concise', efficiencyGuidance: true, benefitBasedParallelism: false, automationParallelism: false }) }),
  Object.freeze({ id: 'code', name: '代码验证', preferences: Object.freeze({ efficiencyGuidance: true, methodGuidance: true, targetedVerification: true }) }),
  Object.freeze({ id: 'detailed', name: '详细解答', preferences: Object.freeze({ responseStyle: 'detailed' }) }),
])

const fields = Object.keys(DEFAULT_PREFERENCES)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = field => { throw new TypeError(`NEXT model setting "${field}" is invalid.`) }
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
function read(input, field) {
  try {
    const value = input[field]
    return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
  } catch { return fail(field) }
}

/** Validate only the whitelist; labels cannot inject arbitrary prompt text or config. */
export function normalizePreferenceOverrides(input = {}, field = 'overrides') {
  if (!object(input)) return fail(field)
  let keys
  try { keys = Object.keys(input) } catch { return fail(field) }
  if (keys.some(key => !fields.includes(key))) return fail(field)
  let full
  try { full = resolvePreferences(input) } catch { return fail(field) }
  return Object.fromEntries(keys.map(key => [key, full[key]]))
}

/** Exact tuples, rather than delimiter-joined names, isolate identical model IDs. */
export function modelKey(route) {
  return route && text(route.provider, 512) && text(route.model, 512) ? JSON.stringify([route.provider, route.model]) : undefined
}

export function normalizeModelSettings(input = {}) {
  if (!object(input)) return fail('settings')
  const tagsValue = read(input, 'optimizationTags'), profilesValue = read(input, 'modelProfiles')
  const rawTags = tagsValue === undefined ? DEFAULT_OPTIMIZATION_TAGS : tagsValue
  const rawProfiles = profilesValue === undefined ? [] : profilesValue
  if (!Array.isArray(rawTags) || rawTags.length > 100) return fail('optimizationTags')
  if (!Array.isArray(rawProfiles) || rawProfiles.length > 2000) return fail('modelProfiles')
  const ids = new Set(), routes = new Set()
  const optimizationTags = rawTags.map(tag => {
    if (!object(tag) || Object.keys(tag).some(key => !['id', 'name', 'preferences'].includes(key)) || !text(tag.id, 80) || !/^[A-Za-z0-9_-]+$/.test(tag.id) || !text(tag.name, 80) || ids.has(tag.id)) return fail('optimizationTags')
    ids.add(tag.id)
    return { id: tag.id, name: tag.name, preferences: normalizePreferenceOverrides(tag.preferences, 'optimizationTags.preferences') }
  })
  const modelProfiles = rawProfiles.map(profile => {
    const key = modelKey(profile)
    if (!object(profile) || Object.keys(profile).some(key => !['provider', 'model', 'tags', 'overrides'].includes(key)) || !key || routes.has(key)) return fail('modelProfiles')
    const tags = profile.tags ?? []
    if (!Array.isArray(tags) || tags.length > 64 || tags.some(id => !text(id, 80) || !/^[A-Za-z0-9_-]+$/.test(id)) || new Set(tags).size !== tags.length) return fail('modelProfiles.tags')
    routes.add(key)
    return { provider: profile.provider, model: profile.model, tags: [...tags], overrides: normalizePreferenceOverrides(profile.overrides, 'modelProfiles.overrides') }
  })
  return { modelProfiles, optimizationTags }
}

function merge(base, route, settings) {
  const key = modelKey(route)
  if (!key) return base
  const profile = settings.profiles.get(key)
  if (!profile) return base
  for (const id of profile.tags) {
    // Missing/deleted labels are inert; never silently infer an alternative.
    const tag = settings.tags.get(id)
    if (tag) Object.assign(base, tag.preferences)
  }
  return Object.assign(base, profile.overrides)
}

function indexed(settings) {
  return { profiles: new Map(settings.modelProfiles.map(profile => [modelKey(profile), profile])), tags: new Map(settings.optimizationTags.map(tag => [tag.id, tag])) }
}

export function resolveModelPreferences(input = {}, route) {
  return merge(resolvePreferences(input), route, indexed(normalizeModelSettings(input)))
}

/** Host Volatile arrays replace their value on edits. Avoid rescanning the catalog per tool. */
export function createModelPreferenceResolver(input = {}) {
  let previousProfiles, previousTags, cache
  return route => {
    const profiles = read(input, 'modelProfiles'), tags = read(input, 'optimizationTags')
    if (!cache || profiles !== previousProfiles || tags !== previousTags) {
      cache = indexed(normalizeModelSettings({ modelProfiles: profiles, optimizationTags: tags }))
      previousProfiles = profiles
      previousTags = tags
    }
    return merge(resolvePreferences(input), route, cache)
  }
}

/** Selection intent is distinct from an old request header. Never change host selection. */
export function selectedRoute(ctx, agent) {
  if (!agent?.session) return undefined
  let selection
  try { selection = ctx.sessionProjections.stateOf(agent.session, 'modelSelection') } catch { /* Optional native projection outside Desktop. */ }
  if (modelKey(selection?.pending)) return selection.pending
  // Child options are the native spawn route; a child must not inherit a parent's label.
  if (Math.max(agent.options?.subagentDepth ?? 0, agent.session.header?.delegationDepth ?? 0) > 0 && modelKey(agent.options)) return agent.options
  const logged = agent.session.requestHeader?.()?.config
  if (modelKey(logged)) return logged
  if (modelKey(selection?.lastUsed)) return selection.lastUsed
  let fallback
  try {
    fallback = (ctx.get?.('agentDefaultModel') ?? ctx.agentDefaultModel)?.currentSelection?.()
  } catch { /* Unknown route inherits unchanged global defaults. */ }
  // Desktop's blank-session native selection reads the live default ahead of
  // bootstrap Agent options. Headless Agents without that projection use options.
  if (selection && modelKey(fallback)) return fallback
  if (modelKey(agent.options)) return agent.options
  if (modelKey(fallback)) return fallback
  return undefined
}

/** A fork can share a loaded ancestor's budget after that ancestor's Agent is disposed. */
export function sessionRoute(ctx, session, assembledRoutes) {
  const live = ctx.agents.get(session.id)
  return live && assembledRoutes?.get(live) || selectedRoute(ctx, live ?? { session, options: {} })
}

/** Render only NEXT-owned sections against the route admitted by native selection. */
export function installModelPolicyAssembly(ctx, { preferences, isEnabled, onRoute, selectRoute, executionGuidance, preferencePrompt }) {
  return ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const agent = context.agent
    if (!agent) return assembly
    const route = modelKey(assembly.variables) ? { provider: assembly.variables.provider, model: assembly.variables.model } : selectRoute(agent)
    onRoute(agent, route)
    const active = isEnabled(agent), selected = preferences(route)
    const content = {
      'next:efficiency': active ? executionGuidance(selected) : '',
      'next:preferences': active ? preferencePrompt(selected) : '',
    }
    return { ...assembly,
      sections: assembly.sections.map(section => Object.hasOwn(content, section.name) ? { ...section, text: content[section.name] } : section),
      contexts: assembly.contexts?.filter(context => active || context.name !== 'next:registered-checks'),
      tools: assembly.tools.filter(tool => tool.name === 'next_verify' ? active : tool.name !== 'next_parallel' || active && selected.automationEnabled && selected.automationParallelism),
    }
  }, { global: true, prepend: true })
}
