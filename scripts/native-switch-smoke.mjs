import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}

/** Native alpha.5 lifecycle/commands/pre-step and tools; synthetic model frames only. */
export async function runSwitchSmoke(ctx,{job,check,agentEvents,setModelResponder}) {
  const {sessionId}=await ctx.sessionController.create({cwd:job.workspace})
  const agent=ctx.agents.get(sessionId),signal=new AbortController().signal
  const command=async(target,text)=>{
    const result=await ctx.commands.execute(target,text,[],signal)
    if((result?.result?.kind??result?.kind)!=='success')throw new Error('Native switch command failed')
  }
  const reports=[]
  await command(agent,'/next on')
  let created,dispatches=0
  const reads=new Set()
  const off=ctx.on('agent/created',async({agent:child})=>{
    if(child.session.header.parentSession!==agent.id)return
    created=child
    await command(child,'/next off')
    check('switch-child-local-off-is-explicit',ctx.sessionProjections.stateOf(child.session,'next').active===false&&ctx.sessionProjections.stateOf(child.session,'next').explicit===true)
  },{global:true})
  setModelResponder(options=>{
    if(options.sessionId!==created?.id)throw new Error('Unexpected synthetic route')
    dispatches++
    return(async function*(){
      const name=reads.has(options.sessionId)?'structured_output':'read';reads.add(options.sessionId)
      const args=name==='read'?{file_path:join(job.workspace,'next-config.json'),offset:1,limit:20}:{summary:'Unexpected dispatch fixture.',findings:[]}
      yield{type:'block-end',index:0,block:{type:'tool-call',id:randomUUID(),name,arguments:JSON.stringify(args)}}
      yield{type:'usage',usage:{inputTokens:100,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:10,totalTokens:110}}
      yield{type:'finish',reason:{kind:'tool-calls'}}
    })()
  })
  try {
    const result=await ctx.tools.execute({agent,name:'next_parallel',callId:randomUUID(),arguments:{benefit:'Independent read-only switch regression.',tasks:[{id:'off-child',prompt:'Read next-config.json only.',depends_on:[]}]},signal})
    const budget=ctx.sessionProjections.stateOf(agent.session,'nextAutomation').budget
    check('switch-child-off-before-first-request-has-zero-dispatch',Boolean(created)&&dispatches===0&&result.value.tasks[0].status!=='completed',{dispatches})
    check('switch-child-off-reserves-no-fees',budget.spentCny===0&&Object.keys(budget.reservations).length===0)
    reports.push({scenario:'parent-on-child-explicit-off',dispatches,taskStatus:result.value.tasks[0].status,spentCny:budget.spentCny,reservations:Object.keys(budget.reservations).length})
  } finally {off();setModelResponder(undefined)}

  for(const control of ['next','automation','unchanged']) {
    await command(agent,'/next on')
    await ctx.settings.update('dsh-next',{automationEnabled:true,automationVerification:true})
    const before=ctx.sessionProjections.stateOf(agent.session,'nextAutomation').verification
    const read=await ctx.tools.execute({agent,name:'read',callId:randomUUID(),arguments:{file_path:join(job.workspace,'next-config.json'),offset:1,limit:20},signal})
    check(`switch-notice-${control}-native-read`,read.isError===false)
    const write=await ctx.tools.execute({agent,name:'write',callId:randomUUID(),arguments:{file_path:join(job.workspace,'next-config.json'),content:JSON.stringify({count:100+reports.length})+'\n'},signal})
    check(`switch-notice-${control}-native-write`,write.isError===false,{write})
    const entered=deferred(),release=deferred()
    const remove=ctx.on('agent/pre-step',async(payload,next)=>{
      if(payload.agent.id!==agent.id)return next()
      entered.resolve();await release.promise;return next()
    },{global:true})
    try {
      const expected={kind:'enter',messages:[]}
      const pending=agentEvents(ctx,agent).waterfall('agent/pre-step',{turn:950,step:1,messages:[],signal},async()=>expected)
      await entered.promise
      const afterCheck=ctx.sessionProjections.stateOf(agent.session,'nextAutomation').verification
      check(`switch-notice-${control}-checked-before-wait`,afterCheck.executed+afterCheck.reused===before.executed+before.reused+1)
      if(control==='next')await command(agent,'/next off')
      else if(control==='automation')await ctx.settings.update('dsh-next',{automationEnabled:false})
      release.resolve()
      const result=await pending
      const notices=result.messages.filter(message=>JSON.stringify(message).includes('NEXT automatic project verification')).length
      check(`switch-notice-${control}-current-gate`,notices===(control==='unchanged'?1:0),{notices})
      reports.push({scenario:`notice-${control}`,notices,checksCompletedBeforeSwitch:1})
    } finally {release.resolve();remove()}
  }
  await command(agent,'/next on')
  await ctx.settings.update('dsh-next',{automationEnabled:true})
  await ctx.sessions.flush(agent.session)
  writeFileSync(join(job.output,'switch-regressions.json'),JSON.stringify({status:'Pass',reports,paidRequests:0,modelFrames:'synthetic'},null,2))
}
