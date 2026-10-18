import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const routeA = { provider: 'next-smoke-model-a', model: 'same/model', reasoningEffort: 'high' }
const routeB = { provider: 'next-smoke-model-b', model: 'same/model', reasoningEffort: 'high' }
const policyKeys = ['outputLanguage','responseStyle','deduplicateReads','efficiencyGuidance','methodGuidance','targetedVerification','benefitBasedParallelism','expandTokenDetails','automationEnabled','automationVerification','automationParallelism','automationBudgetCny']
const same = isDeepStrictEqual
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function fixtureAdapters(ctx, job) {
  const { LlmAdapter } = await import(pathToFileURL(join(job.runtime,'@deepseek-ai/dsh-llm/lib/index.js')).href)
  class MetadataOnlyAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: provider } }
    listModels(provider) { return Promise.resolve([{ provider, id: 'same/model', name: 'Same model' }]) }
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: 'Same model', context: { contextWindow: 32768 }, defaultMaxTokens: 8192, reasoning: { efforts: [{id:'high',name:'High'}], defaultEffort:'high' } }) }
    async *stream() { throw new Error('Model-policy smoke forbids adapter inference') }
  }
  const registration = ctx.llm.registerAdapter([routeA.provider, routeB.provider], new MetadataOnlyAdapter())
  return registration
}

async function setNext(ctx, agent, active) {
  const result = await ctx.commands.execute(agent, `/next ${active?'on':'off'}`, [], new AbortController().signal)
  if ((result?.result?.kind ?? result?.kind) !== 'success') throw new Error('Model-policy NEXT command failed')
}

const preferenceText = assembly => assembly.sections.find(section=>section.name==='next:preferences')?.text ?? ''
const guidanceText = assembly => assembly.sections.find(section=>section.name==='next:efficiency')?.text ?? ''
const routeOf = assembly => ({provider:assembly.variables.provider,model:assembly.variables.model})
const form = ctx => ctx.settings.describe().find(item=>item.ns==='dsh-next')?.value
const configRef = ctx => [...ctx.get('loader').entries()].find(entry=>entry.options.id==='dsh-next')?.fiber?.config

