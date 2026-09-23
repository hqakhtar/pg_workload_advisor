import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {pg_stat_statements} from '@electric-sql/pglite/contrib/pg_stat_statements';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {PGlite as PGlite17} from 'pglite-pg17';
import {createApp} from '../server.mjs';
import {openDatabase,readDashboard,safeError} from '../database.mjs';

// PG17's package contains the native extension bundle but has no convenience export.
const pgss17={name:'pg_stat_statements',setup:async()=>({bundlePath:new URL('./fixtures/pg_stat_statements-pg17.tar.gz',import.meta.url),sharedPreloadLibraries:['pg_stat_statements']})};
const fixture=new URL('./fixtures/pg_workload_advisor.tar.gz',import.meta.url);

test('extension fixtures match the repository source package',async()=>{
  for(const file of ['pg_workload_advisor--1.0.sql','pg_workload_advisor.control']){
    const source=await readFile(new URL('../../'+file,import.meta.url));
    const copy=await readFile(new URL('./fixtures/pg_workload_advisor/'+file,import.meta.url));
    assert.deepEqual(copy,source,file);
  }
});

async function checkDisplayedOutput(data){
  const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',addEventListener(){},showModal(){},focus(){}});return nodes.get(key);};
  const context=vm.createContext({document:{querySelector:node,addEventListener(){}},history:{replaceState(){}},location:{hash:''},addEventListener(){},scrollTo(){},setTimeout(){},clearTimeout(){},fetch:async()=>({ok:true,json:async()=>({connected:false,csrf:'test'})})});context.window=context;
  const run=code=>vm.runInContext(code,context);
  for(const file of ['app.js','help.js','local.js'])run(await readFile(new URL('../public/'+file,import.meta.url),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));context.dashboardResponse=JSON.parse(JSON.stringify(data));run('connected=true;setLiveData(dashboardResponse);');
  assert.deepEqual(JSON.parse(run('JSON.stringify(capture.workload)')),data.capture.workload);
  assert.deepEqual(JSON.parse(run('JSON.stringify(capture.resource)')),data.capture.resource);
  assert.deepEqual(JSON.parse(run('JSON.stringify(capture.window)')),data.capture.window);
  assert.deepEqual(JSON.parse(run('JSON.stringify(capture.recommendation)')),data.capture.recommendation);
  const effectiveAction=data.matchingEvent?.action||data.capture.recommendation.action;
  assert.equal(run('currentAction()'),effectiveAction);
  if(effectiveAction===data.capture.recommendation.action)assert.equal(run('scalingTag()'),data.capture.recommendation.scale_recommendation.split(':')[0]);
  for(const view of ['overview','workload','resources','distribution','history','policy','contract']){run(`navigate('${view}')`);assert(!node('#main').innerHTML.includes('NaN'));assert(!node('#main').innerHTML.includes('undefined'));}
  run("navigate('overview')");assert(node('#main').innerHTML.includes(effectiveAction));assert(node('#main').innerHTML.includes(run('pretty(capture.recommendation.confidence)')+' confidence'));
  run("showDetail('capture')");assert(node('#detail-body').innerHTML.includes(run('esc(JSON.stringify(liveData.capture,null,2))')));
  run("showDetail('pressure')");assert(node('#detail-body').innerHTML.includes('Selected policy: '+data.selectedPolicy.minimum_pressure_samples+' samples'));
}

