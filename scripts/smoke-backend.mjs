import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'clawclaw-tauri-smoke-'));
await mkdir(join(directory, 'data'));
await writeFile(join(directory, 'data', 'settings.json'), JSON.stringify({ gatewayAutoStart: false, autoCheckUpdate: false, setupComplete: true }));
const child = spawn(process.execPath, ['dist-backend/entry.mjs'], { windowsHide: true, env: { ...process.env, CLAWCLAW_APP_ROOT: process.cwd(), CLAWCLAW_DATA_DIR: join(directory, 'data') }, stdio: ['pipe', 'pipe', 'pipe'] });
let counter = 0;
const pending = new Map();
const logs = [];
child.stderr.on('data', data => { logs.push(data.toString()); });
let readyResolve, readyReject;
const ready = new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
const exited = new Promise(resolve=>child.on('exit', (code)=>{readyReject(new Error(`Backend exited (${code})\n${logs.join('')}`));resolve(code);}));
createInterface({input:child.stdout}).on('line', line=>{
 const message=JSON.parse(line);
 if(message.type==='ready')readyResolve();
 if(message.type==='native')child.stdin.write(JSON.stringify({type:'native_result',id:message.id,data:null})+'\n');
 if(message.type==='response'){const p=pending.get(message.id);pending.delete(message.id);if(p){if(message.error)p.reject(Error(message.error));else p.resolve(message.data);}}
});
function request(channel,...args){const id=String(++counter);return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({type:'request',id,channel,args})+'\n');});}
const deadline=setTimeout(()=>{ console.error(logs.join(''));child.kill(); process.exitCode=1; },60_000);
try {
 await ready;
 assert.equal(await request('app:version'),'0.1.23');
 const settings=await request('settings:getAll');assert.equal(settings.setupComplete,true);
 const savedProvider=await request('provider:save',{id:'smoke-provider',vendorId:'openai',label:'Smoke provider',authMode:'api_key',model:'gpt-4.1-mini',enabled:true,isDefault:true});
 assert.equal(savedProvider.id,'smoke-provider');
 await request('provider:setApiKey','smoke-provider','smoke-key');
 assert.equal(await request('provider:hasApiKey','smoke-provider'),true);
 const unified=await request('app:request',{module:'provider',action:'list'});assert.equal(unified.ok,true);assert.equal(unified.data.length,1);
 const coreRun=await request('core:run:create',{workspaceId:'smoke',conversationId:'conversation',agentId:'agent',source:'chat',idempotencyKey:'smoke-run'});
 assert.equal(coreRun.created,true);assert.equal(coreRun.run.status,'queued');
 const coreRetry=await request('core:run:create',{workspaceId:'smoke',conversationId:'conversation',agentId:'agent',source:'chat',idempotencyKey:'smoke-run'});
 assert.equal(coreRetry.created,false);assert.equal(coreRetry.run.id,coreRun.run.id);
 const events=await request('core:run:getEvents',coreRun.run.id);assert.equal(events[0].type,'run.started');
 const cancelled=await request('core:run:cancel',coreRun.run.id);assert.equal(cancelled.status,'cancelled');
 await assert.rejects(request('unregistered:command'));
 console.log('PASS: standalone ClawCore readiness, SQLite run persistence, settings, provider catalog, unified IPC authorization, unknown command rejection');
} finally {
 child.stdin.write(JSON.stringify({type:'shutdown'})+'\n');
 const code=await exited;clearTimeout(deadline);assert.equal(code,0);
 console.log('PASS: graceful backend shutdown');
}
