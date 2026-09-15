import { apply as applyDingtalk } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/dingtalk/index.mjs'
import { apply as applyDiscord } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/discord/index.mjs'
import { apply as applyFeishu } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/feishu/index.mjs'
import { apply as applyIMessage } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/imessage/index.mjs'
import { apply as applyOffice } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/office/index.mjs'
import { apply as applyQq } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/qq/index.mjs'
import { apply as applySlack } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/slack/index.mjs'
import { apply as applyTelegram } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/telegram/index.mjs'
import { apply as applyWecom } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/wecom/index.mjs'
import { apply as applyWecomApp } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/wecom-app/index.mjs'
import { apply as applyWeixin } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/weixin/index.mjs'
import { apply as applyWhatsapp } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/channels/whatsapp/index.mjs'
import { installOutboundArtifactTool } from '../node_modules/@xmanrui/dsh-im/src/channels/shared/semantic/artifact.mjs'
import { installHostLanguage } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/host-language.mjs'
import { installHostLanguageRpc } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/host-language-rpc.mjs'
import { installDeliveryRpc } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/delivery-rpc.mjs'
import { installDeliveryHttp } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/delivery-http.mjs'
import { createDeliveryService } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/delivery-service.mjs'
import { installInboundTtlRpc } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/inbound-ttl-rpc.mjs'
import { installSessionSyncCoordinator } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/session-sync-coordinator.mjs'
import { installSessionTitlePrefix } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/session-title-prefix.mjs'

export const name = 'clawclaw-im-host'
export const inject = ['connection', 'credentials', 'typertGateway']

const CHANNELS = Object.freeze([
  ['feishu', applyFeishu],
  ['weixin', applyWeixin],
  ['dingtalk', applyDingtalk],
  ['wecom', applyWecom],
  ['wecomApp', applyWecomApp],
  ['slack', applySlack],
  ['telegram', applyTelegram],
  ['discord', applyDiscord],
  ['imessage', applyIMessage],
  ['office', applyOffice],
  ['qq', applyQq],
  ['whatsapp', applyWhatsapp],
])

export const CLAWCLAW_HOST_CHANNELS = Object.freeze(CHANNELS.map(([channel]) => channel))

function channelConfig(config, channel, deliveryService) {
  const own = config[channel] ?? {}
  const authorized = config.rpcAuthority === undefined
    ? own
    : { ...own, rpcAuthority: config.rpcAuthority }
  return { ...authorized, deliveryService }
}

export function createImHostPlugin(internals = {}) {
  const channels = internals.channels ?? CHANNELS
  return Object.freeze({
    name,
    inject,
    async apply(ctx, config = {}) {
      const deliveryService = (internals.createDeliveryService ?? createDeliveryService)({
        unavailableSessionSyncChannels: channels
          .map(([channel]) => channel)
          .filter(channel => config[channel]?.harnessBaseUrl !== undefined),
      })
      if (typeof ctx?.provide === 'function') {
        ctx.provide('dshIm', Object.freeze({
          send: (botId, targetId, text, options) => deliveryService.send(botId, targetId, text, options),
          listTargets: async botId => (await deliveryService.listTargets(botId)).targets,
          listBots: () => deliveryService.listBots(),
        }))
      }
      const activate = readyCtx => activateChannels(readyCtx, config, deliveryService)
      if (typeof ctx?.inject === 'function') {
        const modern = typeof ctx?.typertGateway?.stream === 'function'
        await ctx.inject(modern ? ['sessionController', 'workspaceController'] : ['apiProxy'], activate)
        ctx.inject(['webServer'], httpCtx => {
          ;(internals.installDeliveryHttp ?? installDeliveryHttp)(httpCtx, deliveryService)
        })
        return
      }
      await activate(ctx)
      if (ctx?.webServer?.register && typeof ctx?.effect === 'function') {
        ;(internals.installDeliveryHttp ?? installDeliveryHttp)(ctx, deliveryService)
      }
    },
  })

  async function activateChannels(ctx, config, deliveryService) {
    const startHostLanguage = internals.installHostLanguage ?? installHostLanguage
    const hostLanguage = startHostLanguage(ctx, config)
    await hostLanguage?.ready
    const startTitlePrefix = titleCtx => {
      installSessionTitlePrefix(titleCtx, {
        logger: typeof titleCtx?.logger === 'function'
          ? titleCtx.logger('clawclaw-im:session-title')
          : (titleCtx?.logger ?? console),
      })
    }
    if (typeof ctx?.inject === 'function') ctx.inject(['sessions'], startTitlePrefix)
    else if (ctx?.sessions && typeof ctx.on === 'function') startTitlePrefix(ctx)
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['tools', 'systemPrompt'], artifactCtx => installOutboundArtifactTool(artifactCtx))
    } else installOutboundArtifactTool(ctx)

    const logger = typeof ctx?.logger === 'function' ? ctx.logger(name) : (ctx?.logger ?? console)
    if (ctx?.connection?.fetch) {
      if (hostLanguage) {
        try { (internals.installHostLanguageRpc ?? installHostLanguageRpc)(ctx, hostLanguage, config.rpcAuthority) }
        catch (error) { logger.error?.('[clawclaw-im] interface language service failed', error) }
      }
      try { (internals.installInboundTtlRpc ?? installInboundTtlRpc)(ctx, { config }) }
      catch (error) { logger.error?.('[clawclaw-im] inbound TTL service failed', error) }
      try { (internals.installDeliveryRpc ?? installDeliveryRpc)(ctx, deliveryService, { authority: config.rpcAuthority }) }
      catch (error) { logger.error?.('[clawclaw-im] delivery service failed', error) }
    }

    const failures = []
    await Promise.all(channels.map(async ([channel, start]) => {
      try { await start(ctx, channelConfig(config, channel, deliveryService)) }
      catch (error) {
        failures.push(error)
        logger.error?.(`[clawclaw-im] ${channel} failed to activate`, error)
      }
    }))
    if (failures.length === channels.length) {
      throw new AggregateError(failures, 'Every ClawClaw IM channel failed to activate')
    }
    if (typeof ctx?.on === 'function') {
      try {
        ;(internals.installSessionSyncCoordinator ?? installSessionSyncCoordinator)(ctx, deliveryService, {
          logger,
          inputScope: ctx.root ?? ctx,
        })
      } catch (error) { logger.error?.('[clawclaw-im] session sync failed', error) }
    }
  }
}

export async function apply(ctx, config = {}) {
  return createImHostPlugin().apply(ctx, config)
}
