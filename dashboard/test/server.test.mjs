import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from '../server.mjs';
import { AppError, connectionUriFromSettings, connectionOptions, safeError, collectCapture, readDashboard } from '../database.mjs';

test('connection URI validation and TLS do not read local certificate paths', () => {
  assert.equal(connectionOptions('postgresql://u:secret@localhost/db?sslmode=disable').ssl, false);
  assert.equal(connectionOptions('postgresql://u:secret@db.example/db?sslmode=require').ssl.rejectUnauthorized, true);
  assert.throws(() => connectionOptions('file:///etc/passwd'), AppError);
  assert.throws(() => connectionOptions('postgresql://u:p@host/db?sslkey=/private/key'), AppError);
  assert.throws(() => connectionOptions('postgresql://u:p@host/db?options=foo'), AppError);
  assert(!JSON.stringify(safeError({code:'28P01',message:'secret-password'})).includes('secret-password'));
});

test('connection settings preserve reserved characters and validate host, port and TLS',()=>{
  const settings={host:'::1',port:'5432',database:'a/b ?#%',username:'u@: /%',password:'p@:/?# %雪',sslmode:'disable'};
  const parsed=new pg.Client(connectionOptions(connectionUriFromSettings(settings))).connectionParameters;
  assert.equal(parsed.host,'::1');assert.equal(parsed.port,5432);
  for(const key of ['database','password'])assert.equal(parsed[key],settings[key]);
  assert.equal(parsed.user,settings.username);assert.equal(parsed.ssl,false);
  assert(connectionOptions(connectionUriFromSettings({...settings,host:'[::1]',sslmode:undefined})).ssl.rejectUnauthorized);
  for(const change of [{host:'https://db.example'},{host:'db:5432'},{host:'db/user?sslmode=disable'},{port:'0'},{port:'65536'},{port:'5.5'},{database:''},{username:''},{password:{}},{sslmode:'prefer'}]){
    assert.throws(()=>connectionUriFromSettings({...settings,...change}),AppError);
  }
});

