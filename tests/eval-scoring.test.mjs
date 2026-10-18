import assert from 'node:assert/strict'
import test from 'node:test'
import { subagentReceiptEvidence } from '../scripts/eval-scoring.mjs'
const fixture = () => [
  { type:'tool/call', seq:1, data:{name:'subagent',callId:'call-a'} },
  { type:'tool/result', seq:2, surfaceOp:'append', data:{message:{toolCallId:'call-a',isError:false,content:[{type:'text',text:'started subagent child-a'}]}} },
  { type:'user/message', seq:3, data:{source:{kind:'subagent-settled',form:'notice',senderSessionId:'child-a'},content:[{type:'text',text:'Background subagent child-a finished and will do no further work unless you send it more.'},{type:'text',text:'Its closing message:'},{type:'text',text:'323'}]} },
  { type:'assistant/message', seq:4, data:{message:{content:[{type:'text',text:'323'}]}} },
]
test('native completed receipt ties one successful spawn to the delivered child result', () => {
  assert.deepEqual(subagentReceiptEvidence(fixture()), {childId:'child-a',startSeq:2,receiptSeq:3,finalSeq:4,source:'native-subagent-settled'})
})
test('parent self-report and a different child cannot stand in for native receipt', () => {
  const events = fixture(); events[2].data.source.kind = 'user'
  assert.equal(subagentReceiptEvidence(events), null)
  events[2].data.source.kind = 'subagent-settled'; events[2].data.source.senderSessionId = 'other'
  assert.equal(subagentReceiptEvidence(events), null)
})
test('failure notice, stale receipt and missing closing output cannot pass', () => {
  const events = fixture(); events[2].data.content[0].text = 'Background subagent child-a stopped before it finished.'
  assert.equal(subagentReceiptEvidence(events), null)
  const late = fixture(); late[2].seq = 5
  assert.equal(subagentReceiptEvidence(late), null)
  const noOutput = fixture(); noOutput[2].data.content.pop()
  assert.equal(subagentReceiptEvidence(noOutput), null)
})
test('duplicate spawn or failed spawn cannot pass despite a completion-like message', () => {
  const duplicate = fixture(); duplicate.unshift({...duplicate[0],seq:0})
  assert.equal(subagentReceiptEvidence(duplicate), null)
  const failed = fixture(); failed[1].data.message.isError = true
  assert.equal(subagentReceiptEvidence(failed), null)
})
