import * as React from 'react'
import { OfficeLogoGlyph } from '../node_modules/@xmanrui/dsh-im/plugin-src/client/channel-logos.js'
import { OFFICIAL_CHANNEL_ICON_DATA } from './channel-icon-data.js'

// Embed the original vendor files without tracing, recoloring, cropping, or
// modifying their geometry. Images share one registry across every surface.
export const CHANNEL_LOGOS = Object.freeze({
  ...Object.fromEntries(Object.entries(OFFICIAL_CHANNEL_ICON_DATA).map(([channel, src]) => [
    channel,
    ({ size = 32 } = {}) => React.createElement('img', {
      src, width: size, height: size, alt: '', draggable: false,
      'aria-hidden': 'true', 'data-im-channel-logo': channel,
    }),
  ])),
  // AI Office is hidden in the Desktop catalog; preserve legacy Session support.
  office: OfficeLogoGlyph,
})

export const COMPACT_CHANNEL_ICON_CSS = `
[data-dsh-im-session-leading] img,[data-dsh-session-source-icon]{object-fit:contain;display:block;width:16px;height:16px}
body[data-ds-dark-theme] img[data-im-channel-logo="qq"]{background:#fff;border-radius:2px}
`
