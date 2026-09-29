import * as React from 'react'
import { h, isEnglish, localizeText } from '../node_modules/@xmanrui/dsh-im/plugin-src/client/i18n.js'
import { channelTranslator, en, zh } from './locales.js'
import { channelDirectoryPicker } from './directory-picker.js'
import { apply as applyDshImClient, IMSettingsTab } from '../node_modules/@xmanrui/dsh-im/plugin-src/client/index.js'
import {
  DingtalkLogoGlyph,
  DiscordLogoGlyph,
  FeishuLogoGlyph,
  IMessageLogoGlyph,
  OfficeLogoGlyph,
  QqLogoGlyph,
  SlackLogoGlyph,
  TelegramLogoGlyph,
  WecomLogoGlyph,
  WeixinLogoGlyph,
  WhatsappLogoGlyph,
} from '../node_modules/@xmanrui/dsh-im/plugin-src/client/channel-logos.js'
import {
  CLAWCLAW_CHANNELS,
  channelOverviewState,
  channelStatusLabel,
  combineChannelOverviewStates,
} from './overview-state.js'
import { installClawClawChannelStyles } from './styles.js'
import {
  ChannelSessionLeading,
  installChannelSessionPresentation,
} from './session-presentation.js'

export const inject = ['slots', 'connection', 'locale', 'workspaces', 'sessions']

const LOGOS = Object.freeze({
  dingtalk: DingtalkLogoGlyph,
  discord: DiscordLogoGlyph,
  feishu: FeishuLogoGlyph,
  imessage: IMessageLogoGlyph,
  office: OfficeLogoGlyph,
  qq: QqLogoGlyph,
  slack: SlackLogoGlyph,
  telegram: TelegramLogoGlyph,
  wecom: WecomLogoGlyph,
  weixin: WeixinLogoGlyph,
  whatsapp: WhatsappLogoGlyph,
})

function ChannelCard({ channel, status, onOpen }) {
  const Logo = LOGOS[channel.id]
  return h('button', {
    type: 'button',
    className: 'ccChannelCard',
    disabled: channel.unavailable === true,
    onClick: () => onOpen(channel.id),
  },
  h('span', { className: 'ccChannelLogo', 'data-tone': channel.tone, 'aria-hidden': 'true' }, h(Logo)),
  h('span', { className: 'ccChannelCopy' },
    h('strong', null, channel.label),
    h('p', null, channel.description),
    h('span', { className: 'ccChannelState' },
      h('span', { className: 'ccChannelDot', 'data-state': status?.state ?? 'loading' }),
      channelStatusLabel(status, isEnglish() ? 'en' : 'zh'))),
  h('span', { className: 'ccChannelArrow', 'aria-hidden': 'true' }, channel.unavailable === true ? '' : '›'))
}

function useChannelStatuses(injected) {
  const [statuses, setStatuses] = React.useState({})
  React.useEffect(() => {
    const controller = new AbortController()
    let timer
    const read = async () => {
      const entries = await Promise.all(CLAWCLAW_CHANNELS.map(async channel => {
        if (channel.unavailable === true) {
          return [channel.id, Object.freeze({ state: 'unavailable', configured: 0, connected: 0 })]
        }
        const rpcNames = Array.isArray(channel.rpc) ? channel.rpc : [channel.rpc]
        const channelStates = await Promise.all(rpcNames.map(async rpcName => {
          try {
            const result = await injected[rpcName]('connection.status', {}, controller.signal)
            return channelOverviewState(result)
          } catch {
            return channelOverviewState(undefined)
          }
        }))
        return [channel.id, combineChannelOverviewStates(channelStates)]
      }))
      if (!controller.signal.aborted) {
        setStatuses(Object.fromEntries(entries))
        timer = window.setTimeout(read, 10_000)
      }
    }
    void read()
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [injected])
  return statuses
}

function DshImDetail({ channelId, injected, onBack }) {
  const rootRef = React.useRef(null)
  const [wecomMode, setWecomMode] = React.useState('wecom')
  const detailChannelId = channelId === 'wecom' ? wecomMode : channelId
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector(`#dim-tab-${detailChannelId}`)?.click()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [detailChannelId])
  const channel = CLAWCLAW_CHANNELS.find(candidate => candidate.id === channelId)
  return h('div', { className: 'ccChannelDetail', ref: rootRef },
    h('div', { className: 'ccChannelDetailHeader' },
      h('button', { type: 'button', className: 'ccChannelBack', onClick: onBack }, '返回'),
      h('h2', { className: 'ccChannelDetailTitle' }, channel?.label ?? '消息渠道'),
      channelId === 'wecom'
        ? h('div', { className: 'ccChannelModes', role: 'group', 'aria-label': '企业微信接入方式' },
            h('button', {
              type: 'button',
              'data-active': wecomMode === 'wecom',
              'aria-pressed': wecomMode === 'wecom',
              onClick: () => setWecomMode('wecom'),
            }, '智能机器人'),
            h('button', {
              type: 'button',
              'data-active': wecomMode === 'wecomApp',
              'aria-pressed': wecomMode === 'wecomApp',
              onClick: () => setWecomMode('wecomApp'),
            }, '自建应用'))
        : null),
    h(IMSettingsTab, injected))
}

