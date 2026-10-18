// Loaded by the installed desktop-host CLI's real plugin Loader in an isolated profile.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export const name = 'next-native-smoke';
export const inject = ['sessionController', 'agents', 'commands', 'sessions', 'sessionProjections', 'tools', 'fs', 'settings', 'systemPrompt', 'goals','agentPresets','subagents','llm'];

export function apply(ctx) {
  let blockedModelCalls = 0;
  let mockModelStream = false;
  let parallelModelStream;
  ctx.on('llm/stream', (options) => {
    if (parallelModelStream) return parallelModelStream(options);
    if (mockModelStream) return (async function* () {
      yield { type:'usage',usage:{ inputTokens:123,cacheReadTokens:20,cacheWriteTokens:0,outputTokens:8,totalTokens:151 } };
      yield { type:'usage',usage:{ inputTokens:123,cacheReadTokens:20,cacheWriteTokens:0,outputTokens:10,totalTokens:153 } };
      yield { type:'finish',reason:{kind:'stop'} };
    })();
    blockedModelCalls++;
    throw new Error('NEXT native smoke forbids all model calls');
  }, { global: true });
  void Promise.resolve().then(async () => {
    await ctx.get('loader')?.await();
    const job = JSON.parse(readFileSync(process.env.DSH_NEXT_SMOKE_JOB, 'utf8'));
    const started = Date.now();
    const checks = [];
    let agent;
    const capture = (value) => appendFileSync(join(job.output, 'driver.jsonl'), `${JSON.stringify(value)}\n`);
    const check = (name, pass, evidence = {}) => {
      const record = { name, status: pass ? 'Pass' : 'Fail', ...evidence };
      checks.push(record); capture(record);
      if (!pass) throw new Error(`Check failed: ${name}`);
    };
    try {
      const sessionModule = await import(pathToFileURL(join(job.runtime, '@deepseek-ai/dsh-session/lib/index.js')).href);
      const llm = await import(pathToFileURL(join(job.runtime, '@deepseek-ai/dsh-llm/lib/index.js')).href);
      const { agentEvents } = await import(pathToFileURL(join(job.runtime, '@deepseek-ai/dsh-agent/lib/index.js')).href);
      if(job.resumeOnly) {
        const preset=(await ctx.agentPresets.resolve()).id;
        const handle=await ctx.agents.resume({resumeSessionId:job.sessionId,setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,preset)}});
        agent=handle.agent;
        check('cold-host-resume-switch',ctx.sessionProjections.stateOf(agent.session,'next').active===true);
        check('cold-host-resume-metrics',ctx.sessionProjections.stateOf(agent.session,'nextMetrics').view.calls===(job.expectedCalls??1));
        const saved = ctx.settings.describe().find(item => item.ns === 'dsh-next');
        check('cold-host-resume-preferences', saved?.value?.outputLanguage === 'en' && saved.value.responseStyle === 'concise' && saved.value.expandTokenDetails === true);
        check('cold-host-resume-guidance-options', saved.value.methodGuidance === false && saved.value.targetedVerification === true && saved.value.benefitBasedParallelism === false && saved.value.efficiencyGuidance === false);
        const assembly = await agent.ctx.systemPrompt.assemble({ agent });
        check('cold-host-language-prompt', assembly.sections.some(section => section.name === 'next:preferences' && /English/.test(section.text)));
        if(job.automation) {
          const audit=ctx.sessionProjections.snapshot(agent.session).values.nextAutomation;
          check('cold-host-verification-audit-restored',audit.verification.executed>0&&audit.verification.reused>0&&audit.verification.failed>0&&audit.verification.unknown>0);
          const result=await ctx.tools.execute({agent,name:'next_verify',callId:randomUUID(),arguments:{check_id:'json-config'},signal:new AbortController().signal});
          check('cold-host-verification-cache-invalidated',result.isError===false&&result.value.status==='executed',{result});
          check('cold-host-automation-settings-restored',saved.value.automationEnabled===true&&saved.value.automationVerification===true);
          if(job.parallel)check('cold-host-parallel-settings-restored',saved.value.automationParallelism===true&&saved.value.automationBudgetCny===3);
        }
        if(job.parallel) {
          const budget=ctx.sessionProjections.stateOf(agent.session,'nextAutomation').budget;
          check('cold-host-parallel-budget-restored',budget.spentCnyExact===job.expectedBudget.spentCnyExact&&JSON.stringify(budget.reservations)===JSON.stringify(job.expectedBudget.reservations));
          const childId=job.expectedBudget.children[0];
          const childHandle=await ctx.agents.resume({resumeSessionId:childId,setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,preset)}});
          check('cold-host-owned-child-marker-restored',ctx.sessionProjections.stateOf(childHandle.agent.session,'nextAutomation').ownerRootId===agent.id);
          let denied=false;
          try { for await(const _chunk of ctx.waterfall('llm/stream',{sessionId:childId,provider:'deepseek-official',model:'deepseek-flash',signal:new AbortController().signal},()=>{blockedModelCalls++;throw new Error('Unexpected unmetered dispatch')})){} } catch(error){denied=/previous NEXT automation child/.test(error.message)}
          check('cold-host-owned-child-resume-blocked',denied);
          await childHandle.dispose();
        }
        if(job.modelPolicies) {
          const { resumeModelPolicySmoke } = await import('./native-model-policy-smoke.mjs');
          await resumeModelPolicySmoke(ctx,{job,check});
        }
        if(job.production) {
          const { resumeProductionSmoke } = await import('./native-production-smoke.mjs');
          await resumeProductionSmoke(ctx,{job,check});
        }
        check('cold-host-no-model-calls',blockedModelCalls===0);
        writeFileSync(join(job.output,'driver-result.json'),JSON.stringify({status:'Pass',checks,sessionId:agent.id,elapsedMs:Date.now()-started},null,2));
        process.exit(0);
      }
      const created = await ctx.sessionController.create({ cwd: job.workspace,...job.adaptive?{agentPreset:'adaptive'}:{} });
      agent = ctx.agents.get(created.sessionId);
      check('native-session-created', Boolean(agent), { sessionId: created.sessionId });
      check('shared-native-session-module', agent.session instanceof sessionModule.Session);
      const projection = () => ctx.sessionProjections.snapshot(agent.session).values;
      const settings = () => ({ options: agent.options, modelSelections: agent.session.snapshotEvents().filter((event) => event.type === 'model/selection').map((event) => event.data) });
      const before = JSON.stringify(settings());
      check('new-session-default-off', projection().next?.active === false, { projection: projection().next });
      const signal = new AbortController().signal;
      const command = async (text) => {
        const result = await ctx.commands.execute(agent, text, [], signal);
        capture({ type: 'command', text, result, next: projection().next });
        check(text, result?.result?.kind === 'success' || result?.kind === 'success');
        return result;
      };
      await command('/next on');
      if(job.adaptive) {
        await command('/adaptive-max on');
        await command('/next off');await command('/next on');
        check('adaptive-max-remains-independent',ctx.sessionProjections.stateOf(agent.session,'adaptiveMax').active===true);
      }
      check('on-projection', projection().next?.active === true);
      const form = () => ctx.settings.describe().find(item => item.ns === 'dsh-next');
      check('native-settings-form-ready', form()?.value?.outputLanguage === 'auto' && form().autoGenerate === false);
      check('balanced-defaults-master-off', form().value.efficiencyGuidance === false && ['methodGuidance','targetedVerification','benefitBasedParallelism'].every(key => form().value[key] === true));
      await ctx.settings.update('dsh-next', { outputLanguage: 'en', responseStyle: 'concise', expandTokenDetails: true });
      const preferences = form();
      check('native-settings-live-save', preferences.value.outputLanguage === 'en' && preferences.value.responseStyle === 'concise' && preferences.value.expandTokenDetails === true);
      const prompt = () => agent.ctx.systemPrompt.assemble({ agent });
      let assembly = await prompt();
      check('native-language-preference-prompt', assembly.sections.some(section => section.name === 'next:preferences' && /English/.test(section.text) && /acceptance checks/.test(section.text)));
      const guidance = () => prompt().then(value => value.sections.filter(section => section.name === 'next:efficiency' && section.text.length > 0));
      check('guidance-default-no-content', (await guidance()).length === 0);
      await ctx.settings.update('dsh-next', { efficiencyGuidance: true });
      let advice = await guidance();
      check('guidance-single-section', advice.length === 1 && /SOPs/.test(advice[0].text) && /prior verification/.test(advice[0].text) && /Delegate/.test(advice[0].text));
      await ctx.settings.update('dsh-next', { methodGuidance: false, benefitBasedParallelism: false });
      advice = await guidance();
      check('guidance-independent-clauses', advice.length === 1 && !/SOPs|Delegate/.test(advice[0].text) && /prior verification/.test(advice[0].text));
      await ctx.settings.update('dsh-next', { targetedVerification: false });
      check('guidance-verification-switch', !/prior verification/.test((await guidance())[0].text));
      await ctx.settings.update('dsh-next', { targetedVerification: true, efficiencyGuidance: false });
      check('guidance-master-off-preserves-options', (await guidance()).length === 0 && form().value.methodGuidance === false && form().value.targetedVerification === true);
      const preferenceKeys = ['outputLanguage','responseStyle','deduplicateReads','efficiencyGuidance','expandTokenDetails','methodGuidance','targetedVerification','benefitBasedParallelism',...job.automation?['automationEnabled','automationVerification']:[],...job.parallel?['automationParallelism','automationBudgetCny']:[]];
      const retainedPreferences = Object.fromEntries(preferenceKeys.map(key => [key, form().value[key]]));
      const retainedPrices = structuredClone(form().value.prices);
      if(job.parallel)await ctx.settings.update('dsh-next',{automationParallelism:false,automationBudgetCny:1});
      await ctx.settings.mutate('dsh-next', preferenceKeys.map(key => ({ op: 'unset', path: [key] })));
      check('reset-eight-preferences-defaults', form().value.efficiencyGuidance === false && form().value.outputLanguage === 'auto' && form().value.responseStyle === 'standard' && ['methodGuidance','targetedVerification','benefitBasedParallelism','deduplicateReads'].every(key => form().value[key] === true));
      check('reset-preferences-preserves-price-configuration', JSON.stringify(form().value.prices) === JSON.stringify(retainedPrices));
      if(job.automation)check('reset-automation-defaults',form().value.automationEnabled===true&&form().value.automationVerification===true);
      if(job.parallel)check('reset-parallel-and-budget-defaults',form().value.automationParallelism===true&&form().value.automationBudgetCny===3&&preferenceKeys.length===12);
      await ctx.settings.update('dsh-next', retainedPreferences);
      await command('/plan');
      await ctx.settings.update('dsh-next', { efficiencyGuidance: true });
      await command('/next off'); await command('/next on');
      check('plan-boundary-preserved', projection().plan?.active === true && (await guidance()).length === 1);
      await command('/plan off');
      const goalService = ctx.goals;
      check('native-goal-service-available', Boolean(goalService));
      const goalView = goalService.create(agent, { objective: 'Offline NEXT coexistence fixture', maxGoalRounds: 1 });
      await command('/next off'); await command('/next on');
      check('goal-boundary-preserved', goalService.get(agent).phase === 'active' && (await guidance()).length === 1);
      goalService.clear(agent, { id: goalView.id, revision: goalView.revision });
      await ctx.settings.update('dsh-next', { efficiencyGuidance: false });
      await ctx.settings.update('dsh-next', { deduplicateReads: false });
      check('native-dedup-setting-live', form().value.deduplicateReads === false);
      await ctx.settings.update('dsh-next', { deduplicateReads: true });
      await command('/next status');
      await command('/next off');
      check('off-projection', projection().next?.active === false);
      assembly = await prompt();
      check('native-language-preference-off', !assembly.sections.some(section => section.name === 'next:preferences' && section.text.length > 0));
      await command('/next on');

      const reads = [];
      let turnNumber=0;
      const closeTurn=async()=>{
        if(ctx.sessionProjections.stateOf(agent.session,'turnBoundary').openTurnStartSeq!==null) {
          await agentEvents(ctx,agent).serial('agent/turn-stopping',{turn:turnNumber,signal});
          agent.session.append('turn/end',{turn:turnNumber,reason:{kind:'completed'}});
        }
      };
      async function read() {
        await closeTurn();
        const callId = randomUUID();
        const args = { file_path: join(job.workspace, 'fixture.txt'), offset: 1, limit: 120 };
        const result = await ctx.tools.execute({ agent, name: 'read', callId, arguments: args, signal });
        check(`native-read-${reads.length + 1}`, result.isError !== true && result.value?.lines?.length === 120, { isError: result.isError, text: result.isError ? result.content : undefined });
        // Native tool pipeline is real; the driver supplies its usual persisted loop envelope without a model call.
        const turn = ++turnNumber;
        agent.session.append('turn/start', { turn });
        agent.session.append('step/start', { turn, step: 1 });
        agent.session.append('assistant/message', { turn, step: 1, stream: [], message: llm.createMessage({ role: 'assistant', content: [{ type: 'tool-call', id: callId, name: 'read', arguments: JSON.stringify(args) }], source: { kind: 'model', provider: 'smoke-fixture', model: 'no-model-called' } }) }, { surfaceOp: 'append' });
        agent.session.append('tool/call', { turn, step: 1, callId, name: 'read', arguments: JSON.stringify(args) });
        const event = agent.session.append('tool/result', { turn, step: 1, message: llm.createToolResultMessage({ callId, content: result.content, isError: result.isError === true }) }, { surfaceOp: 'append' });
        agent.session.append('step/end', { turn, step: 1 });
        agent.session.append('turn/end', { turn, reason: { kind: 'completed' } });
        reads.push({ event, value: result.value, content: result.content });
        return result;
      }
      await read();
      await read();
      check('native-read-program-values-intact', JSON.stringify(reads[0].value) === JSON.stringify(reads[1].value));
      const config = { provider: 'smoke-fixture', model: 'no-model-called', reasoningEffort: 'high', temperature: 0.25, maxTokens: 8192 };
      const prepareRequest = async () => {
        if(ctx.sessionProjections.stateOf(agent.session,'turnBoundary').openTurnStartSeq===null)agent.session.append('turn/start',{turn:++turnNumber});
        const result = await agentEvents(ctx, agent).waterfall('agent/request', { turn: 4, step: 1, signal }, async () => ({ ...config }));
        check('request-model-settings-preserved', JSON.stringify(result) === JSON.stringify(config), { result });
      };
      await prepareRequest();
      const readSurface = () => agent.session.surface.nodes.map((seq) => agent.session.eventAt(seq)).filter((event) => event.type === 'tool/result');
      const references = () => readSurface().filter((event) => event.data.message.content?.[0]?.text?.startsWith('[NEXT_READ_REF'));
      check('duplicate-shortened-on-native-surface', references().length === 1, { toolResults: readSurface().map((event) => ({ seq: event.seq, chars: JSON.stringify(event.data.message.content).length })) });
      const reference = references()[0];
      const source = readSurface().find((event) => event.seq !== reference.seq);
      // Reproduce compaction's native surface replacement without any summarizer/model invocation.
      agent.session.append('user/message', llm.createMessage({ role: 'user', content: [{ type: 'text', text: 'Offline compaction checkpoint fixture.' }], source: { kind: 'user' } }), {
        surfaceOp: { op: 'replace', startSeq: source.seq, endSeq: source.seq }, sourceEventSeqs: [source.seq],
      });
      await prepareRequest();
      check('reference-restored-when-source-removed', references().length === 0 && readSurface().some((event) => JSON.stringify(event.data.message.content) === JSON.stringify(reads[1].content)), { surface: readSurface().map((event) => ({ seq: event.seq, chars: JSON.stringify(event.data.message.content).length, ref: event.data.message.content?.[0]?.text?.slice(0, 250) })), expectedChars: JSON.stringify(reads[1].content).length });
      writeFileSync(join(job.workspace, 'fixture.txt'), job.fixture.replace('Line 1:', 'Edited 1:'));
      await read();
      check('native-read-observes-change', reads[2].value.lines[0].text.startsWith('Edited 1:'));
      await closeTurn();
      const child = await ctx.agents.create({sessionId:`next-smoke-child-${randomUUID()}`,parentAgent:agent,meta:{cwd:job.workspace,parentSession:agent.id,origin:'subagent',delegationDepth:1}});
      check('child-inherits-parent-on',ctx.sessionProjections.stateOf(child.agent.session,'next').active===true);
      await command('/next off');
      await new Promise(resolve=>setTimeout(resolve,0));
      check('child-follows-parent-off',ctx.sessionProjections.stateOf(child.agent.session,'next').active===false);
      await command('/next on');
      await new Promise(resolve=>setTimeout(resolve,0));
      mockModelStream=true;
      const stream=ctx.waterfall('llm/stream',{provider:'smoke-fixture',model:'no-model-called',sessionId:child.agent.id,purpose:'compaction',signal},()=>{throw new Error('No outbound call allowed')});
      for await(const _chunk of stream) {}
      mockModelStream=false;
      check('meter-persists-once-in-parent-and-child',projection().nextMetrics.calls===1&&ctx.sessionProjections.stateOf(child.agent.session,'nextMetrics').view.calls===1,{parent:projection().nextMetrics});
      check('meter-final-usage-not-double-counted',projection().nextMetrics.inputTokens===123&&projection().nextMetrics.outputTokens===10);
      check('meter-unknown-price-not-zero',projection().nextMetrics.costCny===null);
      const restored=sessionModule.Session.create(agent.id,agent.session.snapshotEvents(),agent.session.header);
      check('switch-and-metrics-replay',ctx.sessionProjections.stateOf(restored,'next').active===true&&ctx.sessionProjections.stateOf(restored,'nextMetrics').view.calls===1);
      await child.dispose();
      check('model-settings-unchanged', JSON.stringify(settings()) === before, { settings: settings() });
      if(job.automation) {
        const { runAutomationSmoke } = await import('./native-automation-smoke.mjs');
        await runAutomationSmoke(ctx,{job,agent,check,agentEvents,command});
      }
      if(job.parallel) {
        const { runParallelSmoke } = await import('./native-parallel-smoke.mjs');
        await runParallelSmoke(ctx,{job,agent,check,setModelResponder:responder=>{parallelModelStream=responder}});
      }
      if(job.switches) {
        const {runSwitchSmoke}=await import('./native-switch-smoke.mjs');
        await runSwitchSmoke(ctx,{job,check,agentEvents,setModelResponder:responder=>{parallelModelStream=responder}});
      }
      if(job.modelPolicies) {
        const { runModelPolicySmoke } = await import('./native-model-policy-smoke.mjs');
        await runModelPolicySmoke(ctx,{job,check,agentEvents});
      }
      if(job.production) {
        const { runProductionSmoke } = await import('./native-production-smoke.mjs');
        await runProductionSmoke(ctx,{job,check,agentEvents});
      }
      check('no-model-calls', blockedModelCalls === 0, { blockedModelCalls });
      await ctx.sessions.flush(agent.session);
      writeFileSync(join(job.output, 'session-events.jsonl'), agent.session.snapshotEvents().map((event) => JSON.stringify(event)).join('\n') + '\n');
      writeFileSync(join(job.output, 'projection.json'), JSON.stringify(projection(), null, 2));
      const report = { schemaVersion: 1, status: 'Pass', sessionId:agent.id, elapsedMs: Date.now() - started, checks, blockedModelCalls,
        limitations: ['Native tools execute without paid models; the driver supplies the normal persisted tool envelope.', 'Compaction uses a native surface replacement fixture; no paid summarizer runs.', 'Meter integration uses synthetic usage chunks through the real llm waterfall, not a live provider.'] };
      writeFileSync(join(job.output, 'driver-result.json'), JSON.stringify(report, null, 2));
      process.exit(0);
    } catch (error) {
      if (agent) {
        writeFileSync(join(job.output, 'session-events.jsonl'), agent.session.snapshotEvents().map((event) => JSON.stringify(event)).join('\n') + '\n');
        writeFileSync(join(job.output, 'surface.json'), JSON.stringify(agent.session.surface, null, 2));
      }
      writeFileSync(join(job.output, 'driver-result.json'), JSON.stringify({ schemaVersion: 1, status: 'Fail', elapsedMs: Date.now() - started, checks, blockedModelCalls, error: String(error), stack: error?.stack }, null, 2));
      process.exit(1);
    }
  }).catch((error) => { console.error('NEXT native smoke failed:', error); process.exit(1); });
}
