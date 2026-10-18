import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PREFERENCES, executionGuidance, preferencePrompt } from '../lib/preferences.js'
import { DEFAULT_OPTIMIZATION_TAGS, normalizeModelSettings, normalizePreferenceOverrides, resolveModelPreferences,
  createModelPreferenceResolver, modelKey, selectedRoute, sessionRoute, installModelPolicyAssembly } from '../lib/model-preferences.js'

const a = { provider: 'a', model: 'shared' }, b = { provider: 'b', model: 'shared' }
const profile = (route, tags = [], overrides = {}) => ({ ...route, tags, overrides })

test('legacy global preferences are inherited exactly and labels are never assigned automatically', () => {
  const legacy = { outputLanguage: 'zh-CN', responseStyle: 'concise', efficiencyGuidance: true, expandTokenDetails: true }
  const expected = { ...DEFAULT_PREFERENCES, ...legacy }
  for (const route of [a, b, undefined]) assert.deepEqual(resolveModelPreferences(legacy, route), expected)
  const settings = normalizeModelSettings()
  assert.deepEqual(settings.modelProfiles, [])
  assert.deepEqual(settings.optimizationTags, DEFAULT_OPTIMIZATION_TAGS)
  settings.optimizationTags[0].preferences.responseStyle = 'detailed'
  assert.equal(DEFAULT_OPTIMIZATION_TAGS[0].preferences.responseStyle, 'concise')
})

test('provider and model form an exact tuple, including names containing delimiters', () => {
  const left = { provider: 'a/b', model: 'c' }, right = { provider: 'a', model: 'b/c' }
  assert.notEqual(modelKey(left), modelKey(right))
  const input = { modelProfiles: [profile(a, ['economy']), profile(left, [], { outputLanguage: 'ja' })] }
  assert.equal(resolveModelPreferences(input, a).automationParallelism, false)
  assert.equal(resolveModelPreferences(input, b).automationParallelism, true)
  assert.equal(resolveModelPreferences(input, left).outputLanguage, 'ja')
  assert.equal(resolveModelPreferences(input, right).outputLanguage, 'auto')
  assert.equal(resolveModelPreferences(input, { provider: 'a', model: 'Shared' }).efficiencyGuidance, false)
})

test('label order has explicit last-wins precedence and model overrides win last', () => {
  const input = { outputLanguage: 'en', responseStyle: 'standard', modelProfiles: [profile(a, ['economy', 'detailed'], { outputLanguage: 'ja' })] }
  let settings = resolveModelPreferences(input, a)
  assert.equal(settings.responseStyle, 'detailed')
  assert.equal(settings.efficiencyGuidance, true)
  assert.equal(settings.automationParallelism, false)
  assert.equal(settings.outputLanguage, 'ja')
  input.modelProfiles[0].tags.reverse()
  assert.equal(resolveModelPreferences(input, a).responseStyle, 'concise')
  input.modelProfiles[0].overrides.responseStyle = 'standard'
  assert.equal(resolveModelPreferences(input, a).responseStyle, 'standard')
  delete input.modelProfiles[0].overrides.responseStyle
  assert.equal(resolveModelPreferences(input, a).responseStyle, 'concise')
})

test('custom label policies affect only referencing models, and orphan labels are inert', () => {
  const input = { optimizationTags: [{ id: 'serial', name: '串行', preferences: { automationParallelism: false, automationBudgetCny: 1 } }],
    modelProfiles: [profile(a, ['missing', 'serial']), profile(b, ['missing'])] }
  assert.equal(resolveModelPreferences(input, a).automationBudgetCny, 1)
  assert.equal(resolveModelPreferences(input, a).automationParallelism, false)
  assert.equal(resolveModelPreferences(input, b).automationBudgetCny, 3)
  assert.equal(resolveModelPreferences(input, b).automationParallelism, true)
  input.optimizationTags[0].preferences.automationBudgetCny = 2
  assert.equal(resolveModelPreferences(input, a).automationBudgetCny, 2)
  input.optimizationTags = []
  assert.equal(resolveModelPreferences(input, a).automationBudgetCny, 3)
})

