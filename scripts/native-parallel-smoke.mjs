import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Actual native child lifecycle, permissions, persistence and tool dispatch; synthetic model frames only. */
export async function runParallelSmoke(ctx,{job,agent,check,setModelResponder}) {
  const children = new Map(), reads = new Set(), schemas = [], guardResults = []
  let active = 0, peak = 0, dispatches = 0, unknownMode=false
  const onCreated=ctx.on('agent/created',({agent:child})=>{
    if(child.session.header.parentSession===agent.id) { children.set(child.id,child); active++;peak=Math.max(peak,active) }
  },{global:true})
  const onDisposed=ctx.on('agent/disposed',({agent:child})=>{ if(children.has(child.id))active-- },{global:true})
  const routeTrace=[]
  const onTrace=ctx.on('llm/stream',(options,next)=>{
    routeTrace.push({sessionId:options.sessionId,provider:options.provider,model:options.model,reasoningEffort:options.reasoningEffort,parent:agent.session.requestHeader()?.config,child:children.get(options.sessionId)?.session.requestHeader()?.config})
    writeFileSync(join(job.output,'parallel-routes.json'),JSON.stringify(routeTrace,null,2))
    return next()
  },{global:true,prepend:true})
  setModelResponder(options=>{
    if(!children.has(options.sessionId))throw new Error('Native parallel fixture refused an unexpected model route.')
    dispatches++
    const child=children.get(options.sessionId)
    schemas.push({childId:child.id,names:options.tools?.map(tool=>tool.name),model:options.model,reasoningEffort:options.reasoningEffort,maxTokens:options.maxTokens})
    return(async function*(){
      if(unknownMode) { yield {type:'finish',reason:{kind:'stop'}}; return }
      const id=randomUUID(), name=reads.has(child.id)?'structured_output':'read'
      const args=name==='read'?{file_path:join(job.workspace,'next-config.json'),offset:1,limit:20}:{summary:'Read-only native fixture completed.',findings:[]}
      reads.add(child.id)
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:JSON.stringify(args)}}
      yield {type:'usage',usage:{inputTokens:100,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:10,totalTokens:110}}
      yield {type:'finish',reason:{kind:'tool-calls'}}
    })()
  })
  const signal=new AbortController().signal
  try {
    const args={benefit:'Two independent inspections can run together.',tasks:[{id:'a',prompt:'Read next-config.json and report its count.',depends_on:[]},{id:'b',prompt:'Independently inspect next-config.json syntax.',depends_on:[]},{id:'summary',prompt:'Summarize the prior inspections.',depends_on:['a','b']}]}
    const result=await ctx.tools.execute({agent,name:'next_parallel',callId:randomUUID(),arguments:args,signal})
    check('native-parallel-tool-output',result.isError===false,{result})
    check('native-parallel-native-terminal-success',result.value.tasks.length===3&&result.value.tasks.every(item=>item.status==='completed'),{tasks:result.value.tasks})
    check('native-parallel-cap-two',peak<=2&&peak>0,{peak,dispatches})
    check('native-parallel-output-cap',schemas.every(item=>item.maxTokens<=8192))
    let budget=ctx.sessionProjections.stateOf(agent.session,'nextAutomation').budget
    check('native-parallel-reservations-settled',Object.keys(budget.reservations).length===0&&budget.spentCny>0&&budget.spentCny<3,{spentCny:budget.spentCny})
    check('native-parallel-owned-children-persisted',budget.children.length===3)
    for(const child of children.values()) {
      const error=await ctx.tools.execute({agent:child,name:'write',callId:randomUUID(),arguments:{file_path:join(job.workspace,'forbidden.json'),content:'{}'},signal})
      guardResults.push(error.isError===true)
    }
    check('native-parallel-no-writing',guardResults.length===3&&guardResults.every(Boolean))
    unknownMode=true
    const uncertain=await ctx.tools.execute({agent,name:'next_parallel',callId:randomUUID(),arguments:{benefit:'Check conservative accounting for missing provider usage.',tasks:[{id:'unknown',prompt:'Read only; synthetic provider omits usage.',depends_on:[]}]},signal})
    budget=ctx.sessionProjections.stateOf(agent.session,'nextAutomation').budget
    check('native-parallel-missing-usage-holds-reservation',uncertain.value.tasks[0].status!=='completed'&&Object.values(budget.reservations).some(item=>item.reason||item.unknown),{tasks:uncertain.value.tasks})
    const beforeBlocked=dispatches
    const blocked=await ctx.tools.execute({agent,name:'next_parallel',callId:randomUUID(),arguments:{benefit:'Ensure unknown prior spend blocks new dispatch.',tasks:[{id:'blocked',prompt:'Read only.',depends_on:[]}]},signal})
    check('native-parallel-unknown-blocks-new-dispatch',dispatches===beforeBlocked&&blocked.value.tasks[0].status==='failed')
    await ctx.sessions.flush(agent.session)
    writeFileSync(join(job.output,'parallel-native.json'),JSON.stringify({status:'Pass',peak,dispatches,schemas,budget,guardResults,modelFrames:'synthetic',providersContacted:false},null,2))
  } finally { setModelResponder(undefined);onTrace();onCreated();onDisposed() }
}
