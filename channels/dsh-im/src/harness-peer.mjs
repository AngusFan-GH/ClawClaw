/** Give the trusted in-process channel adapter the rc.2 Gateway caller lifetime. */
const gateways = new WeakMap()

export function channelGateway(ctx) {
  const gateway = ctx?.typertGateway
  if (!gateway) return undefined
  const owner = ctx.root ?? ctx
  const cached = gateways.get(owner)
  if (cached) return cached.gateway
  if (typeof ctx.connection?.createPeer !== 'function' || typeof owner.effect !== 'function') {
    throw new TypeError('ClawClaw channels require a Host connection Peer and lifecycle owner')
  }
  // These channels already execute for this local Host owner. Never derive
  // identity from a message, channel user id, or an incoming RPC payload.
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
  const facade = new Proxy(gateway, {
    get(target, key) {
      if (key === 'invoke' || key === 'stream') return request => target[key]({ ...request, peer })
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const entry = { gateway: facade, peer }
  gateways.set(owner, entry)
  owner.effect(() => async () => {
    if (gateways.get(owner) === entry) gateways.delete(owner)
    await peer.dispose()
  }, 'ClawClaw IM: trusted in-process Gateway Peer')
  return facade
}
