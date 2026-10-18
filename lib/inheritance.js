/** Batch successful NEXT state transitions without scanning on unrelated commands. */
export function inheritanceScheduler({ active, sync, reportFailure = () => {}, enqueue = queueMicrotask }) {
  const pending = new WeakMap()
  let queued = false, disposed = false
  const schedule = () => {
    if (disposed || queued) return
    queued = true
    enqueue(() => {
      queued = false
      if (disposed) return
      try { sync() } catch (error) { reportFailure(error) }
    })
  }
  return {
    sessionEvent(session, event) {
      if (disposed) return
      if (event.type === 'command/run' && event.data.name === 'next' && /^(on|off)$/.test(event.data.args?.trim())) {
        let commands = pending.get(session)
        if (!commands) pending.set(session, commands = new Map())
        commands.set(event.data.commandId, active(session))
      } else if (event.type === 'command/done') {
        const commands = pending.get(session)
        if (!commands?.has(event.data.commandId)) return
        const before = commands.get(event.data.commandId)
        commands.delete(event.data.commandId)
        if (event.data.kind === 'success' && before !== active(session)) schedule()
      }
    },
    agentCreated: schedule,
    dispose() { disposed = true },
  }
}
