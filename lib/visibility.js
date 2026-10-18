/** Hide optional tool schemas through native scoped restrictions, including PTC declarations. */
export function installToolVisibility(ctx, { names, isVisible }) {
  const agents = new Map()
  let closed=false
  const sync = agent => {
    if (closed||!agent?.ctx?.tools?.restrict) return
    // NEXT's tools are profile registrations. A missing optional service must not
    // make scoped restrict() reject an unknown tool during ordinary Agent creation.
    const denied = names.filter(name => ctx.tools.get(name)!==undefined && !isVisible(agent, name))
    const key = denied.join(',')
    const previous = agents.get(agent)
    if (previous?.key === key) return
    previous?.dispose?.()
    agents.set(agent, { key, dispose: denied.length ? agent.ctx.tools.restrict({ deny: denied }) : undefined })
  }
  const syncAll = () => {
    for (const session of ctx.sessions.list()) {
      const agent = ctx.agents.get(session.id)
      if (agent) sync(agent)
    }
  }
  const created = ctx.on('agent/created', ({ agent }) => sync(agent), { global: true })
  const disposed = ctx.on('agent/disposed', ({ agent }) => { agents.get(agent)?.dispose?.(); agents.delete(agent) }, { global: true })
  // A blank native session follows the Host's live default route. Its NEXT
  // restrictions must also refresh when that default's settings document changes,
  // not only when a NEXT preference or per-session selection changes.
  const changed = ctx.on('settings/document-updated', () => syncAll(), { global: true })
  const directory = ctx.on('session/event', (session, event) => {
    if (event.type === 'working-directory/change' || event.type === 'model/selection' || event.type === 'request/header') queueMicrotask(() => {
      const agent = ctx.agents.get(session.id)
      if (agent) sync(agent)
    })
  }, { global: true })
  return { syncAll, dispose() { closed=true;created?.(); disposed?.(); changed?.(); directory?.(); for (const entry of agents.values()) entry.dispose?.(); agents.clear() } }
}
