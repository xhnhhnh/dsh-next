import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function runAutomationSmoke(ctx,{job,agent,check,agentEvents,command}) {
  const path = join(job.workspace,'next-config.json'), schema = join(job.workspace,'next-schema.json')
  writeFileSync(path,'{"count":2}\n')
  writeFileSync(schema,JSON.stringify({type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}))
  const signal = new AbortController().signal
  const tool = (name,args,extra={}) => ctx.tools.execute({name,agent,callId:randomUUID(),arguments:args,signal,...extra})
  const view = () => ctx.sessionProjections.snapshot(agent.session).values.nextAutomation
  const run = async (force = false) => {
    const result = await tool('next_verify',{check_id:'json-config',force})
    check('native-verify-output-accepted',result.isError===false,{error:result.isError?result.content:undefined})
    return result.value
  }
  check('native-verify-visible-when-next-on',agent.ctx.tools.schemas(agent).some(item=>item.name==='next_verify'))
  const first = await run()
  check('native-verify-executed',first.status==='executed'&&first.passed===true&&first.inputHash.length===64)
  const repeated = await run()
  check('native-verify-reuse-has-real-source',repeated.status==='reused'&&repeated.source.originalCallId===first.source.callId)
  check('native-verify-force-executes',(await run(true)).status==='executed')
  const denied = agent.ctx.tools.guard(exec=>exec.name==='read'&&exec.arguments.file_path===path?'Native acceptance fixture denies this input.':undefined)
  check('native-verify-permission-change-is-unknown',(await run()).status==='unknown')
  denied()
  writeFileSync(path,'{"count":"wrong"}\n')
  check('native-verify-schema-failure',(await run()).status==='failed')
  writeFileSync(path,'{"count":3}\n')
  check('native-verify-external-input-change-executes',(await run()).status==='executed')
  const write = await tool('write',{file_path:path,content:'{"count":4}\n'})
  check('native-auto-edit-succeeded',write.isError===false)
  const enter = await agentEvents(ctx,agent).waterfall('agent/pre-step',{turn:999,step:1,signal,messages:[]},async()=>({kind:'enter',messages:[]}))
  check('native-auto-check-same-step-context',enter.kind==='enter'&&enter.messages.some(item=>JSON.stringify(item).includes('NEXT automatic project verification')))
  check('native-auto-check-persisted',view().verification.last.some(item=>item.checkId==='json-config'&&item.status==='executed'))
  const counts = view().verification.executed
  await ctx.settings.update('dsh-next',{automationEnabled:false})
  const noAutoWrite=await tool('write',{file_path:path,content:'{"count":5}\n'})
  check('native-auto-master-off-keeps-write',noAutoWrite.isError===false)
  await agentEvents(ctx,agent).waterfall('agent/pre-step',{turn:999,step:2,signal,messages:[]},async()=>({kind:'enter',messages:[]}))
  check('native-auto-master-off-no-check',view().verification.executed===counts)
  await ctx.settings.update('dsh-next',{automationEnabled:true})
  await command('/next off')
  await new Promise(resolve=>setTimeout(resolve,0))
  check('native-verify-hidden-when-next-off',!agent.ctx.tools.schemas(agent).some(item=>item.name==='next_verify'))
  await command('/next on')
  await new Promise(resolve=>setTimeout(resolve,0))
  check('native-verify-shown-after-next-on',agent.ctx.tools.schemas(agent).some(item=>item.name==='next_verify'))
  check('native-verification-no-source-mutation',readFileSync(path,'utf8')==='{"count":5}\n')
  await ctx.sessions.flush(agent.session)
  writeFileSync(join(job.output,'automation-view.json'),JSON.stringify(view(),null,2))
}
