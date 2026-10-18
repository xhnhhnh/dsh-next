import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilitiesProjection as projection, parallelReadiness, CAPABILITIES_RECORD } from '../lib/capabilities.js'
import { DEFAULT_PREFERENCES } from '../lib/preferences.js'
import { automationProjection,VERIFICATION_RECORD } from '../lib/automation-state.js'
const base={enabled:true,preferences:DEFAULT_PREFERENCES,route:{provider:'p',model:'m'},prices:[{provider:'p',model:'m',input:2,cacheRead:0.04,cacheWrite:2,output:8}],validUntil:'2099-01-01T00:00:00.000Z',budget:{spentCny:0,reservations:{},limitCny:3},toolsAvailable:true,modelInfo:{context:{contextWindow:1000000},defaultMaxTokens:8192},now:1}
test('parallel schemas require real prices, bounds, root budget and native capabilities before admission',()=>{
  assert.equal(parallelReadiness(base).status,'ready')
  for(const change of [{enabled:false},{preferences:{...DEFAULT_PREFERENCES,automationParallelism:false}},{prices:[]},{prices:[...base.prices,...base.prices]},{validUntil:''},{validUntil:'1970-01-01T00:00:00.000Z'},{depth:1},{toolsAvailable:false},{modelInfo:null},{modelInfo:{context:{contextWindow:0}}},{budget:null},{budget:{spentCny:2,reservations:{}}},{budget:{spentCny:0,reservations:{a:{amountCny:1,unknown:true}}}},{budget:{spentCny:0,reservations:{},limitCny:1}},{prices:[{...base.prices[0],input:'-1'}]}]){
    assert.notEqual(parallelReadiness({...base,...change}).status,'ready',JSON.stringify(change))
  }
  assert.equal(parallelReadiness({...base,route:{provider:'other',model:'m'}}).status,'blocked','price is never copied across official or third-party routes')
  assert.equal(parallelReadiness({...base,preferences:{...DEFAULT_PREFERENCES,automationBudgetCny:0}}).status,'blocked')
})
test('capability projection replays complete snapshots and ignores malformed or inherited history',()=>{
  const snapshot={sessionId:'s',workspace:'C:/fixture',route:base.route,capabilities:Object.fromEntries(['optimization','verification','retrieval','parallel'].map(key=>[key,{status:'ready',reason:'Native service available'}])),checks:[],updatedAt:1}
  const event={type:CAPABILITIES_RECORD,ignorable:true,seq:3,data:snapshot}
  const state=projection.apply(projection.init(),event)
  projection.stateSchema.parse(state)
  assert.deepEqual(projection.wire.view(state),snapshot)
  assert.deepEqual(projection.apply(projection.init({},4),event),projection.init({},4))
  assert.deepEqual(projection.apply(state,{...event,data:{...snapshot,capabilities:{}}}),state)
  assert.deepEqual(projection.wire.view(JSON.parse(JSON.stringify(state))),snapshot)
})
test('expiring a successful receipt replaces its last status once without erasing execution history',()=>{
  const source={sessionId:'s',callId:'real-call',originalCallId:''}
  const event=status=>({type:VERIFICATION_RECORD,ignorable:true,seq:1,data:{checkId:'build',status,detail:status,source}})
  let state=automationProjection.apply(automationProjection.init(),event('executed'))
  state=automationProjection.apply(state,event('expired'))
  state=automationProjection.apply(state,event('expired'))
  assert.equal(state.verification.executed,1)
  assert.equal(state.verification.unknown,1)
  assert.equal(state.verification.last.length,1)
  assert.equal(state.verification.last[0].status,'expired')
  automationProjection.stateSchema.parse(state)
})