for(const [major,Engine,pgss] of [[17,PGlite17,pgss17],[18,PGlite,pg_stat_statements]]){
  test(`PostgreSQL ${major}: repository extension through real pg TCP driver and HTTP API`,{timeout:60000},async t=>{
    const db=await Engine.create({extensions:{pg_stat_statements:pgss,pg_workload_advisor:fixture},...(major===17?{startParams:[...Engine.defaultStartParams,'-c','shared_preload_libraries=pg_stat_statements']}:{})});
    const tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:2});
    const app=createApp();let direct;
    t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));await app.dispose();await direct?.pool.end();await tcp.stop();await db.close();});
    assert.equal(Math.floor(Number((await db.query("SELECT current_setting('server_version_num') AS v")).rows[0].v)/10000),major);
    await tcp.start();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const uri=`postgresql://postgres@${tcp.getServerConn()}/postgres?sslmode=disable`;
    const origin='http://127.0.0.1:'+app.server.address().port;
    const s=await fetch(origin+'/api/session');const cookie=s.headers.get('set-cookie').split(';')[0];const {csrf}=await s.json();
    const headers={Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json',Origin:origin};
    const request=async(path,body)=>{const response=await fetch(origin+path,{headers,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
    let result=await request('/api/connect',{connectionString:uri});assert.equal(result.status,409,'missing extension is detected before connected state');
    await db.exec('CREATE SCHEMA "stats-quoted"; CREATE EXTENSION pg_stat_statements SCHEMA "stats-quoted"; CREATE EXTENSION pg_workload_advisor;');
    const metadata=(await db.query("SELECT extnamespace::regnamespace::text AS schema,extrelocatable AS relocatable,obj_description(oid,'pg_extension') AS description FROM pg_extension WHERE extname='pg_workload_advisor'")).rows[0];
    assert.deepEqual(metadata,{schema:'pg_workload_advisor',relocatable:false,description:'PostgreSQL workload, resource-pressure, and scaling advisor with optional Citus telemetry'});
    const address=new URL(uri);
    result=await request('/api/connect',{settings:{host:address.hostname,port:address.port,database:'postgres',username:'postgres',password:'',sslmode:'disable'}});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.database.pgss_schema,'stats-quoted');
    result=await request('/api/dashboard');assert.equal(result.status,200);assert.equal(result.data.capture,null);assert.deepEqual(result.data.warnings,[]);assert.equal(result.data.policies.length,1);
    await db.exec('CREATE TABLE dashboard_probe(id int primary key, value int); INSERT INTO dashboard_probe SELECT i, i*10 FROM generate_series(1,100) i;');
    for(let i=1;i<=8;i++)await db.query('SELECT * FROM dashboard_probe WHERE id=$1',[i]);
    result=await request('/api/collect',{policy:'default'});assert.equal(result.status,200,JSON.stringify(result.data));assert(result.data.collected);assert.equal(result.data.capture.window.blocker,'NO_PRIOR_CAPTURE');
    const baseline=result.data.capture.capture_key;
    const resetBefore=(await db.query('SELECT stats_reset::text FROM "stats-quoted".pg_stat_statements_info')).rows[0].stats_reset;
    result=await request('/api/dashboard');assert.equal(result.data.capture.capture_key,baseline);assert.equal(result.data.history.length,1);assert(result.data.queries.some(q=>q.query_sample.includes('dashboard_probe')));assert.deepEqual(result.data.warnings,[]);
    const scored=result.data.queries.find(q=>q.query_sample.includes('dashboard_probe'));assert.equal(typeof scored.queryid,'string');assert.equal(typeof scored.mean_exec_ms,'number');
    assert.deepEqual(result.data.capture,(await db.query('SELECT pg_workload_advisor.latest_advice() AS payload')).rows[0].payload);await checkDisplayedOutput(result.data);
    await request('/api/dashboard');assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_workload_advisor.capture_history')).rows[0].n,1,'refresh never captures');
    result=await request('/api/collect',{policy:'default'});assert.equal(result.status,409);assert.match(result.data.error,/Wait/);
    result=await request('/api/collect',{policy:"missing'; DROP TABLE dashboard_probe; --"});assert.equal(result.status,400);assert.equal((await db.query('SELECT count(*)::int AS n FROM dashboard_probe')).rows[0].n,100);
    // Test-only short policy: no artificial history records or modified advisor functions.
    await db.exec("UPDATE pg_workload_advisor.advisory_policy SET minimum_window_seconds=0,minimum_pressure_samples=1,minimum_confidence='LOW',connection_utilization_pct=100,waiting_active_pct=100;");
    await db.query("SELECT pg_workload_advisor.ingest_infrastructure_telemetry(p_source=>'integration-test',p_cpu_pct=>98)");
    result=await request('/api/collect',{policy:'default'});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.capture.window.valid,true);assert(result.data.capture.automatedAdvisory.action);
    const evaluated=result.data.capture;
    result=await request('/api/dashboard');assert.deepEqual(result.data.warnings,[]);assert.equal(result.data.matchingEvent.capture_key,evaluated.capture_key);assert.equal(result.data.matchingEvent.action,evaluated.automatedAdvisory.action);assert(result.data.outbox.length>0);assert.equal(result.data.captureTelemetry.cpu_pct,98);await checkDisplayedOutput(result.data);
    await db.query("SELECT pg_workload_advisor.record_feedback($1,'test','improved','isolated integration test')",[evaluated.capture_key]);
    result=await request('/api/dashboard');assert(result.data.calibration.some(r=>r.feedback_count===1&&r.positive_outcome_count===1));
    await db.exec("UPDATE pg_workload_advisor.advisory_policy SET enabled=false;");
    result=await request('/api/collect',{policy:'default'});assert.equal(result.status,409);assert.match(result.data.error,/disabled/);
    await db.exec("UPDATE pg_workload_advisor.advisory_policy SET enabled=true; UPDATE pg_workload_advisor.infrastructure_telemetry SET collected_at=clock_timestamp()-interval '1 hour';");
    result=await request('/api/collect',{policy:'default'});assert.equal(result.status,200);assert.equal(result.data.capture.automatedAdvisory.state,'no_action');
    result=await request('/api/dashboard');assert.equal(result.data.matchingEvent,null);assert.equal(result.data.captureTelemetry,null,'stale CPU is not presented as current capture evidence');assert(result.data.events.every(e=>e.state==='resolved'));
    assert.equal((await db.query('SELECT stats_reset::text FROM "stats-quoted".pg_stat_statements_info')).rows[0].stats_reset,resetBefore,'no app path resets statistics');
    result=await request('/api/disconnect',{});assert.equal(result.status,200);result=await request('/api/dashboard');assert.equal(result.status,409);
    // Actual PostgreSQL privileges are enforced, including partial-section failures.
    await db.exec('CREATE ROLE dashboard_reader; GRANT USAGE ON SCHEMA pg_workload_advisor,"stats-quoted" TO dashboard_reader; GRANT SELECT ON ALL TABLES IN SCHEMA pg_workload_advisor,"stats-quoted" TO dashboard_reader; GRANT pg_read_all_stats TO dashboard_reader; REVOKE SELECT ON pg_workload_advisor.azure_monitor_outbox FROM dashboard_reader;');
    direct=await openDatabase(uri);await direct.pool.query('SET ROLE dashboard_reader');
    let limited=await readDashboard(direct.pool);assert(limited.warnings.some(w=>w.section==='outbox'));
    if(!limited.capture)assert(limited.warnings.some(w=>w.section==='server identity'),'identity mismatch is explained');
    await direct.pool.query('RESET ROLE');
    const noTls=uri.replace('sslmode=disable','sslmode=verify-full');await assert.rejects(openDatabase(noTls),e=>safeError(e).error.includes('does not support TLS'));
  });
}
