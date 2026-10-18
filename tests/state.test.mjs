import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextProjection, metricsProjection, effectiveState, RECORDS } from '../lib/state.js'

const run = (id, wanted, seq) => ({ type: 'command/run', seq, data: { name: 'next', args: wanted, commandId: id } })
const done = (id, kind = 'success') => ({ type: 'command/done', data: { commandId: id, kind } })
test('only successful matching commands persist and replay the switch', () => {
  const events = [run('a','on',0), done('a','error'), run('b','on',2), done('other'), done('b')]
  const state = events.reduce(nextProjection.apply, nextProjection.init())
  assert.equal(state.active, true)
  assert.equal(state.explicit, true)
  nextProjection.stateSchema.parse(state)
  assert.deepEqual(events.reduce(nextProjection.apply, nextProjection.init()), state)
})
test('late completion cannot overwrite a newer successful switch', () => {
  const state = [run('a','on',0), run('b','off',1), done('b'), done('a')].reduce(nextProjection.apply, nextProjection.init())
  assert.equal(state.active, false)
})
test('child inherits live parent; local explicit off wins and independent chats stay off', () => {
  const parent = { id:'p', header:{} }, child = { id:'c', header:{parentSession:'p'} }, other = {id:'o',header:{}}
  const states = { p: [run('a','on',0),done('a')].reduce(nextProjection.apply,nextProjection.init()), c:nextProjection.init(), o:nextProjection.init() }
  const ctx = { sessions: {get:id => ({p:parent,c:child,o:other})[id]}, sessionProjections:{stateOf:session => states[session.id]} }
  assert.deepEqual(effectiveState(ctx,child),{active:true,inherited:true})
  assert.equal(effectiveState(ctx,other).active,false)
  states.c = [run('b','off',0),done('b')].reduce(nextProjection.apply,states.c)
  assert.deepEqual(effectiveState(ctx,child),{active:false,inherited:false})
})
test('usage folds once and unknown usage or prices remain unknown', () => {
  const record = {version:1,id:'call-a',durationMs:50,usageComplete:true,priceKnown:true,tokens:{input:10,output:4,cacheRead:2,cacheWrite:0},costCny:0.01}
  const event = {type:RECORDS.usage,ignorable:true,data:record}
  let state = metricsProjection.apply(metricsProjection.init(),event)
  state = metricsProjection.apply(state,event)
  assert.equal(state.view.calls,1)
  assert.equal(state.view.inputTokens,10)
  state = metricsProjection.apply(state,{...event,data:{...record,id:'call-b',usageComplete:false,priceKnown:false,costCny:null}})
  assert.equal(state.view.inputTokens,null)
  assert.equal(state.view.costCny,null)
  assert.equal(state.view.unknownPriceCalls,1)
  metricsProjection.stateSchema.parse(state)
})

test('forked history inherits the switch without pinning it and does not rebill parent usage', () => {
  const state=[run('copied','on',0),{...done('copied'),seq:1}].reduce(nextProjection.apply,nextProjection.init({},2))
  assert.equal(state.active,true)
  assert.equal(state.explicit,false)
  assert.equal(state.inherited,true)
  const initial=metricsProjection.init({},5)
  assert.deepEqual(metricsProjection.apply(initial,{type:RECORDS.usage,seq:2,ignorable:true,data:{id:'copied-parent-record'}}),initial)
  nextProjection.stateSchema.parse(state)
  metricsProjection.stateSchema.parse(initial)
})
