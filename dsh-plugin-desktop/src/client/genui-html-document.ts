import type { GenuiHtmlState } from '../genui-state-contract.ts'
import { HTML_STATE_RUNTIME } from './genui-html-state-runtime.ts'
/** Original, self-contained runtime; no executable content is inserted into the host DOM. */
export const GENUI_HTML_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
export const GENUI_HTML_CHANNEL = 'clawclaw:html-preview/v1'
const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

export function createGenuiHtmlDocument(html: string, options: { dark: boolean; zh: boolean; state?: GenuiHtmlState | null; standalone?: boolean; title?: string }): string {
  const { dark, zh } = options
  // CSP precedes all untrusted markup and cannot be relaxed by another meta policy.
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(GENUI_HTML_CSP)}"><meta name="referrer" content="no-referrer"><meta http-equiv="x-dns-prefetch-control" content="off"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(options.title ?? '')}</title><style>
:root{color-scheme:${dark ? 'dark' : 'light'};--bg:${dark ? '#202020' : '#f5f6f8'};--text:${dark ? '#f0f0f0' : '#262626'};--muted:${dark ? '#bfbfbf' : '#595959'};--border:${dark ? '#595959' : '#d9d9d9'};--accent:${dark ? '#69b1ff' : '#1668dc'}}
*{box-sizing:border-box}html{background:transparent}body{margin:0;padding:4px;color:var(--text);font:14px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}h1,h2,h3,p{margin:0 0 12px}h1,h2,h3{font-size:16px}button,input,select,textarea{font:inherit;color:inherit}button,select,input,textarea{max-width:100%;border:1px solid var(--border);border-radius:6px;background:var(--bg);padding:6px 10px}button{cursor:pointer;min-height:34px}input[type=range]{padding:0;accent-color:var(--accent)}button:hover{border-color:var(--accent)}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}label{display:block;margin-bottom:8px}svg,canvas,img{max-width:100%}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)}.muted{color:var(--muted)}.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.card{padding:12px;background:var(--bg);border-radius:8px}output{font-variant-numeric:tabular-nums}
</style><script>
(()=>{const initialState=${JSON.stringify(options.state ?? null).replaceAll('<', '\\u003c')};const send=${options.standalone ? '()=>{}' : `(type,value)=>parent.postMessage({channel:'${GENUI_HTML_CHANNEL}',type,value},'*')`};let pending=false;
const resize=()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;send('height',Math.max(120,document.body?.scrollHeight||0))})};
addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!=='${GENUI_HTML_CHANNEL}'||event.data.type!=='theme')return;const dark=event.data.value===true;const root=document.documentElement;root.style.colorScheme=dark?'dark':'light';for(const [key,value] of Object.entries(dark?{'--bg':'#202020','--text':'#f0f0f0','--muted':'#bfbfbf','--border':'#595959','--accent':'#69b1ff'}:{'--bg':'#f5f6f8','--text':'#262626','--muted':'#595959','--border':'#d9d9d9','--accent':'#1668dc'}))root.style.setProperty(key,value)});
addEventListener('error',()=>send('error',true));addEventListener('unhandledrejection',()=>send('error',true));
${HTML_STATE_RUNTIME}
addEventListener('DOMContentLoaded',()=>{new ResizeObserver(resize).observe(document.body);resize()});
// Links remain local controls. Electron separately blocks programmatic frame navigation.
addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('a[href]'))event.preventDefault()},true);
addEventListener('submit',event=>event.preventDefault(),true);
})();
</script></head><body>${html}</body></html>`
}

export function genuiHtmlDownloadName(title: string): string {
  const base = title.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-').replace(/\.html$/i, '')
    .replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || 'visualization'
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `visualization-${base}` : base}.html`
}
