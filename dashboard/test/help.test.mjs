import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {demoHTML} from '../demo.mjs';
const hostedAvailable=true;

async function dashboard({hosted=false,seen=false,hash='',storageUnavailable=false,fetchImpl}={}){
  const nodes=new Map(),events={},saved=new Map(seen?[['pg-workload-advisor-tour-v1','seen']]:[]);let fetchCount=0;
  const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',disabled:false,open:false,value:'',showModal(){this.open=true;},close(){this.open=false;},focus(){},addEventListener(name,fn){(events[key+name]??=[]).push(fn);}});return nodes.get(key);};
  const ctx=vm.createContext({document:{body:{dataset:{}},querySelector:node,addEventListener(name,fn){(events[name]??=[]).push(fn);}},history:{replaceState(){}},location:{hash},scrollTo(){},addEventListener(){},setTimeout(){return 1;},clearTimeout(){},console,localStorage:{getItem(k){if(storageUnavailable)throw Error('disabled');return saved.get(k);},setItem(k,v){if(storageUnavailable)throw Error('disabled');saved.set(k,v);}},fetch:async(...args)=>{fetchCount++;if(hosted)throw Error('Hosted preview must never request a backend');if(fetchImpl)return fetchImpl(...args);return{ok:true,json:async()=>({csrf:'test',connected:false})};}});ctx.window=ctx;
  const run=s=>vm.runInContext(s,ctx);
  const files=hosted?['../public/demo-config.js','../public/app.js','../public/help.js','../public/local.js','../public/demo.js']:['../public/app.js','../public/help.js','../public/local.js'];
  for(const file of files)run(await readFile(new URL(file,import.meta.url),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  const emit=async(name,event={})=>{for(const fn of events[name]||[])await fn(event);};
  const click=async attr=>emit('click',{target:{closest:()=>({id:'',dataset:{},hasAttribute:name=>name===attr})}});
  await emit('DOMContentLoaded');return{node,run,click,emit,saved,fetches:()=>fetchCount};
}

test('first visit opens tour; next/back, skip, Escape and restart preserve the original page',async()=>{
  const d=await dashboard();assert(d.node('#tour-dialog').open);assert(d.node('#tour-step').textContent.includes('1 OF 9'));assert(d.node('#tour-back').disabled);
  await d.click('data-tour-next');assert.equal(d.run('tourIndex'),1);
  await d.click('data-tour-back');assert.equal(d.run('tourIndex'),0);
  for(let i=0;i<8;i++){await d.click('data-tour-next');assert.equal(d.run('view'),d.run(`TOUR_STEPS[${i+1}].view`));}
  assert.equal(d.node('#tour-next').textContent,'Finish tour');assert(d.node('#tour-body').innerHTML.includes('Connect PostgreSQL'));
  await d.click('data-tour-next');assert(!d.node('#tour-dialog').open);assert.equal(d.run('view'),'overview');assert.equal(d.saved.get('pg-workload-advisor-tour-v1'),'seen');assert.equal(d.run('document.body.dataset.tourFocus'),undefined);
  d.run("navigate('help')");assert(d.node('#main').innerHTML.includes('From advice to understanding'));
  await d.click('data-tour-start');await d.click('data-tour-next');await d.emit('#tour-dialogcancel',{preventDefault(){}});assert.equal(d.run('view'),'help');assert(!d.node('#tour-dialog').open);
  await d.click('data-tour-start');await d.click('data-tour-close');assert.equal(d.run('view'),'help');assert.equal(d.fetches(),1);
});

test('tour preference, unavailable storage and disconnected Help route work without database data',async()=>{
  const d=await dashboard({seen:true,hash:'#help'});assert(!d.node('#tour-dialog').open);assert(d.node('#main').innerHTML.includes('local PostgreSQL app'));
  await d.click('data-tour-start');assert(d.node('#tour-body').innerHTML.includes('after you connect'));
  for(let i=0;i<8;i++)await d.click('data-tour-next');assert(d.node('#tour-body').innerHTML.includes('Refresh data reads saved records'));
  await d.click('data-tour-close');assert.equal(d.run('view'),'help');assert.equal(d.fetches(),1,'tour and help never initiate reads or writes');
  const seen=await dashboard({seen:true});assert(!seen.node('#tour-dialog').open);
  const restricted=await dashboard({storageUnavailable:true});assert(restricted.node('#tour-dialog').open);await restricted.click('data-tour-close');assert(!restricted.node('#tour-dialog').open);
});

test('local demo preserves scenarios, import isolation, every route and one relevant headline tag',{skip:!hostedAvailable},async()=>{
  const d=await dashboard({hosted:true});assert(d.node('#tour-dialog').open);d.run('showTourStep(8)');assert(d.node('#tour-body').innerHTML.includes('local demo'));await d.click('data-tour-close');
  for(const scenario of ['scale','pool','rebalance','locality','reset']){
    await d.emit('change',{target:{id:'preview-scenario',value:scenario}});
    for(const view of ['overview','workload','resources','distribution','history','policy','contract','help']){d.run(`navigate('${view}')`);assert(d.node('#main').innerHTML.length>400);assert(!d.node('#main').innerHTML.includes('NaN'));}
    assert(!d.run('hero()').includes('WARNING'));assert(!d.run('hero()').includes('extension-tag-list'));
  }
  d.run("importJSON(JSON.stringify(sample('locality')))");assert.equal(d.run('previewMode'),'imported');assert.equal(d.run('liveData.history.length'),0);assert.equal(d.run('liveData.queries.length'),0);
  d.run("navigate('workload')");assert(!d.node('#main').innerHTML.includes('829310478120'));d.run("navigate('help')");assert(d.node('#main').innerHTML.includes('local demo'));
  d.run('restore()');assert.equal(d.run('isSample'),true);assert.equal(d.fetches(),0);
  const html=demoHTML(await readFile(new URL('../public/index.html',import.meta.url),'utf8'));assert(!html.includes('id="start-tour"'));assert(html.includes('tour-dialog'));
  for(const id of ['connection-uri','pg-password','ca-cert'])assert(html.includes('id="'+id+'" disabled'));
  assert(d.node('#live-controls').innerHTML.includes('PostgreSQL connection'));
  const original=d.run('capture.capture_key');
  await d.emit('change',{target:{id:'preview-scenario',value:'postgres'}});
  assert(d.node('#connection-dialog').open);assert(!d.node('#connection-preview-note').hidden);assert(d.node('#connect-submit').disabled);
  assert.equal(d.run('capture.capture_key'),original);assert.equal(d.run('previewMode'),'sample');
  await d.emit('#connection-formsubmit',{preventDefault(){}});assert.equal(d.fetches(),0);
  d.node('#connection-method').value='uri';await d.emit('change',{target:{id:'connection-method'}});
  assert(d.node('#connection-uri-fields').disabled);assert(d.node('#connection-uri').disabled);
});

test('connection form submits fields or URI, clears secrets, loads live data and preserves a working connection on error',async()=>{
  const requests=[];let rejectConnect=false;
  const d=await dashboard({seen:true,fetchImpl:async(path,options)=>{
    requests.push({path,options});
    if(path==='/api/session')return{ok:true,json:async()=>({csrf:'test',connected:false})};
    if(path==='/api/connect')return{ok:!rejectConnect,status:rejectConnect?502:200,json:async()=>rejectConnect?{error:'PostgreSQL rejected the username or password.'}:{connected:true}};
    return{ok:true,json:async()=>({capture:null,policies:[],warnings:[],fetchedAt:'2026-09-21T00:00:00Z'})};
  }});
  await d.emit('change',{target:{id:'data-source',value:'postgres'}});assert(d.node('#connection-dialog').open);
  const settings={host:'db.example',port:'5432',database:'analytics',username:'advisor',password:'p@:/?# %',sslmode:'verify-full'};
  for(const [key,value]of Object.entries(settings))d.node('#pg-'+(key==='sslmode'?'tls':key)).value=value;
  await d.emit('#connection-formsubmit',{preventDefault(){}});
  assert.deepEqual(JSON.parse(requests.find(r=>r.path==='/api/connect').options.body),{settings,ca:''});
  assert.equal(d.node('#pg-password').value,'');assert(!d.node('#connection-dialog').open);
  assert(requests.at(-1).path.startsWith('/api/dashboard'));assert(d.node('#live-controls').innerHTML.includes('PostgreSQL · connected'));
  assert(d.node('#main').innerHTML.includes('No advisor capture yet'));
  rejectConnect=true;
  await d.emit('change',{target:{id:'data-source',value:'settings'}});
  d.node('#connection-method').value='uri';d.node('#pg-password').value='clear-on-switch';
  await d.emit('change',{target:{id:'connection-method'}});
  assert(d.node('#connection-fields').disabled);assert(!d.node('#connection-uri-fields').disabled);assert.equal(d.node('#pg-password').value,'');
  const uri='postgresql://u:p%40%3A@host/db?sslmode=disable';d.node('#connection-uri').value=uri;
  await d.emit('#connection-formsubmit',{preventDefault(){}});
  assert.deepEqual(JSON.parse(requests.at(-1).options.body),{connectionString:uri,ca:''});
  assert.equal(d.node('#connection-uri').value,'');assert(d.node('#connection-dialog').open);assert(d.node('#connection-error').textContent.includes('rejected'));assert(d.run('connected'));
  d.node('#pg-password').value='clear-on-close';await d.emit('#connection-dialogclose');assert.equal(d.node('#pg-password').value,'');
  assert.equal(d.saved.size,1,'only the existing tour preference is stored');
});
