import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PREFERENCES, preferencePrompt, resolvePreferences, executionGuidance } from '../lib/preferences.js'

test('defaults are frozen and resolving preferences creates an independent object', () => {
  assert.deepEqual(DEFAULT_PREFERENCES, {
    outputLanguage: 'auto', responseStyle: 'standard', deduplicateReads: true,
    efficiencyGuidance: false, expandTokenDetails: false,
    methodGuidance: true, targetedVerification: true, benefitBasedParallelism: true,
    automationEnabled: true, automationVerification: true,
    automationParallelism: true, automationBudgetCny: 3,
  })
  assert.equal(Object.isFrozen(DEFAULT_PREFERENCES), true)
  const resolved = resolvePreferences()
  assert.deepEqual(resolved, DEFAULT_PREFERENCES)
  assert.notEqual(resolved, DEFAULT_PREFERENCES)
  resolved.outputLanguage = 'ja'
  assert.equal(DEFAULT_PREFERENCES.outputLanguage, 'auto')
})

test('known fields accept plain and host Volatile values, preserving get receiver', () => {
  const language = { value: 'zh-TW', get() { return this.value } }
  assert.deepEqual(resolvePreferences({
    outputLanguage: language,
    responseStyle: 'concise',
    deduplicateReads: { get() { return false } },
    efficiencyGuidance: true,
    expandTokenDetails: { get() { return true } },
  }), {
    outputLanguage: 'zh-TW', responseStyle: 'concise', deduplicateReads: false,
    efficiencyGuidance: true, expandTokenDetails: true,
    methodGuidance: true, targetedVerification: true, benefitBasedParallelism: true,
    automationEnabled: true, automationVerification: true,
    automationParallelism: true, automationBudgetCny: 3,
  })
  language.value = 'ko'
  assert.equal(resolvePreferences({ outputLanguage: language }).outputLanguage, 'ko')
  assert.equal(resolvePreferences({ responseStyle: { get: () => undefined } }).responseStyle, 'standard')
})

test('unknown settings are not traversed or serialized', () => {
  const settings = { outputLanguage: 'en' }
  Object.defineProperty(settings, 'prices', { enumerable: true, get() { throw new Error('private prices') } })
  assert.equal(resolvePreferences(settings).outputLanguage, 'en')
  assert.match(preferencePrompt(settings), /English/)
})

test('invalid fields and failing getters produce bounded errors without disclosing config', () => {
  const invalidInputs = {
    outputLanguage: ['zh', 'EN', null, false, { get: () => 'secret-language' }],
    responseStyle: ['', 'long', 1, null],
    deduplicateReads: ['true', 1, null, {}],
    efficiencyGuidance: ['false', 0, null],
    expandTokenDetails: ['yes', null, []],
    methodGuidance: ['yes', null], targetedVerification: [0, null], benefitBasedParallelism: ['false', []],
    automationEnabled: [0, null], automationVerification: ['yes', null],
    automationParallelism: ['yes',null], automationBudgetCny: ['3',null,-1,4,NaN],
  }
  for (const [field, values] of Object.entries(invalidInputs)) {
    for (const value of values) {
      assert.throws(() => resolvePreferences({ [field]: value, prices: 'private-token' }), {
        name: 'TypeError', message: `NEXT preference "${field}" is invalid.`,
      })
    }
  }
  assert.throws(() => resolvePreferences({ outputLanguage: { get() { throw new Error('secret credential') } } }), {
    name: 'TypeError', message: 'NEXT preference "outputLanguage" is invalid.',
  })
  const getterFailure = {}
  Object.defineProperty(getterFailure, 'responseStyle', { get() { throw new Error('secret config') } })
  assert.throws(() => resolvePreferences(getterFailure), { message: 'NEXT preference "responseStyle" is invalid.' })
  for (const input of [null, [], 'settings', true, 42]) assert.throws(() => resolvePreferences(input), TypeError)
})

