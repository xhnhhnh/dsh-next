import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const settings = ctx => ctx.settings.describe().find(item => item.ns === 'dsh-next')?.value
const command = async (ctx, agent, text) => {
  const result = await ctx.commands.execute(agent, text, [], new AbortController().signal)
  if ((result?.result?.kind ?? result?.kind) !== 'success') throw new Error(`Production smoke command failed: ${text}`)
}
const tool = (ctx, agent, name, args) => ctx.tools.execute({ agent, name, callId: randomUUID(), arguments: args, signal: new AbortController().signal })
const service = ctx => ctx.get('nextProduction')
const productionFile = job => join(job.output, 'production-native.json')

/** Native local commands/artifact checks and policy paths. Inference remains forbidden by the parent driver. */
export async function runProductionSmoke(ctx, { job, check, agentEvents }) {
  const original = structuredClone(settings(ctx)), workspace = join(job.workspace, 'production-project')
  mkdirSync(workspace, { recursive: true })
  const packageText = JSON.stringify({ name: 'next-production-smoke', private: true, scripts: { check: 'node verify.mjs', build: 'node verify.mjs', dev: 'never-run' } }, null, 2)
  writeFileSync(join(workspace, 'package.json'), packageText)
  writeFileSync(join(workspace, 'verify.mjs'), "import {readFileSync} from 'node:fs'; if(readFileSync('value.txt','utf8').trim()!=='good')process.exit(2); console.log('fixture passed');\n")
  writeFileSync(join(workspace, 'value.txt'), 'good\n')
  writeFileSync(join(workspace, 'data.csv'), '\uFEFFname,count\n"A, B",2\n')
  writeFileSync(join(workspace, 'result.md'), '# Result\n\nChecked fixture.\n')
  writeFileSync(join(workspace, 'result.json'), '{"count":2}\n')
  const { sessionId } = await ctx.sessionController.create({ cwd: workspace }), agent = ctx.agents.get(sessionId)
  await command(ctx, agent, '/next on')
  check('production-native-service-present', Boolean(service(ctx)?.inspect && service(ctx)?.scan))
  const scan = await service(ctx).scan({ sessionId })
  check('production-scan-real-script-candidates', scan.candidates.length === 2 && scan.candidates.some(candidate => candidate.id === 'project-check') && scan.candidates.every(candidate => !/dev/.test(candidate.id)))
  check('production-scan-real-binding-hashes', scan.bindings.length === 1 && scan.bindings[0].file === 'package.json' && /^[a-f0-9]{64}$/.test(scan.bindings[0].sha256))
  let projectCommand = { ...scan.candidates.find(candidate => candidate.id === 'project-check').check, id: 'production-command', timeoutMs: 30000 }
  const artifacts = [
    { id: 'production-csv', workspace, kind: 'artifact', file: 'data.csv', format: 'csv', requiredColumns: ['name', 'count'] },
    { id: 'production-markdown', workspace, kind: 'artifact', file: 'result.md', format: 'markdown', requiredText: ['# Result', 'Checked fixture.'] },
    { id: 'production-json', workspace, kind: 'artifact', file: 'result.json', format: 'json' },
  ]
  const register = async () => ctx.settings.update('dsh-next', { verificationChecks: [...original.verificationChecks, projectCommand, ...artifacts] })
  await register()
  let capability = await service(ctx).inspect({ sessionId })
  check('production-capabilities-project-checks-ready', capability.capabilities.verification.status === 'ready' && capability.checks.filter(item => item.id.startsWith('production-')).every(item => item.status === 'ready'))
  check('production-capability-projection-published', ctx.sessionProjections.snapshot(agent.session).values.nextCapabilities.sessionId === sessionId)
  const run = async id => {
    const result = await tool(ctx, agent, 'next_verify', { check_id: id })
    check(`production-receipt-native-schema-${id}`, result.isError === false, { error: result.isError ? result.content : undefined })
    return result.value
  }
  check('production-command-native-success', (await run(projectCommand.id)).status === 'executed')
  check('production-command-does-not-cache', (await run(projectCommand.id)).status === 'executed')
  for (const artifact of artifacts) check(`production-artifact-success-${artifact.format}`, (await run(artifact.id)).passed === true)
  writeFileSync(join(workspace, 'value.txt'), 'bad\n')
  check('production-command-real-failure', (await run(projectCommand.id)).status === 'failed')
  writeFileSync(join(workspace, 'value.txt'), 'good\n')
  writeFileSync(join(workspace, 'package.json'), packageText + ' ')
  check('production-command-script-binding-expired', (await run(projectCommand.id)).status === 'expired')
  const refreshed = await service(ctx).scan({ sessionId })
  projectCommand = { ...refreshed.candidates.find(candidate => candidate.id === 'project-check').check, id: projectCommand.id, timeoutMs: 30000 }
  await register()
  await service(ctx).inspect({ sessionId })
  check('production-command-reregistration-restores-execution', (await run(projectCommand.id)).status === 'executed')
  writeFileSync(join(workspace, 'package-lock.json'), '{"lockfileVersion":3}\n')
  check('production-command-new-lock-binding-expired', (await run(projectCommand.id)).status === 'expired')
  const rescan = await service(ctx).scan({ sessionId })
  projectCommand = { ...rescan.candidates.find(candidate => candidate.id === 'project-check').check, id: projectCommand.id, timeoutMs: 30000 }
  await register(); await service(ctx).inspect({ sessionId })
  check('production-command-lock-reregistration-restores', (await run(projectCommand.id)).status === 'executed')
  const removeGuard = agent.ctx.tools.guard(exec => ['pwsh', 'bash'].includes(exec.name) ? 'Production smoke rejects command through current native policy.' : undefined)
  try { check('production-command-native-policy-denial-unknown', (await run(projectCommand.id)).status === 'unknown') }
  finally { removeGuard() }
  check('production-command-policy-restoration-executes', (await run(projectCommand.id)).status === 'executed')
  const write = await tool(ctx, agent, 'write', { file_path: join(workspace, 'value.txt'), content: 'good\n' })
  check('production-command-native-edit-succeeded', write.isError === false)
  const audit = ctx.sessionProjections.snapshot(agent.session).values.nextAutomation.verification
  check('production-later-source-edit-expires-durable-receipt', audit.last.some(item => item.checkId === projectCommand.id && item.status === 'expired'))
  await service(ctx).inspect({ sessionId })
  const entered = await agentEvents(ctx, agent).waterfall('agent/pre-step', { turn: 1001, step: 1, signal: new AbortController().signal, messages: [] }, async () => ({ kind: 'enter', messages: [] }))
  check('production-coalesced-edit-produces-proof-notice', entered.messages.some(message => JSON.stringify(message).includes('NEXT automatic project verification')))
  await command(ctx, agent, '/next off')
  await service(ctx).inspect({ sessionId })
  check('production-off-hides-both-tools', agent.ctx.tools.schemas(agent).every(item => !['next_verify', 'next_parallel'].includes(item.name)))
  const countBeforeOff = ctx.sessionProjections.snapshot(agent.session).values.nextAutomation.verification.executed
  await tool(ctx, agent, 'write', { file_path: join(workspace, 'value.txt'), content: 'good\n' })
  await agentEvents(ctx, agent).waterfall('agent/pre-step', { turn: 1001, step: 2, signal: new AbortController().signal, messages: [] }, async () => ({ kind: 'enter', messages: [] }))
  check('production-off-no-automatic-execution', ctx.sessionProjections.snapshot(agent.session).values.nextAutomation.verification.executed === countBeforeOff)
  await command(ctx, agent, '/next on')
  const route = (await agent.ctx.systemPrompt.assemble({ agent })).variables
  await ctx.settings.update('dsh-next', { prices: [], automationPricesValidUntil: new Date(Date.now() + 60000).toISOString() })
  capability = await service(ctx).inspect({ sessionId })
  check('production-missing-price-hides-parallel', capability.capabilities.parallel.status !== 'ready' && !agent.ctx.tools.schemas(agent).some(item => item.name === 'next_parallel'))
  await ctx.settings.update('dsh-next', { prices: [{ provider: route.provider, model: route.model, input: 0.1, cacheRead: 0.1, cacheWrite: 0.1, output: 0.1 }], automationPricesValidUntil: new Date(Date.now() - 1000).toISOString() })
  capability = await service(ctx).inspect({ sessionId })
  check('production-expired-price-hides-parallel', capability.capabilities.parallel.status !== 'ready' && !agent.ctx.tools.schemas(agent).some(item => item.name === 'next_parallel'))
  await ctx.settings.update('dsh-next', { prices: original.prices, automationPricesValidUntil: original.automationPricesValidUntil })
  await service(ctx).inspect({ sessionId })
  await ctx.sessions.flush(agent.session)
  writeFileSync(productionFile(job), JSON.stringify({ status: 'Pass', sessionId, workspace, checkIds: [projectCommand.id, ...artifacts.map(item => item.id)], bindings: projectCommand.bindings,
    nativeCommands: true, providersContacted: false, modelCalls: 0, capability: ctx.sessionProjections.snapshot(agent.session).values.nextCapabilities }, null, 2))
}

