const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const CHANNEL_LABELS = new Set(['消息渠道', 'Message channels'])
const NEW_CHAT_ICON_PATH = 'M8.00003 0.3237C3.76075 0.3237 0.32373 3.76072 0.32373 8C0.32373 9.17603 0.589121 10.2922 1.0632 11.2901L1.35291 11.8989L2.5705 11.3205L2.28079 10.7117C1.89079 9.89074 1.67301 8.97167 1.67301 8C1.67301 4.50546 4.50549 1.67298 8.00003 1.67298C11.4946 1.67298 14.3271 4.50546 14.3271 8C14.3271 11.4945 11.4946 14.327 8.00003 14.327C7.28473 14.327 6.76077 14.277 6.29621 14.1487C5.83857 14.0224 5.40441 13.8109 4.88514 13.4488C4.12569 12.919 3.03778 12.7316 2.141 13.2978L2.12682 13.307L2.11264 13.3171L1.34886 13.854L1.79659 15.188L2.86122 14.4384C3.19068 14.2305 3.68325 14.2542 4.11326 14.5539C4.72789 14.9826 5.30042 15.2724 5.93762 15.4484C6.56803 15.6224 7.22776 15.6763 8.00003 15.6763C12.2393 15.6763 15.6763 12.2393 15.6763 8C15.6763 3.76072 12.2393 0.3237 8.00003 0.3237ZM7.32033 4.82535V7.32536H4.82538V8.67464H7.32033V11.1747H8.6696V8.67464H11.1747V7.32536H8.6696V4.82535H7.32033Z'

function channelNavButton() {
  return [...document.querySelectorAll('button')].find(button =>
    [...button.children].some(child =>
      child.tagName === 'SPAN' && CHANNEL_LABELS.has(child.textContent?.trim()),
    ),
  )
}

function createChannelNavIcon(previous) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.dataset.clawclawChannelIcon = 'true'
  const className = previous.getAttribute('class')
  if (className !== null) svg.setAttribute('class', className)
  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('d', NEW_CHAT_ICON_PATH)
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

export function installChannelNavIcon() {
  const present = () => {
    const icon = channelNavButton()?.querySelector(':scope > svg')
    if (icon === null || icon === undefined || icon.dataset.clawclawChannelIcon === 'true') return
    icon.replaceWith(createChannelNavIcon(icon))
  }
  present()
  const observer = new MutationObserver(present)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}