test('model policies accept only known typed preferences and preserve the root hard ceiling', () => {
  for (const invalid of [{ model: 'switch' }, { reasoningEffort: 'high' }, { prompt: 'unsafe arbitrary text' }, { automationBudgetCny: 3.01 }, { efficiencyGuidance: 'yes' }]) {
    assert.throws(() => normalizePreferenceOverrides(invalid), { message: 'NEXT model setting "overrides" is invalid.' })
  }
  assert.deepEqual(normalizePreferenceOverrides({ automationBudgetCny: 0, responseStyle: 'concise' }), { automationBudgetCny: 0, responseStyle: 'concise' })
  assert.throws(() => normalizePreferenceOverrides(JSON.parse('{"__proto__":{"automationBudgetCny":100}}')), TypeError)
  const privateSettings = { modelProfiles: [profile(a, [], { providerKey: 'private credential' })] }
  assert.throws(() => normalizeModelSettings(privateSettings), error => error instanceof TypeError && !error.message.includes('credential'))
})

test('bounded configuration rejects duplicate routes, duplicate label IDs and malformed arrays', () => {
  for (const input of [
    { modelProfiles: [profile(a), profile(a)] },
    { modelProfiles: [profile(a, ['economy', 'economy'])] },
    { modelProfiles: [profile(a, ['invalid label'])] },
    { modelProfiles: [profile({ provider: '', model: 'm' })] },
    { optimizationTags: [{ id: 'one', name: 'One' }, { id: 'one', name: 'Other' }] },
    { optimizationTags: [{ id: 'raw', name: 'Label', instructions: 'arbitrary instructions' }] },
    { optimizationTags: { get() { throw new Error('private credential') } } },
    { modelProfiles: null }, { optimizationTags: null },
  ]) {
    assert.throws(() => normalizeModelSettings(input), error => error instanceof TypeError && !error.message.includes('credential'))
  }
  assert.throws(() => normalizeModelSettings({ modelProfiles: Array.from({ length: 2001 }, () => profile(a)) }), TypeError)
  assert.throws(() => normalizeModelSettings({ optimizationTags: Array.from({ length: 101 }, (_, i) => ({ id: `tag${i}`, name: 'Tag' })) }), TypeError)
})

test('live Volatile edits replace policy caches and global inherited fields remain live', () => {
  const profiles = { value: [profile(a, ['economy'])], get() { return this.value } }
  const tags = { value: undefined, get() { return this.value } }
  const language = { value: 'en', get() { return this.value } }
  const resolve = createModelPreferenceResolver({ modelProfiles: profiles, optimizationTags: tags, outputLanguage: language })
  assert.equal(resolve(a).responseStyle, 'concise')
  assert.equal(resolve(b).responseStyle, 'standard')
  profiles.value = [profile(b, ['economy'])]
  assert.equal(resolve(a).responseStyle, 'standard')
  assert.equal(resolve(b).responseStyle, 'concise')
  tags.value = [{ id: 'economy', name: 'Changed', preferences: { responseStyle: 'detailed' } }]
  assert.equal(resolve(b).responseStyle, 'detailed')
  language.value = 'ja'
  assert.equal(resolve(b).outputLanguage, 'ja')
  const restored = createModelPreferenceResolver(JSON.parse(JSON.stringify({ modelProfiles: profiles.value, optimizationTags: tags.value, outputLanguage: 'ja' })))
  assert.deepEqual(restored(b), resolve(b))
})

test('selection intent beats stale request headers, and children use their own actual route', () => {
  const projection = { pending: b, lastUsed: a }
  const ctx = { sessionProjections: { stateOf: () => projection }, get: () => ({ currentSelection: () => b }) }
  const agent = { session: { header: {}, requestHeader: () => ({ config: a }) }, options: a }
  assert.equal(selectedRoute(ctx, agent), b)
  projection.pending = null
  assert.equal(selectedRoute(ctx, agent), a)
  const child = { session: { header: { parentSession: 'parent', delegationDepth: 1 }, requestHeader: () => ({ config: a }) }, options: b }
  assert.equal(selectedRoute(ctx, child), b)
  assert.equal(selectedRoute(ctx, { session: { header: {} }, options: {} }), a)
  assert.equal(selectedRoute({ sessionProjections: { stateOf() { throw new Error('missing') } }, get: ctx.get }, { session: { header: {} } }), b)
  assert.equal(selectedRoute({}, undefined), undefined)
  assert.deepEqual(agent.options, a, 'selection is read-only')
})

test('a native blank conversation follows the live default while headless and child routes retain their explicit options', () => {
  const native = { sessionProjections: { stateOf: () => ({ pending: null, lastUsed: null }) }, get: () => ({ currentSelection: () => b }) }
  const blank = { session: { header: {} }, options: a }
  assert.equal(selectedRoute(native, blank), b)
  const headless = { ...native, sessionProjections: { stateOf: () => undefined } }
  assert.equal(selectedRoute(headless, blank), a)
  const child = { session: { header: { parentSession: 'root', delegationDepth: 1 } }, options: a }
  assert.equal(selectedRoute(native, child), a)
})