export async function resumeProductionSmoke(ctx, { job, check }) {
  const saved = JSON.parse(readFileSync(productionFile(job), 'utf8')), preset = (await ctx.agentPresets.resolve()).id
  const handle = await ctx.agents.resume({ resumeSessionId: saved.sessionId, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) } }), agent = handle.agent
  const registered = settings(ctx).verificationChecks
  check('production-cold-registrations-persisted', saved.checkIds.every(id => registered.some(item => item.id === id)))
  const view = ctx.sessionProjections.snapshot(agent.session).values.nextCapabilities
  check('production-cold-capability-projection-restored', view.sessionId === saved.sessionId && view.checks.some(item => item.id === 'production-command'))
  const inspected = await service(ctx).inspect({ sessionId: saved.sessionId })
  check('production-cold-command-bindings-ready', inspected.checks.find(item => item.id === 'production-command')?.status === 'ready')
  const result = await tool(ctx, agent, 'next_verify', { check_id: 'production-command' })
  check('production-cold-command-executes-again', result.isError === false && result.value.status === 'executed')
  for (const id of saved.checkIds.filter(id => id !== 'production-command')) {
    const artifact = await tool(ctx, agent, 'next_verify', { check_id: id })
    check(`production-cold-artifact-executes-${id}`, artifact.isError === false && artifact.value.status === 'executed')
  }
  await ctx.sessions.flush(agent.session)
  await handle.dispose()
}
