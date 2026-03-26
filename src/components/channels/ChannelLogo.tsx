import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

const CHANNEL_BRAND_STYLES: Partial<Record<ChannelType, { shell: string; icon: string }>> = {
  telegram: {
    shell: 'bg-[#27A7E7] border-[#1f8ec7] shadow-[0_10px_24px_rgba(39,167,231,0.22)]',
    icon: 'brightness-0 invert',
  },
  discord: {
    shell: 'bg-[#5865F2] border-[#4752c4] shadow-[0_10px_24px_rgba(88,101,242,0.22)]',
    icon: 'brightness-0 invert',
  },
  whatsapp: {
    shell: 'bg-[#25D366] border-[#1faf54] shadow-[0_10px_24px_rgba(37,211,102,0.2)]',
    icon: 'brightness-0 invert',
  },
  wechat: {
    shell: 'bg-[#07C160] border-[#059c4e] shadow-[0_10px_24px_rgba(7,193,96,0.22)]',
    icon: '',
  },
  feishu: {
    shell: 'bg-[linear-gradient(135deg,#0F67FF,#00C2FF)] border-[#0f67ff] shadow-[0_10px_24px_rgba(15,103,255,0.22)]',
    icon: 'brightness-0 invert',
  },
  dingtalk: {
    shell: 'bg-[#1677FF] border-[#0f5fd1] shadow-[0_10px_24px_rgba(22,119,255,0.22)]',
    icon: 'brightness-0 invert',
  },
  wecom: {
    shell: 'bg-[linear-gradient(135deg,#07C160,#00A1EA)] border-[#07c160] shadow-[0_10px_24px_rgba(7,193,96,0.22)]',
    icon: 'brightness-0 invert',
  },
  qqbot: {
    shell: 'bg-[linear-gradient(135deg,#12B7F5,#4E8CFF)] border-[#12b7f5] shadow-[0_10px_24px_rgba(18,183,245,0.22)]',
    icon: 'brightness-0 invert',
  },
};

const CHANNEL_ICON_SOURCES: Partial<Record<ChannelType, string>> = {
  telegram: telegramIcon,
  discord: discordIcon,
  whatsapp: whatsappIcon,
  wechat: wechatIcon,
  dingtalk: dingtalkIcon,
  feishu: feishuIcon,
  wecom: wecomIcon,
  qqbot: qqIcon,
};

export function ChannelLogo({
  type,
  branded = false,
  shellClassName,
  sizeClassName = 'h-[40px] w-[40px]',
  iconClassName = 'h-[20px] w-[20px]',
  shapeClassName = 'rounded-full',
  fallbackClassName = 'text-[20px] leading-none',
}: {
  type: ChannelType;
  branded?: boolean;
  shellClassName?: string;
  sizeClassName?: string;
  iconClassName?: string;
  shapeClassName?: string;
  fallbackClassName?: string;
}) {
  const brand = CHANNEL_BRAND_STYLES[type];
  const resolvedShellClassName = branded
    ? brand?.shell ?? 'bg-slate-900 border-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.16)]'
    : shellClassName ?? 'border-border/70 bg-card shadow-sm';
  const resolvedIconClassName = branded ? brand?.icon ?? 'brightness-0 invert' : '';
  const iconSrc = CHANNEL_ICON_SOURCES[type];
  const label = CHANNEL_NAMES[type] || type;

  const wrap = (content: ReactNode) => (
    <div
      className={cn(
        'shrink-0 flex items-center justify-center border',
        sizeClassName,
        shapeClassName,
        resolvedShellClassName,
      )}
    >
      {content}
    </div>
  );

  if (iconSrc) {
    return wrap(
      <img
        src={iconSrc}
        alt={label}
        className={cn(iconClassName, resolvedIconClassName)}
      />,
    );
  }

  return wrap(
    <span className={fallbackClassName}>
      {CHANNEL_ICONS[type] || '💬'}
    </span>,
  );
}