/** Native Host settings, route selection, scoped assembly and child identity; no streamed inference. */
export async function runModelPolicySmoke(ctx,{job,check,agentEvents}) {
  const removeAdapters = await fixtureAdapters(ctx,job)
  const before = structuredClone(form(ctx))
  await ctx.settings.update('dsh-next',{prices:[...before.prices,...[routeA,routeB].map(route=>({provider:route.provider,model:route.model,input:0.1,cacheRead:0.1,cacheWrite:0.1,output:0.1}))],automationPricesValidUntil:new Date(Date.now()+3600000).toISOString()})
  const defaultBefore = ctx.get('agentDefaultModel').currentSelection()
  const beforeGlobal = Object.fromEntries(policyKeys.map(key=>[key,before[key]]))
  const initialConfig = configRef(ctx), profileHolder = initialConfig?.modelProfiles, tagHolder = initialConfig?.optimizationTags
  const initialProfiles = profileHolder?.get?.(), initialTags = tagHolder?.get?.()
  check('model-native-config-arrays-have-real-volatile-getters',typeof profileHolder?.get==='function'&&typeof tagHolder?.get==='function')
  check('model-native-default-profiles-empty',Array.isArray(initialProfiles)&&initialProfiles.length===0)
  check('model-native-default-tags-available-unassigned',Array.isArray(initialTags)&&initialTags.length===3&&initialTags.every(tag=>Object.keys(tag.preferences).length<12))
  const tags = [
    {id:'smoke-economy',name:'低开销 fixture',preferences:{outputLanguage:'zh-CN',responseStyle:'concise',deduplicateReads:false,efficiencyGuidance:true,automationParallelism:false}},
    {id:'smoke-detail',name:'详细 fixture',preferences:{outputLanguage:'en',responseStyle:'detailed',efficiencyGuidance:false,deduplicateReads:true}},
  ]
  let profiles = [
    {provider:routeA.provider,model:routeA.model,tags:['smoke-economy'],overrides:{}},
    {provider:routeB.provider,model:routeB.model,tags:['smoke-detail'],overrides:{outputLanguage:'ja'}},
  ]
  await ctx.settings.update('dsh-next',{optimizationTags:tags,modelProfiles:profiles})
  check('model-native-partial-overrides-stay-empty',Object.keys(form(ctx).modelProfiles[0].overrides).length===0)
  check('model-native-partial-tag-overrides-not-default-filled',Object.keys(form(ctx).optimizationTags[1].preferences).length===4)
  check('model-native-config-edit-keeps-fiber-and-volatile-holders',configRef(ctx)===initialConfig&&configRef(ctx).modelProfiles===profileHolder&&configRef(ctx).optimizationTags===tagHolder)
  check('model-native-array-edit-replaces-volatile-values',profileHolder.get()!==initialProfiles&&tagHolder.get()!==initialTags&&same(profileHolder.get(),profiles)&&same(tagHolder.get(),tags),{profilesReplaced:profileHolder.get()!==initialProfiles,tagsReplaced:tagHolder.get()!==initialTags,actualProfiles:profileHolder.get(),actualTags:tagHolder.get()})
  const {createModelPreferenceResolver} = await import(new URL('./model-preferences.js',job.nextUrl).href)
  const resolve = createModelPreferenceResolver(initialConfig)
  check('model-native-provider-tuple-isolation',resolve(routeA).outputLanguage==='zh-CN'&&resolve(routeB).outputLanguage==='ja'&&resolve(routeA).automationParallelism===false&&resolve(routeB).responseStyle==='detailed')
  await ctx.settings.mutate('dsh-next',[{op:'set',path:['modelProfiles','0','overrides','outputLanguage'],value:'ko'}])
  check('model-native-nested-edit-replaces-array-and-invalidates-cache',profileHolder.get()!==initialProfiles&&resolve(routeA).outputLanguage==='ko'&&resolve(routeB).outputLanguage==='ja')
  await ctx.settings.mutate('dsh-next',[{op:'unset',path:['modelProfiles','0','overrides','outputLanguage']}])
  check('model-native-remove-model-override-restores-tag',resolve(routeA).outputLanguage==='zh-CN'&&Object.keys(profileHolder.get()[0].overrides).length===0)
  const {sessionId} = await ctx.sessionController.create({cwd:job.workspace})
  const agent = ctx.agents.get(sessionId)
  const assemble = target => target.ctx.systemPrompt.assemble({agent:target,scope:target})
  const signal = new AbortController().signal
  await setNext(ctx,agent,true)
  await ctx.sessionController.selectModel({sessionId,...routeA})
  let assembly = await assemble(agent)
  check('model-native-route-a-policy',same(routeOf(assembly),{provider:routeA.provider,model:routeA.model})&&/Simplified Chinese/.test(preferenceText(assembly))&&guidanceText(assembly).length>0&&!assembly.tools.some(tool=>tool.name==='next_parallel'))
  await ctx.sessionController.selectModel({sessionId,...routeB})
  assembly = await assemble(agent)
  check('model-native-same-model-other-provider-policy',same(routeOf(assembly),{provider:routeB.provider,model:routeB.model})&&/Japanese/.test(preferenceText(assembly))&&/useful detail/.test(preferenceText(assembly))&&guidanceText(assembly)==='')
  await setNext(ctx,agent,false)
  assembly = await assemble(agent)
  check('model-native-off-no-policy-content-or-tools',preferenceText(assembly)===''&&guidanceText(assembly)===''&&!assembly.tools.some(tool=>['next_verify','next_parallel'].includes(tool.name)))
  await setNext(ctx,agent,true)
  await ctx.sessionController.selectModel({sessionId,...routeA})
  const entered=deferred(),release=deferred()
  const removeBlocker=ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
    if(context.agent!==agent)return next()
    entered.resolve();await release.promise;return next()
  },{global:true})
  try {
    const pending=assemble(agent)
    await entered.promise
    await ctx.sessionController.selectModel({sessionId,...routeB})
    release.resolve()
    assembly=await pending
    const request=await agentEvents(ctx,agent).waterfall('agent/request',{turn:999,step:1,signal},()=>Promise.resolve({provider:'seed',model:'seed'}))
    check('model-native-running-switch-keeps-admitted-route-policy',same(routeOf(assembly),{provider:routeA.provider,model:routeA.model})&&/Simplified Chinese/.test(preferenceText(assembly))&&request.provider===routeA.provider&&request.model===routeA.model&&request.reasoningEffort==='high')
  } finally {release.resolve();removeBlocker()}
  assembly=await assemble(agent)
  check('model-native-next-assembly-uses-new-route-policy',assembly.variables.provider===routeB.provider&&/Japanese/.test(preferenceText(assembly)))
  await ctx.sessionController.selectModel({sessionId,...routeA})
  await assemble(agent)
  const child=await ctx.agents.create({sessionId:`next-model-child-${randomUUID()}`,parentAgent:agent,agentOptions:{...routeB,subagentDepth:1},meta:{cwd:job.workspace,parentSession:sessionId,origin:'subagent',delegationDepth:1}})
  try {
    const childAssembly=await assemble(child.agent)
    check('model-native-child-inherits-next-with-own-route-policy',ctx.sessionProjections.stateOf(child.agent.session,'next').active===true&&childAssembly.variables.provider===routeB.provider&&/Japanese/.test(preferenceText(childAssembly))&&guidanceText(childAssembly)==='')
    await setNext(ctx,child.agent,false)
    const offChild=await assemble(child.agent)
    check('model-native-child-explicit-off-blocks-own-route-policy',preferenceText(offChild)===''&&guidanceText(offChild)==='')
  } finally {await child.dispose()}
  // selectModel also updates the native global default; make this case's
  // creation route explicit instead of borrowing the preceding child fixture.
  await ctx.get('agentDefaultModel').saveSelection(routeA)
  const {sessionId:blankId}=await ctx.sessionController.create({cwd:job.workspace})
  const blank=ctx.agents.get(blankId)
  await setNext(ctx,blank,true)
  check('model-native-blank-starts-with-creation-route',blank.options.provider===routeA.provider&&ctx.sessionProjections.stateOf(blank.session,'modelSelection').pending===null)
  await ctx.get('agentDefaultModel').saveSelection(routeB)
  const blankAssembly=await assemble(blank)
  check('model-native-blank-follows-new-default-over-stale-options',blank.options.provider===routeA.provider&&blankAssembly.variables.provider===routeB.provider&&/Japanese/.test(preferenceText(blankAssembly))&&blank.ctx.tools.schemas(blank).some(tool=>tool.name==='next_parallel'),{options:{provider:blank.options.provider,model:blank.options.model},route:routeOf(blankAssembly),text:preferenceText(blankAssembly),tools:blank.ctx.tools.schemas(blank).map(tool=>tool.name),selection:ctx.sessionProjections.stateOf(blank.session,'modelSelection')})
  // Execute native file reads under the model-specific policy, not just its
  // rendered guidance. Switching back to the no-dedup route must restore text.
  const {createMessage,createToolResultMessage}=await import(pathToFileURL(join(job.runtime,'@deepseek-ai/dsh-llm/lib/index.js')).href)
  await ctx.sessionController.selectModel({sessionId,...routeB})
  await assemble(agent)
  const readValues=[]
  for(let turn=1;turn<=2;turn++) {
    const callId=randomUUID(),args={file_path:join(job.workspace,'fixture.txt'),offset:1,limit:120}
    const result=await ctx.tools.execute({agent,name:'read',callId,arguments:args,signal})
    check(`model-native-read-${turn}-full-value`,result.isError!==true&&result.value?.lines?.length===120)
    readValues.push(result.value)
    agent.session.append('turn/start',{turn})
    agent.session.append('step/start',{turn,step:1})
    agent.session.append('assistant/message',{turn,step:1,stream:[],message:createMessage({role:'assistant',content:[{type:'tool-call',id:callId,name:'read',arguments:JSON.stringify(args)}],source:{kind:'model',provider:routeB.provider,model:routeB.model}})},{surfaceOp:'append'})
    agent.session.append('tool/call',{turn,step:1,callId,name:'read',arguments:JSON.stringify(args)})
    agent.session.append('tool/result',{turn,step:1,message:createToolResultMessage({callId,content:result.content,isError:false})},{surfaceOp:'append'})
    agent.session.append('step/end',{turn,step:1})
    agent.session.append('turn/end',{turn,reason:{kind:'completed'}})
  }
  agent.session.append('turn/start',{turn:3})
  const prepare=()=>agentEvents(ctx,agent).waterfall('agent/request',{turn:3,step:1,signal},async()=>({...routeB}))
  const references=()=>agent.session.surface.nodes.map(seq=>agent.session.eventAt(seq)).filter(event=>event.type==='tool/result'&&event.data.message.content?.[0]?.text?.startsWith('[NEXT_READ_REF'))
  await prepare()
  check('model-native-enabled-route-really-shortens-only-model-surface',references().length===1&&same(readValues[0],readValues[1]))
  await ctx.sessionController.selectModel({sessionId,...routeA})
  await assemble(agent)
  await prepare()
  check('model-native-disabled-route-restores-full-read',references().length===0)
  await agentEvents(ctx,agent).serial('agent/turn-stopping',{turn:3,signal})
  agent.session.append('turn/end',{turn:3,reason:{kind:'completed'}})
  check('model-native-settings-never-alter-user-model-effort',ctx.sessionProjections.stateOf(agent.session,'modelSelection').pending?.provider===routeA.provider&&ctx.sessionProjections.stateOf(agent.session,'modelSelection').pending?.reasoningEffort==='high')
  check('model-native-legacy-global-preferences-preserved',same(Object.fromEntries(policyKeys.map(key=>[key,form(ctx)[key]])),beforeGlobal))
  // The shared editor submits one array containing both exact official routes.
  // Exercise that unchanged native form contract without contacting either provider.
  const officialProfiles=['deepseek-account','deepseek-official'].map(provider=>({provider,model:'next-shared-policy-fixture',tags:['smoke-economy'],overrides:{responseStyle:'standard',outputLanguage:'ko'}}))
  const beforeOfficialProfiles=structuredClone(form(ctx).modelProfiles)
  await ctx.settings.mutate('dsh-next',[{op:'set',path:['modelProfiles'],value:[...beforeOfficialProfiles,...officialProfiles]}])
  check('model-native-official-shared-array-saves-both-routes-together',same(form(ctx).modelProfiles,[...beforeOfficialProfiles,...officialProfiles]))
  check('model-native-official-both-resolve-identical-live-policy',same(resolve(officialProfiles[0]),resolve(officialProfiles[1]))&&resolve(officialProfiles[0]).outputLanguage==='ko'&&resolve(officialProfiles[1]).efficiencyGuidance===true)
  check('model-native-official-edit-keeps-other-routes-and-selection',resolve(routeA).outputLanguage==='zh-CN'&&resolve(routeB).outputLanguage==='ja'&&ctx.sessionProjections.stateOf(agent.session,'modelSelection').pending?.provider===routeA.provider)
  await ctx.sessions.flush(agent.session)
  const saved={schemaVersion:1,status:'Pass',sessionId,modelProfiles:form(ctx).modelProfiles,optimizationTags:form(ctx).optimizationTags,paidRequests:0,providersContacted:false,fixture:'Native metadata adapters, assembly and request waterfall; no provider stream.'}
  writeFileSync(join(job.output,'model-policies-native.json'),JSON.stringify(saved,null,2))
  writeFileSync(join(job.output,'model-config-native-probe.json'),JSON.stringify({status:'Pass',partialOverrides:Object.keys(profileHolder.get()[0].overrides),volatileHoldersStable:true,arrayValuesReplaced:true,paidRequests:0},null,2))
  await ctx.get('agentDefaultModel').saveSelection(defaultBefore)
  await ctx.settings.update('dsh-next',{prices:before.prices,automationPricesValidUntil:before.automationPricesValidUntil})
  removeAdapters()
}