test('a depth-zero fork follows its native session selection rather than spawn-only options', () => {
  const ctx = { sessionProjections: { stateOf: () => ({ pending: null, lastUsed: b }) }, get: () => ({ currentSelection: () => a }) }
  const fork = { session: { header: { parentSession: 'original' }, requestHeader: () => ({ config: b }) }, options: a }
  assert.equal(selectedRoute(ctx, fork), b)
  const spawned = { ...fork, options: { ...a, subagentDepth: 1 } }
  assert.deepEqual(selectedRoute(ctx, spawned), { ...a, subagentDepth: 1 })
})

test('a disposed root keeps its model budget preference from its durable session route', () => {
  let live
  const root = { id: 'root', header: {}, requestHeader: () => ({ config: a }) }
  const pending = { value: null }
  const ctx = { agents: { get: () => live }, sessionProjections: { stateOf: () => ({ pending: pending.value, lastUsed: a }) } }
  const prefs = createModelPreferenceResolver({ modelProfiles: [profile(a, [], { automationBudgetCny: 1 }), profile(b, [], { automationBudgetCny: 2 })] })
  const snapshots = new WeakMap()
  assert.equal(prefs(sessionRoute(ctx, root, snapshots)).automationBudgetCny, 1)
  pending.value = b
  assert.equal(prefs(sessionRoute(ctx, root, snapshots)).automationBudgetCny, 2)
  live = { session: root, options: b }
  snapshots.set(live, a)
  assert.equal(prefs(sessionRoute(ctx, root, snapshots)).automationBudgetCny, 1, 'an admitted live request keeps its captured root route')
  live = undefined
  assert.equal(prefs(sessionRoute(ctx, root, snapshots)).automationBudgetCny, 2, 'cold route never borrows a descendant agent option')
})

test('post-waterfall policies follow the admitted route during a concurrent model switch', async () => {
  const agent = {}, captured = [], input = { modelProfiles: [profile(a, ['economy'], { outputLanguage: 'ja' }), profile(b, ['detailed'], { outputLanguage: 'en' })] }
  let handler, selected = a, enabled = true
  installModelPolicyAssembly({ on(name, callback, options) { assert.equal(name, 'system-prompt/assemble'); assert.deepEqual(options, { global: true, prepend: true }); handler = callback } }, {
    preferences: createModelPreferenceResolver(input), isEnabled: () => enabled, onRoute: (_, route) => captured.push(route), selectRoute: () => selected, executionGuidance, preferencePrompt,
  })
  const original = { variables: a, sections: [{ name: 'other', text: 'Keep this' }, { name: 'next:preferences', text: 'stale English' }, { name: 'next:efficiency', text: '' }], contexts: [{ name: 'next:registered-checks', text: 'NEXT checks' }, { name: 'workspace', text: '/project' }], tools: [{ name: 'read' }, { name: 'next_parallel' }, { name: 'next_verify' }] }
  let release
  const operation = handler(original, { agent }, () => new Promise(resolve => { release = resolve }))
  selected = b
  release(original)
  const result = await operation
  assert.deepEqual(captured.at(-1), a)
  assert.match(result.sections.find(item => item.name === 'next:preferences').text, /Japanese.*Be concise/)
  assert.match(result.sections.find(item => item.name === 'next:efficiency').text, /NEXT is enabled/)
  assert.deepEqual(result.tools.map(tool => tool.name), ['read', 'next_verify'])
  assert.equal(result.sections[0], original.sections[0])
  assert.equal(original.sections[1].text, 'stale English', 'canonical upstream assembly is not mutated')
  const next = await handler(original, { agent }, async () => ({ ...original, variables: b }))
  assert.match(next.sections.find(item => item.name === 'next:preferences').text, /English.*useful detail/)
  assert.equal(next.tools.some(tool => tool.name === 'next_parallel'), true)
  enabled = false
  const off = await handler(original, { agent }, async () => original)
  assert.deepEqual(off.tools.map(tool => tool.name), ['read'])
  assert.deepEqual(off.contexts.map(context => context.name), ['workspace'])
  assert.ok(off.sections.filter(section => section.name.startsWith('next:')).every(section => section.text === ''))
})
