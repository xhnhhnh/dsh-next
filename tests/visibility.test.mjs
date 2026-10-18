import test from 'node:test'
import assert from 'node:assert/strict'
import {installToolVisibility} from '../lib/visibility.js'
import {createModelPreferenceResolver,selectedRoute} from '../lib/model-preferences.js'

test('optional missing tools never break NEXT-off Agent creation and late registration syncs',async()=>{
  const handlers=new Map(),registered=new Set(['next_verify']),filters=[]
  let enabled=false,disposed=0
  const agent={id:'a',ctx:{tools:{restrict(filter){assert.ok(filter.deny.every(name=>registered.has(name)));filters.push(filter);return()=>disposed++}}}}
  const ctx={tools:{get:name=>registered.has(name)?{}:undefined},sessions:{list:()=>[{id:'a'}]},agents:{get:()=>agent},on(name,fn){handlers.set(name,fn);return()=>handlers.delete(name)}}
  const control=installToolVisibility(ctx,{names:['next_verify','next_parallel'],isVisible:()=>enabled})
  handlers.get('agent/created')({agent})
  assert.deepEqual(filters.at(-1),{deny:['next_verify']})
  registered.add('next_parallel');control.syncAll()
  assert.deepEqual(filters.at(-1),{deny:['next_verify','next_parallel']})
  enabled=true;control.syncAll();assert.equal(disposed,2)
  handlers.get('session/event')({id:'a'},{type:'working-directory/change'})
  control.dispose();await Promise.resolve()
  assert.equal(filters.length,2,'a queued directory update cannot reinstall a disposed restriction')
})

test('switching same-named models across providers updates tool visibility before the next request',async()=>{
  const a={provider:'a',model:'shared'},b={provider:'b',model:'shared'},handlers=new Map(),filters=[]
  const projection={pending:a,lastUsed:b}
  const agent={id:'root',options:b,session:{id:'root',header:{},requestHeader:()=>({config:b})},ctx:{tools:{restrict(filter){filters.push(filter);return()=>filters.push({disposed:true})}}}}
  const ctx={tools:{get:()=>({})},sessions:{list:()=>[agent.session]},agents:{get:()=>agent},sessionProjections:{stateOf:()=>projection},on(name,fn){handlers.set(name,fn);return()=>handlers.delete(name)}}
  const preferences=createModelPreferenceResolver({modelProfiles:[{...a,tags:['economy'],overrides:{}}]})
  const visibility=installToolVisibility(ctx,{names:['next_parallel'],isVisible:agent=>preferences(selectedRoute(ctx,agent)).automationParallelism})
  visibility.syncAll()
  assert.deepEqual(filters.at(-1),{deny:['next_parallel']})
  projection.pending=b
  handlers.get('session/event')(agent.session,{type:'model/selection'})
  await Promise.resolve()
  assert.deepEqual(filters.at(-1),{disposed:true},'old model policy is removed without sending a request')
  projection.pending=a
  handlers.get('session/event')(agent.session,{type:'model/selection'})
  await Promise.resolve()
  assert.deepEqual(filters.at(-1),{deny:['next_parallel']})
  projection.pending=null
  agent.session.requestHeader=()=>undefined
  projection.lastUsed=null
  let defaultRoute=b
  ctx.get=()=>({currentSelection:()=>defaultRoute})
  handlers.get('settings/document-updated')('agent-default-model',1)
  assert.deepEqual(filters.at(-1),{disposed:true},'a blank session releases stale restrictions when its inherited default changes')
  defaultRoute=a
  handlers.get('settings/document-updated')('agent-default-model',2)
  assert.deepEqual(filters.at(-1),{deny:['next_parallel']})
  visibility.dispose()
})
