// Read only authoritative native events; parent prose is not child completion evidence.
const textBlocks = event => (event?.data?.message?.content ?? event?.data?.content ?? []).filter(block => block.type === 'text').map(block => block.text)
export function subagentReceiptEvidence(events) {
  const spawns = events.filter(event => event.type === 'tool/call' && event.data.name === 'subagent')
  if (spawns.length !== 1) return null
  const start = events.find(event => event.type === 'tool/result' && event.surfaceOp === 'append' && event.data.message.toolCallId === spawns[0].data.callId && event.data.message.isError !== true)
  const childId = start && textBlocks(start).join('\n').match(/^started subagent ([a-zA-Z0-9-]+)$/)?.[1]
  if (!childId) return null
  const final = events.filter(event => event.type === 'assistant/message' && !event.data.message.content.some(block => block.type === 'tool-call') && textBlocks(event).join('').trim()).at(-1)
  if (!final) return null
  for (const receipt of events) {
    const source = receipt.data?.source
    if (receipt.type !== 'user/message' || source?.kind !== 'subagent-settled' || source.form !== 'notice' || source.senderSessionId !== childId || receipt.seq <= start.seq || receipt.seq >= final.seq) continue
    const blocks = textBlocks(receipt)
    const closing = blocks.indexOf('Its closing message:')
    if (!blocks[0]?.startsWith(`Background subagent ${childId} finished`) || closing < 0 || !/\b323\b/.test(blocks.slice(closing + 1).join('\n'))) continue
    return { childId, startSeq: start.seq, receiptSeq: receipt.seq, finalSeq: final.seq, source: 'native-subagent-settled' }
  }
  return null
}