test('balanced guidance is opt-in and each clause can be switched independently', () => {
  assert.equal(executionGuidance(), '')
  assert.equal(executionGuidance({ methodGuidance: true, targetedVerification: true, benefitBasedParallelism: true }), '')
  const all = executionGuidance({ efficiencyGuidance: true })
  assert.match(all, /Answer simple questions directly/)
  assert.match(all, /do not routinely preload a framework/)
  assert.match(all, /inputs, checker and environment remain valid/)
  assert.match(all, /Missing verification is unknown/)
  assert.match(all, /independent work with a clear benefit/)
  const off = executionGuidance({ efficiencyGuidance: true, methodGuidance: false, targetedVerification: false, benefitBasedParallelism: false })
  assert.doesNotMatch(off, /SOPs|prior verification|Delegate/)
  assert.match(off, /necessary acceptance checks/)
  assert.match(off, /user-selected model and reasoning effort/)
  for (const [field, clause] of [['methodGuidance', /SOPs/], ['targetedVerification', /prior verification/], ['benefitBasedParallelism', /Delegate/]]) {
    assert.doesNotMatch(executionGuidance({ efficiencyGuidance: true, [field]: false }), clause)
  }
})

test('guidance reads live switches without a second prompt or model classifier', () => {
  const switchValue = { value: true, get() { return this.value } }
  const settings = { efficiencyGuidance: switchValue, methodGuidance: { get: () => false } }
  assert.doesNotMatch(executionGuidance(settings), /SOPs/)
  switchValue.value = false
  assert.equal(executionGuidance(settings), '')
})

test('all guidance combinations preserve their gates and acceptance constraints', () => {
  for (let mask = 0; mask < 16; mask++) {
    const settings = Object.fromEntries(['efficiencyGuidance', 'methodGuidance', 'targetedVerification', 'benefitBasedParallelism'].map((key, index) => [key, Boolean(mask & (1 << index))]))
    const prompt = executionGuidance(settings)
    if (!settings.efficiencyGuidance) { assert.equal(prompt, ''); continue }
    assert.equal(/SOPs/.test(prompt), settings.methodGuidance)
    assert.equal(/prior verification/.test(prompt), settings.targetedVerification)
    assert.equal(/Delegate/.test(prompt), settings.benefitBasedParallelism)
    assert.match(prompt, /required outcomes.*necessary acceptance checks/)
    assert.match(prompt, /user-selected model and reasoning effort/)
    if (settings.targetedVerification) assert.match(prompt, /Never infer validity from an old exit code alone or claim unperformed checks/)
  }
})

test('default language and response style add no prompt regardless of optimization settings', () => {
  assert.equal(preferencePrompt(), '')
  assert.equal(preferencePrompt({}), '')
  assert.equal(preferencePrompt({ efficiencyGuidance: true, deduplicateReads: false, expandTokenDetails: true }), '')
})

test('every supported language preserves source material and gives user requests precedence', () => {
  for (const [outputLanguage, expected] of [
    ['zh-CN', 'Simplified Chinese'], ['zh-TW', 'Traditional Chinese'], ['en', 'English'],
    ['ja', 'Japanese'], ['ko', 'Korean'],
  ]) {
    const prompt = preferencePrompt({ outputLanguage })
    assert.ok(prompt.includes(expected))
    assert.match(prompt, /natural-language replies only/)
    assert.match(prompt, /preserve code, identifiers, and verbatim quotations/)
    assert.match(prompt, /Honor explicit user requests/)
  }
})

test('response style keeps required correctness checks and avoids redundant detail', () => {
  const concise = preferencePrompt({ responseStyle: 'concise' })
  assert.match(concise, /Be concise/)
  assert.match(concise, /acceptance checks, material risks/)
  assert.match(concise, /correctness/)
  assert.match(concise, /Honor explicit user requests/)
  assert.doesNotMatch(concise, /Default to/)
  const detailed = preferencePrompt({ outputLanguage: 'en', responseStyle: 'detailed' })
  assert.match(detailed, /English/)
  assert.match(detailed, /useful detail and explanations without repetition/)
})
