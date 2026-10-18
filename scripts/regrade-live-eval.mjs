import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subagentReceiptEvidence } from './eval-scoring.mjs'
const work = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const directory = resolve(process.argv[2] ?? '')
const local = relative(work, directory)
if (!local || local === '..' || local.startsWith(`..${sep}`) || resolve(work, local) !== directory) throw new Error('Evaluation directory must be inside work')
const original = readFileSync(join(directory, 'results.json'))
const corrections = []
const results = JSON.parse(original).map(result => {
  if (result.id !== 'subagent' || result.processCompliant) return result
  const raw = readFileSync(join(directory, `subagent-r${result.repeat}-${result.condition}-events.jsonl`))
  const events = raw.toString().trim().split('\n').map(line => JSON.parse(line))
  const evidence = subagentReceiptEvidence(events)
  if (!evidence) return result
  const corrected = { ...result, rawPass: result.pass, rawProcessCompliant: result.processCompliant, processCompliant: true,
    pass: result.error === null && result.completed && result.outcomeCorrect, receiptEvidence: evidence }
  corrections.push({ repeat: result.repeat, condition: result.condition, before: result.pass, after: corrected.pass,
    eventSha256: createHash('sha256').update(raw).digest('hex'), ...evidence })
  return corrected
})
const report = { rulesVersion: 'native-subagent-receipt-v1', originalResultsSha256: createHash('sha256').update(original).digest('hex'),
  reason: 'Use the native completed-child settlement receipt when child snapshots are not available; preserve the same completion and answer criteria.', corrections, results }
writeFileSync(join(directory, 'regraded-results.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ cases: results.length, passed: results.filter(result => result.pass).length, corrections: corrections.length }))
