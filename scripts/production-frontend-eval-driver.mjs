import {readFileSync,writeFileSync,existsSync,renameSync,realpathSync} from 'node:fs'
import {join,resolve,relative,isAbsolute,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import {authorizeRun,admission,reserveRequest,settleRequest,hash,nativeText} from './production-frontend-eval-core.mjs'
export const name='next-production-frontend-evaluation'
export const inject=['sessionController','agents','commands','sessions','sessionProjections','tools','settings','systemPrompt','llm']
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n')
const within=(root,path)=>{const rel=relative(root,path);return rel===''||!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)}
const messageText=event=>(event?.data?.message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n')
export function apply(ctx){
 const job=JSON.parse(readFileSync(process.env.DSH_NEXT_PRODUCTION_EVAL_JOB,'utf8')),mode=process.env.DSH_NEXT_PRODUCTION_EVAL_MODE
 const resultPath=join(job.output,'private',mode+'-result.json'),results=[],requests=[],providerModels=[]
 let ledger,run,activeAgent,currentLabel=null,recordIndex=0
 const save=()=>{if(!ledger)return;const path=job.budgetPath;json(path+'.tmp',ledger);renameSync(path+'.tmp',path);json(join(job.output,'private/run-budget.json'),run)}
 const descendants=agent=>ctx.agents.list().filter(candidate=>{let session=candidate.session;const seen=new Set();while(session&&!seen.has(session.id)){if(session.id===agent.id)return true;seen.add(session.id);session=session.header.parentSession?ctx.sessions.get(session.header.parentSession):null}return false})
 const cancel=agent=>{for(const item of descendants(agent))item.cancel({kind:'user'})}
 const drain=async agent=>{for(let pass=0;pass<3;pass++){await Promise.all(descendants(agent).map(item=>item.whenIdle()));await Promise.resolve()}}
 const failBudget=reason=>{if(ledger){ledger.paused=true;run.paused=true;run.pauseReason=reason;save()}throw new Error(reason)}
 // A response-only observer records the supplier's model string. It never reads,
 // stores or prints request headers, cookies, credentials, or response content.
 const originalFetch=globalThis.fetch
 globalThis.fetch=async(...args)=>{
  const response=await originalFetch(...args)
  const url=typeof args[0]==='string'?args[0]:String(args[0]?.url??args[0])
  if(/\/messages(?:\?|$)/u.test(url)&&response.ok&&response.body){
   const label=currentLabel,reader=response.clone().body.getReader(),decoder=new TextDecoder()
   void(async()=>{let buffer='';try{while(buffer.length<1048576){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.startsWith('data:')){let event;try{event=JSON.parse(line.slice(5).trim())}catch{continue}if(event.type==='message_start'){providerModels.push({label,model:typeof event.message?.model==='string'?event.message.model.slice(0,200):null});void reader.cancel();return}}}}catch{}finally{void reader.cancel()}})()
  }
  return response
 }
 ctx.on('llm/stream',(options,next)=>{
  if(mode!=='run')throw new Error('Read-only preflight forbids inference')
  if(options.provider!==job.model.provider||options.model!==job.model.model||options.reasoningEffort!==job.model.reasoningEffort||options.maxTokens!==job.maxOutputTokens)failBudget('Unexpected model, reasoning or maxTokens refused before dispatch')
  if(requests.filter(item=>item.label===currentLabel).length>=job.maxCallsPerCase)failBudget('Per-case request limit reached')
  const price=job.prices[0],reservation=(1048576*Math.max(price.input,price.cacheRead,price.cacheWrite)+job.maxOutputTokens*price.output)/1e6
  const admitted=admission({ledger,run,reservation,now:Date.now(),expiresAt:job.pricing.expiresAt})
  if(!admitted.allowed)failBudget(admitted.reason)
  const id=randomUUID(),label=currentLabel;reserveRequest(ledger,run,{id,costCny:reservation});save()
  requests.push({id,label,sessionId:options.sessionId,provider:options.provider,model:options.model,reasoningEffort:options.reasoningEffort,maxTokens:options.maxTokens,reservedCny:reservation})
  return (async function*(){const {createMeter}=await import(pathToFileURL(join(job.package,'lib/meter.js')).href);const meter=createMeter({prices:job.prices,onRecord(record){settleRequest(ledger,run,{...record,label,reservationId:id});save()}});yield*meter.wrap(options,next)})()
 },{global:true,prepend:true})
 ctx.on('agent/request',async(_payload,next)=>({...await next(),maxTokens:job.maxOutputTokens}),{global:true})
 const allowed=new Set(['read','write','edit','glob','grep','pwsh','subagent','subagent_fork','list_agents','wait','send_message','next_verify','next_parallel','structured_output','run_code'])
 ctx.on('tools/pre-execute',async(exec,next)=>{
  if(!allowed.has(exec.name))return {kind:'deny',reason:'This isolated frontend evaluation permits only native project tools.'}
  const cwd=resolve(exec.agent?.session.header.cwd??''),project=job.projects.find(item=>within(item.directory,cwd))
  if(!project)return {kind:'deny',reason:'No evaluation workspace for this Agent.'}
  if(exec.name==='pwsh'){
   if(exec.arguments.command?.trim()!=='npm run build'||resolve(exec.arguments.workdir??cwd)!==project.directory||exec.arguments.run_in_background||exec.arguments.sandbox_permissions)return {kind:'deny',reason:'Only exact npm run build in this project is registered for evaluation.'}
  }
  if(['read','write','edit','glob','grep'].includes(exec.name)){
   const requested=resolve(cwd,exec.arguments.file_path??exec.arguments.path??exec.arguments.directory??'.')
   if(!within(project.directory,requested)||requested.includes(sep+'node_modules'+sep)||requested===join(project.directory,'node_modules'))return {kind:'deny',reason:'File access must stay in the current project, excluding dependency internals.'}
   if(exec.name==='glob'&&typeof exec.arguments.pattern==='string'&&(isAbsolute(exec.arguments.pattern)||exec.arguments.pattern.split(/[\\/]/u).includes('..')))return {kind:'deny',reason:'Glob must stay in the current project.'}
   const projectRelative=relative(project.directory,requested).replaceAll('\\','/')
   if(['write','edit'].includes(exec.name)&&(['package.json','package-lock.json'].includes(projectRelative)||/(?:^|\/)(?:(?:vite|postcss|tailwind|rollup|webpack|babel)\.config\.[^/]+|\.babelrc(?:\.[^/]+)?|\.npmrc)$/iu.test(projectRelative)))return {kind:'deny',reason:'Pinned project scripts, lockfile and build configuration are immutable.'}
   try{if(existsSync(requested)&&!within(realpathSync(project.directory),realpathSync(requested)))return {kind:'deny',reason:'File target resolves outside the current project.'}}catch{return {kind:'deny',reason:'Could not verify the file target.'}}
  }
  return next()
 },{global:true,prepend:true})
 void Promise.resolve().then(async()=>{
  try{
   await ctx.get('loader')?.await()
   if(!ctx.settings.describe().some(item=>item.ns==='dsh-next'))throw new Error('NEXT plugin did not activate in the evaluation snapshot')
   ctx.on('agent/created',({agent})=>{agent.ctx.tools.restrict({allow:['read','write','edit','glob','grep','pwsh','list_agents','send_message','subagent_fork',...['next_verify','next_parallel'].filter(name=>ctx.tools.get(name,agent)!==undefined)]})},{global:true})
   const listed=await ctx.llm.listModels(job.model.provider),selected=listed.find(item=>item.id===job.model.model)
   if(!selected)throw new Error('Read-only official account model listing did not offer deepseek-flash')
   const nativeBuildChecks=[]
   for(const project of job.projects){
    for(const [file,digest]of Object.entries(job.templateHashes))if(hash(readFileSync(join(project.directory,file)))!==digest)throw new Error('Template changed before native build preflight')
    const {sessionId}=await ctx.sessionController.create({cwd:project.directory}),agent=ctx.agents.get(sessionId),signal=new AbortController().signal
    const schemas=agent.ctx.tools.schemas(agent).map(tool=>tool.name)
    for(const name of ['read','write','edit','pwsh'])if(!ctx.tools.get(name,agent))throw new Error('Native frontend tool is missing: '+name)
    const execution=await ctx.tools.execute({agent,name:'pwsh',callId:randomUUID(),arguments:{command:'npm run build',description:'No-fee preflight of the pinned blank frontend template',timeoutMs:120000,workdir:project.directory},signal})
    if(execution.isError||execution.value?.exitCode!==0)throw new Error('Native workspace-write build preflight failed: '+project.label+' '+JSON.stringify(execution.value??execution).slice(0,1000))
    for(const [file,digest]of Object.entries(job.templateHashes))if(hash(readFileSync(join(project.directory,file)))!==digest)throw new Error('Native build changed template source')
    nativeBuildChecks.push({label:project.label,status:'Pass',exitCode:execution.value.exitCode,sourceUnchanged:true,tools:schemas})
   }
   const preflight={status:'Pass',mode:'read-only-model-catalog-and-native-fixed-build',provider:job.model.provider,model:job.model.model,offeredName:selected.name??null,nativeBuildChecks,at:new Date().toISOString(),inferenceCalls:0,credentialsCopied:false,temporaryHeaderLimitBytes:65536,executionPolicy:{nativeStandingPreset:'danger-full-access',allowedCommand:'npm run build',workingDirectory:'Each project separately',locked:['package.json','package-lock.json','build configuration','dependencies'],limitations:'Windows ACL workspace-write cannot spawn piped Vite/esbuild children. Both groups use the same native standing permission preset with exact-command/file guards; no OS workspace confinement is claimed. Production profile is unchanged.'}}
   json(join(job.output,'private/transport-preflight.json'),preflight)
   if(mode!=='run'){json(resultPath,{status:'Pass',preflight,paidCalls:0});console.log(JSON.stringify({type:'production-eval-preflight',status:'Pass',paidCalls:0}));process.exit(0)}
   const audit=JSON.parse(readFileSync(process.env.DSH_NEXT_PRODUCTION_EVAL_AUTH,'utf8'))
   if(audit.runId!==job.runId||audit.productionLedgerBackup===undefined||audit.priorHostsEnded!==true)throw new Error('Root approval audit does not match this run or prior-host check')
   const current=JSON.parse(readFileSync(job.budgetPath,'utf8'))
   if(hash(readFileSync(job.budgetPath))!==audit.ledgerSha256)throw new Error('Budget changed after root backup/approval')
   ;({ledger,run}=authorizeRun(current,{runId:job.runId,at:new Date().toISOString(),priorHostsEnded:true,transportPreflight:true,authorization:audit.authorization}))
   save()
   const checks=job.projects.map(project=>({id:'build-'+project.label,workspace:project.directory,kind:'command',command:'npm run build',timeoutMs:120000,bindings:['package.json','package-lock.json'].map(file=>({file,sha256:hash(nativeText(readFileSync(join(project.directory,file),'utf8')))}))}))
   await ctx.settings.update('dsh-next',{verificationChecks:checks,efficiencyGuidance:true,methodGuidance:true,targetedVerification:true,benefitBasedParallelism:true,deduplicateReads:true,automationEnabled:true,automationVerification:true,automationParallelism:true,automationBudgetCny:3})
   for(const condition of job.conditions){
    if(ledger.paused||run.paused)break
    currentLabel=condition.label;recordIndex=run.records.length
    const {sessionId}=await ctx.sessionController.create({cwd:condition.directory}),agent=ctx.agents.get(sessionId);activeAgent=agent
    await ctx.sessionController.selectModel({sessionId,...job.model})
    const signal=new AbortController().signal,result=await ctx.commands.execute(agent,`/next ${condition.enabled?'on':'off'}`,[],signal)
    if((result?.result?.kind??result?.kind)!=='success'||ctx.sessionProjections.stateOf(agent.session,'next')?.active!==condition.enabled)throw new Error('NEXT condition was not acknowledged')
    const assembly=await agent.ctx.systemPrompt.assemble({agent,scope:agent}),guidance=assembly.sections.filter(section=>section.name==='next:efficiency'&&section.text)
    if(guidance.length!==(condition.enabled?1:0))throw new Error('NEXT guidance duplicated or control condition contaminated')
    const schemas=agent.ctx.tools.schemas(agent).map(tool=>tool.name)
    if(!condition.enabled&&schemas.some(name=>['next_verify','next_parallel'].includes(name)))throw new Error('NEXT tool visible in control condition')
    json(join(job.output,'private',condition.label+'-assembly.json'),{guidanceSections:guidance,tools:schemas,capabilities:ctx.sessionProjections.stateOf(agent.session,'nextCapabilities')??null})
    const started=Date.now();let error=null,timedOut=false
    const timer=setTimeout(()=>{timedOut=true;cancel(agent)},job.maxCaseMs)
    try{await ctx.sessionController.prompt({sessionId,requestId:randomUUID(),mode:'followup',clientTimeZone:'Asia/Shanghai',content:[{type:'text',text:job.prompt}]},signal);await drain(agent)}catch(failure){error=String(failure);cancel(agent);await drain(agent)}finally{clearTimeout(timer)}
    await ctx.sessions.flush(agent.session)
    const events=agent.session.snapshotEvents(),calls=run.records.slice(recordIndex),final=events.filter(event=>event.type==='assistant/message'&&!(event.data.message.content??[]).some(block=>block.type==='tool-call')).at(-1)
    const row={label:condition.label,enabled:condition.enabled,sessionId,completed:events.filter(event=>event.type==='turn/end').at(-1)?.data.reason?.kind==='completed',error,timedOut,elapsedMs:Date.now()-started,calls:calls.length,costCnyUpper:calls.some(call=>call.costCny===null)?null:calls.reduce((sum,call)=>sum+call.costCny,0),tokens:Object.fromEntries(['input','cacheRead','cacheWrite','output','total'].map(key=>[key,calls.some(call=>call.tokens[key]===null)?null:calls.reduce((sum,call)=>sum+call.tokens[key],0)])),tools:events.filter(event=>event.type==='tool/call').map(event=>event.data.name),providerModels:providerModels.filter(item=>item.label===condition.label),text:messageText(final)}
    results.push(row);writeFileSync(join(job.output,'private',condition.label+'-events.jsonl'),events.map(event=>JSON.stringify(event)).join('\n')+'\n');json(join(job.output,'private/generation-results.json'),results)
    console.log(JSON.stringify({type:'production-eval-case',label:condition.label,completed:row.completed,calls:row.calls,costCnyUpper:row.costCnyUpper,elapsedMs:row.elapsedMs}))
    activeAgent=null
    if(timedOut||error||calls.some(call=>call.costCny===null))break
   }
   json(resultPath,{status:results.length===2&&!ledger.paused?'Complete':'Partial',results,requests,providerModels,runBudget:run,remainingLegacyReservations:run.legacyReservations});save();process.exit(0)
  }catch(error){if(activeAgent){cancel(activeAgent);await drain(activeAgent)}save();json(resultPath,{status:'Fail',error:String(error),stack:error.stack,results,requests,runBudget:run??null});console.log(JSON.stringify({type:'production-eval-failed',error:String(error)}));process.exit(1)}
 }).catch(error=>{json(resultPath,{status:'Fail',error:String(error)});process.exit(1)})
}
