/** Runs only inside the sandbox. Captures native controls and an opt-in JSON state API. */
export const HTML_STATE_RUNTIME = `
let saved=initialState,custom=saved?.custom??null,restoring=true;
const controls=()=>Array.from(document.querySelectorAll('input,select,textarea'));
const allowed=el=>!['password','file','hidden','button','submit','reset','image'].includes(el.type)&&!el.hasAttribute('data-private')&&el.autocomplete!=='off';
const snapshot=()=>{const elements=controls();if(elements.length>100){send('state-error',true);return}return {controls:elements.flatMap((el,index)=>allowed(el)?[{index,value:el.value,...('checked'in el?{checked:el.checked}:{}),...(el instanceof HTMLSelectElement?{selected:Array.from(el.options).flatMap((o,i)=>o.selected?[i]:[])}:{})}]:[]),custom}};
const publish=()=>{if(!restoring){const state=snapshot();if(state)send('state',state)}};
Object.defineProperty(window,'clawclaw',{value:Object.freeze({getState:()=>custom,setState:value=>{custom=JSON.parse(JSON.stringify(value));publish()}})});
addEventListener('input',()=>queueMicrotask(publish),true);addEventListener('change',()=>queueMicrotask(publish),true);
addEventListener('DOMContentLoaded',()=>setTimeout(()=>{
const elements=controls();for(const item of saved?.controls??[]){const el=elements[item.index];if(!el||!allowed(el))continue;el.value=item.value;if(typeof item.checked==='boolean'&&'checked'in el)el.checked=item.checked;if(el instanceof HTMLSelectElement&&item.selected)Array.from(el.options).forEach((o,i)=>o.selected=item.selected.includes(i));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
restoring=false;resize();send('ready',true);
},0));
`