test('local API: sessions, CSRF, host checks, connect/read/collect/disconnect and failure redaction', async t => {
  const calls=[];let closed=0;
  const app=createApp({
    async openDatabase(uri){calls.push(['connect',uri]);if(uri==='bad')throw {code:'28P01',message:'do not expose secret'};return {pool:{async end(){closed++;}},info:{database:'test',advisor_version:'1.0'}};},
    async readDashboard(pool,policy){calls.push(['read',policy]);return {capture:null,history:[]};},
    async collectCapture(pool,policy){calls.push(['collect',policy]);return {capture_key:'captured',recommendation:{action:'MONITOR'}};}
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));await app.dispose();});
  const origin='http://127.0.0.1:'+app.server.address().port;
  const s=await fetch(origin+'/api/session');const cookie=s.headers.get('set-cookie').split(';')[0];const {csrf}=await s.json();
  const headers={'Cookie':cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json','Origin':origin};
  assert.equal((await fetch(origin+'/api/connect',{method:'POST',headers:{'Cookie':cookie,'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(origin+'/api/connect',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
  const wrongHostStatus=await new Promise((resolve,reject)=>{const request=http.get(origin+'/api/session',{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(wrongHostStatus,403);
  assert.equal((await fetch(origin+'/api/connect',{method:'POST',headers,body:JSON.stringify({connectionString:'good'})})).status,200);
  let r=await fetch(origin+'/api/dashboard?policy=custom',{headers});assert.equal(r.status,200);assert.equal(calls.at(-1)[1],'custom');
  r=await fetch(origin+'/api/collect',{method:'POST',headers,body:JSON.stringify({policy:"x'; DROP TABLE y; --"})});assert.equal(r.status,200);assert.equal(calls.at(-1)[1],"x'; DROP TABLE y; --");
  assert.equal((await r.json()).collected,true);
  r=await fetch(origin+'/api/connect',{method:'POST',headers,body:JSON.stringify({connectionString:'bad'})});assert.equal(r.status,502);assert(!(await r.text()).includes('secret'));
  assert.equal((await fetch(origin+'/api/dashboard',{headers})).status,200,'failed reconnect retains previous database');
  const settings={host:'localhost',port:'5432',database:'test',username:'u',password:'p@ss',sslmode:'disable'};
  r=await fetch(origin+'/api/connect',{method:'POST',headers,body:JSON.stringify({settings})});assert.equal(r.status,200);assert.equal(calls.at(-1)[1],connectionUriFromSettings(settings));
  r=await fetch(origin+'/api/connect',{method:'POST',headers,body:JSON.stringify({settings:{...settings,port:'0'}})});assert.equal(r.status,400);
  r=await fetch(origin+'/api/connect',{method:'POST',headers,body:JSON.stringify({settings,connectionString:'good'})});assert.equal(r.status,400);
  r=await fetch(origin+'/api/disconnect',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);assert.equal(closed,2);
  assert.equal((await fetch(origin+'/api/dashboard',{headers})).status,409);
  assert.equal((await fetch(origin+'/.env')).status,404);
  r=await fetch(origin+'/');assert.equal(r.status,200);assert((await r.text()).includes('local.js'));
  r=await fetch(origin+'/help.js');assert.equal(r.status,200);assert((await r.text()).includes('function startTour()'));
});

test('collection interval rejects early capture without invoking advisor; policy is parameterized',async()=>{
  const log=[];let age=40;
  const client={async query(sql,args){log.push({sql,args});if(sql.includes('pg_try_advisory'))return{rows:[{acquired:true}]};if(sql.includes('p.minimum_window_seconds'))return{rows:[{enabled:true,minimum_window_seconds:300,age_seconds:age}]};if(sql.includes('run_advisory_cycle'))return{rows:[{payload:{capture_key:'new'}}]};return{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  await assert.rejects(collectCapture(pool,'default'),/Wait 260 seconds/);assert(!log.some(x=>x.sql.includes('run_advisory_cycle')));assert.equal(log.at(-1).sql,'ROLLBACK');
  age=301;const result=await collectCapture(pool,"not' interpolated");assert.equal(result.capture_key,'new');const q=log.find(x=>x.sql.includes('run_advisory_cycle'));assert.deepEqual(q.args,["not' interpolated"]);assert.equal(q.sql,'SELECT pg_workload_advisor.run_advisory_cycle($1) AS payload');assert.equal(log.at(-1).sql,'COMMIT');
});

test('read-only snapshot scopes data, tolerates missing optional access, ignores older events',async()=>{
  const log=[];let released=false;
  const client={async query(sql,args){log.push({sql,args});
    if(sql.includes('_server_id() AS'))return{rows:[{server_id:'s1',database_oid:42}]};
    if(sql.includes('latest_advice()'))return{rows:[{payload:{capture_key:'latest'}}]};
    if(sql.includes('FROM pg_workload_advisor.advisory_event'))return{rows:[{capture_key:'older',state:'open',action:'REBALANCE_FIRST'}]};
    if(sql.includes('FROM pg_workload_advisor.query_scores()'))throw{code:'42501'};
    return{rows:[]};},release(){released=true;}};
  const result=await readDashboard({async connect(){return client;}},'custom');
  assert.equal(log[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(log.at(-1).sql,'COMMIT');assert(released);assert.equal(result.matchingEvent,null);assert.equal(result.warnings[0].section,'queries');
  for(const q of log.filter(x=>x.sql.includes('WHERE server_id=$1')||x.sql.includes('WHERE e.server_id=$1')||x.sql.includes('WHERE h.server_id=$1')))assert.deepEqual(q.args.slice(0,2),['s1',42]);
  assert(!log.some(x=>x.sql.includes('run_advisory_cycle')||x.sql.includes('reset_stats')));
});