export async function resumeModelPolicySmoke(ctx,{job,check}) {
  const saved=JSON.parse(readFileSync(join(job.output,'model-policies-native.json'),'utf8'))
  const removeAdapters=await fixtureAdapters(ctx,job)
  try {
    check('model-cold-native-settings-arrays-restored',same(form(ctx).modelProfiles,saved.modelProfiles)&&same(form(ctx).optimizationTags,saved.optimizationTags))
    const {createModelPreferenceResolver}=await import(new URL('./model-preferences.js',job.nextUrl).href)
    const resolve=createModelPreferenceResolver(configRef(ctx))
    const officialAccount=resolve({provider:'deepseek-account',model:'next-shared-policy-fixture'}),officialApi=resolve({provider:'deepseek-official',model:'next-shared-policy-fixture'})
    check('model-cold-native-official-shared-policy-restored',same(officialAccount,officialApi)&&officialAccount.outputLanguage==='ko'&&officialApi.responseStyle==='standard')
    const resolved=await ctx.sessionController.resolveAgent(saved.sessionId)
    check('model-cold-native-session-controller-restores-selection-owner',Boolean(resolved.agent))
    {
      const agent=resolved.agent
      const assembly=await agent.ctx.systemPrompt.assemble({agent,scope:agent})
      check('model-cold-native-route-policy-restored',ctx.sessionProjections.stateOf(agent.session,'next').active===true&&assembly.variables.provider===routeA.provider&&/Simplified Chinese/.test(preferenceText(assembly))&&guidanceText(assembly).length>0)
      await ctx.sessionController.selectModel({sessionId:agent.id,...routeB})
      const switched=await agent.ctx.systemPrompt.assemble({agent,scope:agent})
      check('model-cold-native-other-provider-policy-isolated',switched.variables.provider===routeB.provider&&/Japanese/.test(preferenceText(switched))&&guidanceText(switched)==='')
    }
  } finally {removeAdapters()}
}
