import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('headline category mapping matches every explicit tag emitted by the extension',async()=>{
  const sql=await readFile(new URL('./fixtures/pg_workload_advisor/pg_workload_advisor--1.0.sql',import.meta.url),'utf8');
  const mappings=[...sql.matchAll(/WHEN '([^']+)' THEN '((?:SCALE_[A-Z_]+|REBALANCE_FIRST|OPTIMIZE_LOCALITY_FIRST|REVIEW)):/g)].map(match=>[match[1],match[2]]);
  assert.equal(mappings.length,8);
  const context=vm.createContext({document:{querySelector(){},addEventListener(){}},location:{hash:''},addEventListener(){}});context.window=context;
  const run=code=>vm.runInContext(code,context);run(await readFile(new URL('../public/app.js',import.meta.url),'utf8'));
  for(const[action,tag]of mappings){
    context.actualAction=action;context.actualTag=tag;
    run('capture=sample();capture.automatedAdvisory=null;capture.recommendation.action=actualAction;capture.recommendation.scale_recommendation=actualTag+": source description";');assert.equal(run('scalingTag()'),tag);
    run('capture=sample();capture.automatedAdvisory={action:actualAction};');assert.equal(run('scalingTag()'),tag);
  }
});

test('live dashboard renders every view and never mixes sample data with missing live sections',async()=>{
  const nodes=new Map();const events={};const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;},focus(){},addEventListener(name,fn){events[key+name]=fn;}});return nodes.get(key);};
  const ctx=vm.createContext({document:{querySelector:node,addEventListener(name,fn){(events[name]??=[]).push(fn);}},history:{replaceState(){}},scrollTo(){},addEventListener(){},location:{hash:''},setTimeout(){return 1;},clearTimeout(){},console,fetch:async()=>({ok:true,json:async()=>({csrf:'test',connected:false})})});ctx.window=ctx;
  const run=s=>vm.runInContext(s,ctx);
  run(await readFile(new URL('../public/app.js',import.meta.url),'utf8'));
  run(await readFile(new URL('../public/help.js',import.meta.url),'utf8'));
  run(await readFile(new URL('../public/local.js',import.meta.url),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));assert(node('#main').innerHTML.includes('Connect your database'));assert(!node('#main').innerHTML.includes('commerce'));
  run(`connected=true;setLiveData({fetchedAt:new Date().toISOString(),capture:sample(),selectedPolicy:{...policy,enabled:true},policies:[policy],history:[],queries:[],events:[],matchingEvent:null,infrastructure:[],outbox:[],calibration:[],warnings:[]});`);
  for(const view of ['overview','workload','resources','distribution','history','policy','contract','help']){run(`navigate('${view}')`);assert(node('#main').innerHTML.length>500);assert(!node('#main').innerHTML.includes('829310478120'));assert(!node('#main').innerHTML.includes('NaN'));}
  run(`liveData.queries=[{queryid:'999',calls:10,total_exec_ms:200,mean_exec_ms:20,query_sample:'<img src=x onerror=alert(1)>',rows_per_call:5,is_cross_node:0}];navigate('workload');`);
  assert(node('#main').innerHTML.includes('999'));assert(!node('#main').innerHTML.includes('<img src=x'));run("showDetail('query-0')");assert(node('#detail-body').innerHTML.includes('999'));
  run(`setLiveData({...liveData,capture:null});render();`);assert(node('#main').innerHTML.includes('No advisor capture yet'));assert(!node('#main').innerHTML.includes('MONITOR'));
  assert.equal(run('typeof window.history.replaceState'),'function');
});
