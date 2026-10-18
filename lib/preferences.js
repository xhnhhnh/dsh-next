/** Session-independent defaults; profile settings may override each known field. */
export const DEFAULT_PREFERENCES = Object.freeze({
  outputLanguage: 'auto',
  responseStyle: 'standard',
  deduplicateReads: true,
  efficiencyGuidance: false,
  methodGuidance: true,
  targetedVerification: true,
  benefitBasedParallelism: true,
  expandTokenDetails: false,
  automationEnabled: true,
  automationVerification: true,
  automationParallelism: true,
  automationBudgetCny: 3,
})

const languages = new Set(['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko'])
const styles = new Set(['standard', 'concise', 'detailed'])
const languageNames = Object.freeze({
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
})

function invalid(field) {
  // Do not stringify input: the same config object can contain credential or price settings.
  return new TypeError(`NEXT preference "${field}" is invalid.`)
}

/** Read only known fields, accepting ordinary values or host Volatile values. */
export function resolvePreferences(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('NEXT preferences must be a settings object.')
  }
  const result = {}
  for (const field of Object.keys(DEFAULT_PREFERENCES)) {
    let value
    try {
      value = input[field]
      if (value !== null && typeof value === 'object' && typeof value.get === 'function') value = value.get()
    } catch {
      throw invalid(field)
    }
    if (value === undefined) value = DEFAULT_PREFERENCES[field]
    const valid = field === 'outputLanguage' ? languages.has(value)
      : field === 'responseStyle' ? styles.has(value)
        : field === 'automationBudgetCny' ? typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3
        : typeof value === 'boolean'
    if (!valid) throw invalid(field)
    result[field] = value
  }
  return result
}

/** Optional response defaults; explicit user instructions always take precedence. */
export function preferencePrompt(settings) {
  const { outputLanguage, responseStyle } = resolvePreferences(settings)
  if (outputLanguage === 'auto' && responseStyle === 'standard') return ''
  const instructions = ['Honor explicit user requests over these response defaults.']
  if (outputLanguage !== 'auto') {
    instructions.push(`Default to ${languageNames[outputLanguage]} for natural-language replies only; preserve code, identifiers, and verbatim quotations.`)
  }
  if (responseStyle === 'concise') {
    instructions.push('Be concise while retaining necessary acceptance checks, material risks, and details needed for correctness.')
  } else if (responseStyle === 'detailed') {
    instructions.push('Provide useful detail and explanations without repetition.')
  }
  return instructions.join(' ')
}

/** Balanced execution advice; each optional clause is controlled independently.
 * These are instructions, never proof that a check was run or may be skipped.
 */
export function executionGuidance(settings) {
  const preferences = resolvePreferences(settings)
  if (!preferences.efficiencyGuidance) return ''
  const parts = ['NEXT is enabled. Answer simple questions directly; locate before reading and avoid repeating unchanged work. Preserve required outcomes, existing planning and compaction, necessary acceptance checks, and the user-selected model and reasoning effort.']
  if (preferences.methodGuidance) parts.push('Consult SOPs, playbooks or task methods only for a concrete need; do not routinely preload a framework.')
  if (preferences.targetedVerification) parts.push('Verify affected behavior. Reuse prior verification only while its inputs, checker and environment remain valid; changes, failures or coverage gaps require fresh checks. Missing verification is unknown, not a failed check. Never infer validity from an old exit code alone or claim unperformed checks passed.')
  if (preferences.benefitBasedParallelism) parts.push('Delegate only independent work with a clear benefit; reuse host scheduling and avoid duplicate work or extra planning and review loops.')
  return parts.join(' ')
}