export function ClawClawChannelSettings(injected) {
  const [selected, setSelected] = React.useState(null)
  const statuses = useChannelStatuses(injected)
  if (selected !== null) {
    return h(DshImDetail, { channelId: selected, injected, onBack: () => setSelected(null) })
  }
  const configured = CLAWCLAW_CHANNELS.filter(channel => (statuses[channel.id]?.configured ?? 0) > 0)
  return h('section', { className: 'ccChannels', 'aria-label': '消息渠道' },
    h('header', { className: 'ccChannelsHeader' },
      h('h2', null, '消息渠道'),
      h('p', null, '连接外部聊天平台，管理消息入口和投递能力。')),
    h('section', { className: 'ccChannelsSection' },
      h('div', { className: 'ccChannelsSectionHeader' },
        h('h3', null, '已配置渠道'),
        h('p', null, '管理已经保存的渠道连接。')),
      configured.length === 0
        ? h('div', { className: 'ccChannelsEmpty' }, '还没有已配置的渠道。')
        : h('div', { className: 'ccChannelsGrid' }, configured.map(channel => h(ChannelCard, {
            key: channel.id, channel, status: statuses[channel.id], onOpen: setSelected,
          })))),
    h('section', { className: 'ccChannelsSection' },
      h('div', { className: 'ccChannelsSectionHeader' },
        h('h3', null, '支持的渠道'),
        h('p', null, '选择一个平台开始连接。')),
      h('div', { className: 'ccChannelsGrid' }, CLAWCLAW_CHANNELS.map(channel => h(ChannelCard, {
        key: channel.id, channel, status: statuses[channel.id], onOpen: setSelected,
      })))))
}

function interceptedContext(ctx) {
  const locale = new Proxy(ctx.locale, {
    get(target, property) {
      if (property === 'bind') {
        return namespace => namespace === 'dsh-im'
          ? channelTranslator(target.bind(namespace), localizeText) : target.bind(namespace)
      }
      if (property === 'register') {
        return (namespace, dictionaries) => target.register(namespace, namespace === 'dsh-im'
          ? { ...dictionaries, zh: { ...dictionaries.zh, ...zh }, en: { ...dictionaries.en, ...en } }
          : dictionaries)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const slots = new Proxy(ctx.slots, {
    get(target, property) {
      if (property === 'register') {
        return (options, component) => target.register(
          options?.id === 'xmanrui-dsh-im'
            ? {
                ...options,
                id: 'clawclaw-channels',
                label: () => localizeText('消息渠道'),
                inject: (...args) => {
                  const injected = options.inject(...args)
                  return {
                    ...injected,
                    workspaceDirectoryPicker: channelDirectoryPicker(injected.workspaceDirectoryPicker,
                      () => window.__DSH_DESKTOP_PICK_DIRECTORY__),
                  }
                },
              }
            : options,
          options?.id === 'xmanrui-dsh-im' ? ClawClawChannelSettings : component,
        )
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return new Proxy(ctx, {
    get(target, property) {
      if (property === 'slots') return slots
      if (property === 'locale') return locale
      if (property === 'effect') {
        return (factory, label) => label === 'im-settings: Session channel logos'
          ? undefined
          : target.effect(factory, label)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function apply(ctx) {
  ctx.effect(installClawClawChannelStyles, 'clawclaw channels: overview styles')
  applyDshImClient(interceptedContext(ctx))
  ctx.effect(
    () => installChannelSessionPresentation(LOGOS),
    'clawclaw channels: rc.2 Session presentation',
  )
  ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
    name: 'sidebar.session.row.leading',
    id: 'clawclaw-channel-session-source',
    order: -10,
    inject: () => ({ logos: LOGOS, sessions: ctx.sessions }),
  }, ChannelSessionLeading))
}
