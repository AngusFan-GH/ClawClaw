'use strict'
const $ = id => document.getElementById(id)
const metrics = ['requests', 'sessions', 'complete', 'resumed', 'failed', 'interrupted', 'bytes']
let data
let selected = []
const zero = () => Object.fromEntries(metrics.map(key => [key, 0]))
const sum = rows => rows.reduce((total, row) => { for (const key of metrics) total[key] += row[key]; return total }, zero())
const bytes = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`
const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const today = () => day(new Date())
function range(days) {
  $('to').value = today()
  const start = new Date(`${today()}T00:00:00+08:00`)
  start.setUTCDate(start.getUTCDate() - days + 1)
  $('from').value = day(start)
  render()
}
function cells(body, values) {
  const tr = document.createElement('tr')
  for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td) }
  body.append(tr)
}
function group(rows, key) {
  const groups = new Map()
  for (const row of rows) { const id = key(row); groups.set(id, [...(groups.get(id) ?? []), row]) }
  return groups
}
function render() {
  if (!data) return
  const from = $('from').value, to = $('to').value
  const duration = (Date.parse(to) - Date.parse(from)) / 86400000
  if (!from || !to || duration < 0 || duration > 3660) {
    $('error').hidden = false; $('error').textContent = '请选择有效的日期范围（最多 10 年）。'; $('export').disabled = true; return
  }
  $('error').hidden = true
  for (const button of document.querySelectorAll('[data-days]')) {
    button.setAttribute('aria-pressed', String(to === today() && duration === Number(button.dataset.days) - 1))
  }
  const filtered = data.rows.filter(row => row.day >= from && row.day <= to && (!$('version').value || row.version === $('version').value) && (!$('platform').value || row.platform === $('platform').value))
  selected = filtered.filter(row => row.source === 'unknown')
  const totals = sum(selected)
  $('cards').replaceChildren()
  for (const [title, value] of [['下载次数（估算）', totals.sessions], ['完整文件发送', totals.complete], ['下载流量', bytes(totals.bytes)]]) {
    const card = document.createElement('div'); card.className = 'card'
    const label = document.createElement('span'); label.textContent = title
    const number = document.createElement('strong')
    if (typeof value === 'string') {
      const [amount, unit] = value.split(' ')
      number.textContent = amount
      const suffix = document.createElement('small'); suffix.textContent = unit; number.append(suffix)
    } else number.textContent = value
    card.append(label, number); $('cards').append(card)
  }
  $('breakdown').replaceChildren()
  for (const [key, rows] of [...group(selected, row => `${row.version}|${row.platform}`)].sort()) {
    const row = sum(rows); cells($('breakdown'), [...key.split('|'), row.sessions, row.complete, bytes(row.bytes)])
  }
  if (!selected.length) {
    const tr = document.createElement('tr'), td = document.createElement('td')
    td.colSpan = 5; td.className = 'empty'; td.textContent = '所选范围暂无下载'; tr.append(td); $('breakdown').append(tr)
  }
  $('export').disabled = false
}
for (const id of ['from', 'to', 'version', 'platform']) $(id).addEventListener('change', render)
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => range(Number(button.dataset.days)))
$('export').addEventListener('click', () => {
  const fields = ['day', 'version', 'platform', 'source', ...metrics]
  const text = '\uFEFF' + [fields, ...selected.map(row => fields.map(key => row[key]))].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `clawclaw-downloads-${$('from').value}-${$('to').value}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
})
function refresh() { return fetch('stats.json', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw Error('HTTP ' + response.status)
  const serverTime = Date.parse(response.headers.get('date') || '')
  return response.json().then(value => ({ value, serverTime }))
}).then(({ value, serverTime }) => {
  if (value.schema !== 1 || !Array.isArray(value.rows)) throw Error('不支持的统计数据格式')
  const initial = !data
  data = value
  const stale = (Number.isFinite(serverTime) ? serverTime : Date.now()) - Date.parse(data.generatedAt) > 5 * 60000
  const timestamp = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(data.generatedAt))
  $('updated').textContent = `更新于 ${timestamp}${stale ? ' · 数据已超过 5 分钟未更新，请检查汇总任务' : ''}`
  $('updated').title = data.generatedAt
  const existing = new Set(Array.from($('version').options, option => option.value))
  for (const version of [...new Set(data.rows.map(row => row.version))].sort()) { if (existing.has(version)) continue; const option = document.createElement('option'); option.value = version; option.textContent = version; $('version').append(option) }
  if (initial) range(7); else render()
}).catch(error => { $('updated').textContent = '统计数据暂不可用'; $('error').hidden = false; $('error').textContent = `加载失败：${error.message}。请检查定时任务后刷新页面。` }) }
refresh()
setInterval(refresh, 30 * 1000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
