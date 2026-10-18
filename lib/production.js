import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { CAPABILITIES_RECORD, capabilitySnapshotSchema, parallelReadiness } from './capabilities.js'
import { modelKey, selectedRoute } from './model-preferences.js'
import { scanProjectChecks } from './project-checks.js'
import { installProductionRemote } from './production-remote.js'

const item=(status,reason)=>({status,reason})
const stable=value=>JSON.stringify({...value,updatedAt:0})
export function installProduction(ctx,options){
  const snapshots=new WeakMap(),metadata=new Map()
  let closed=false,visibility,expiryTimer
  const select=request=>{
    const agent=request.sessionId?ctx.agents.get(request.sessionId):ctx.agents.list().filter(agent=>!agent.session.header.parentSession).at(-1)
    if(request.sessionId&&!agent)throw new Error('Open this project conversation before inspecting or scanning it.')
    return agent
  }
  const modelInfo=async route=>{
    if(!modelKey(route))return null
    const key=modelKey(route),cached=metadata.get(key)
    if(cached&&Date.now()-cached.at<30000)return cached.value
    try{const value=await ctx.llm.resolveModelInfo(route.provider,route.model,new AbortController().signal);metadata.set(key,{value,at:Date.now()});return value}catch{return null}
  }
  function workspaceOf(agent){try{return ctx.workingDirectory.get(agent.session)??agent.session.header.cwd??''}catch{return agent.session.header.cwd??''}}
  async function refresh(agent,{inspect=false,route=selectedRoute(ctx,agent)}={}){
    if(closed||!agent?.session)return null
    const enabled=options.isEnabled(agent),preferences=options.preferences(route),workspace=workspaceOf(agent)
    const registered=options.getChecks(agent),registration=JSON.stringify(registered),previous=snapshots.get(agent)
    const checks=inspect?await options.verification.checkStatus(agent):null
    const currentChecks=checks?.checks??(previous?.registration===registration?previous.value.checks:registered.map(check=>({id:check.id,kind:check.kind,status:'ready',reason:'Registered check; inputs, bindings and current permissions are checked before execution.'})))
    const readable=Boolean(ctx.tools.get('read',agent)),searchable=readable&&Boolean(ctx.tools.get('glob',agent))&&Boolean(ctx.tools.get('grep',agent))
    const shell=Boolean(ctx.tools.get('pwsh',agent)||ctx.tools.get('bash',agent))
    const readyChecks=currentChecks.filter(check=>check.status==='ready'&&readable&&(check.kind!=='command'||shell))
    let budget
    try{budget=options.getBudget(agent)}catch{}
    const parallel=parallelReadiness({enabled,preferences,route,prices:options.getPrices(),validUntil:options.getPriceExpiry(),budget,
      toolsAvailable:readable&&Boolean(ctx.get('subagents')?.getProvider?.('spawn')?.prepareContinuable),
      depth:Math.max(agent.options?.subagentDepth??0,agent.session.header.delegationDepth??0),modelInfo:enabled&&preferences.automationEnabled&&preferences.automationParallelism?await modelInfo(route):null})
    const value=capabilitySnapshotSchema.parse({sessionId:agent.id??agent.session.id,workspace,route:modelKey(route)?{provider:route.provider,model:route.model}:null,
      capabilities:{optimization:enabled?item('ready','NEXT execution and context policies apply to subsequent calls.'):item('off','NEXT is off for this conversation.'),
        verification:!enabled?item('off','NEXT is off for this conversation.'):!registered.length?item('blocked','No checks have been registered for this project.'):!readable?item('blocked','The native read capability is unavailable.'):readyChecks.length?item('ready',`${readyChecks.length} registered checks can run; a ready tool is not proof that a check has passed.`):item('blocked',checks?.reason??'Registered checks are expired or their native execution tools are unavailable.'),
        retrieval:!enabled?item('off','NEXT is off for this conversation.'):searchable?item('ready','Native read, glob and grep are available with current Host permissions.'):item('blocked','Native read, glob and grep are required for file discovery and content search.'),parallel},checks:currentChecks,updatedAt:Date.now()})
    // Inspection and model catalog resolution can outlive plugin disposal.
    if(closed)return null
    snapshots.set(agent,{value,registration})
    if(!previous||stable(previous.value)!==stable(value))appendPluginRecord(agent.session,CAPABILITIES_RECORD,value)
    visibility?.syncAll()
    return value
  }
  const visible=(agent,name)=>{
    if(!options.isEnabled(agent))return false
    const snapshot=snapshots.get(agent)?.value
    return name==='next_parallel'?snapshot?.capabilities.parallel.status==='ready':Boolean(options.getChecks(agent).length)&&snapshot?.capabilities.verification.status!=='blocked'
  }
  const syncAll=()=>{if(closed)return;for(const agent of ctx.agents.list())void refresh(agent).catch(error=>ctx.logger?.warn?.(`NEXT capability refresh: ${error.message}`))}
  const offSettings=ctx.on('settings/document-updated',()=>{metadata.clear();syncAll();scheduleExpiry()},{global:true})
  const offCreated=ctx.on('agent/created',({agent})=>{void refresh(agent).catch(()=>{})},{global:true})
  const offWritten=ctx.on('fs/observed',(_target,observation,actor)=>{
    if(!['write','edit'].includes(actor?.name)||observation?.kind!=='present')return
    const previous=snapshots.get(actor.agent)
    if(previous)previous.value.checks=previous.value.checks.map(check=>check.status==='unavailable'?{...check,status:'ready',reason:'Project files changed; current inputs will be checked before execution.'}:check)
  },{global:true})
  const offAssembly=ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
    const agent=context.agent
    // Validate registrations before advertising tools, even when settings have
    // never been opened in this process. Execution still performs its own check.
    if(agent)await refresh(agent,{inspect:options.isEnabled(agent)&&options.getChecks(agent).length>0})
    const assembly=await next()
    if(!agent)return assembly
    const admitted=modelKey(assembly.variables)?assembly.variables:selectedRoute(ctx,agent)
    const before=snapshots.get(agent)?.value
    if(modelKey(admitted)!==modelKey(before?.route))await refresh(agent,{route:admitted})
    return {...assembly,tools:assembly.tools.filter(tool=>!['next_verify','next_parallel'].includes(tool.name)||visible(agent,tool.name))}
  },{global:true,prepend:true})
  function scheduleExpiry(){
    clearTimeout(expiryTimer)
    const remaining=Date.parse(options.getPriceExpiry())-Date.now()
    if(Number.isFinite(remaining)&&remaining>0){expiryTimer=setTimeout(()=>{syncAll();scheduleExpiry()},Math.min(remaining+5,2147483647));expiryTimer.unref?.()}
  }
  scheduleExpiry()
  ctx.inject(['typert'],remoteCtx=>{installProductionRemote(remoteCtx,{
    async inspect(request){
      const agent=select(request)
      if(!agent)return {sessionId:'',workspace:'',route:null,capabilities:Object.fromEntries(['optimization','verification','retrieval','parallel'].map(key=>[key,item('unknown','Open a project conversation to inspect and register its capabilities.')])),checks:[],updatedAt:Date.now()}
      return refresh(agent,{inspect:true})
    },
    async scan(request){
      const agent=select(request)
      if(!agent)throw new Error('Open a project conversation before scanning checks.')
      return scanProjectChecks(ctx,{agent,workspace:request.workspace??workspaceOf(agent),signal:new AbortController().signal})
    },
  })})
  return {refresh,visible,syncAll,setVisibility(value){visibility=value},
    // An expired result does not invalidate its registration. Reinspect actual
    // bindings so normal edits keep their registered check available to rerun.
    record(record,agent){if(record.status==='expired')void refresh(agent,{inspect:true}).catch(()=>{})},
    dispose(){closed=true;clearTimeout(expiryTimer);offSettings?.();offCreated?.();offWritten?.();offAssembly?.();metadata.clear()},
  }
}
