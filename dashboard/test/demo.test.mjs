import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo.mjs';

test('demo mode serves every asset with no database API or dependency installation',async t=>{
  const server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin='http://127.0.0.1:'+server.address().port;
  let response=await fetch(origin);assert.equal(response.status,200);
  const html=await response.text();
  assert(html.includes('<title>PG Workload Advisor</title>'));
  assert(html.includes('pg_workload_advisor · PostgreSQL 17+'));
  assert(html.indexOf('demo-config.js')<html.indexOf('app.js'));assert(html.indexOf('demo.js')>html.indexOf('local.js'));
  for(const id of ['pg-password','connection-uri','ca-cert'])assert(html.includes('id="'+id+'" disabled'));
  for(const [,asset]of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)){
    response=await fetch(origin+'/'+asset);assert.equal(response.status,200,asset);assert((await response.text()).length>0);
  }
  assert.equal((await fetch(origin+'/api/session')).status,404);
  assert.equal((await fetch(origin+'/api/connect',{method:'POST',body:'{}'})).status,405);
  assert.equal((await fetch(origin+'/server.mjs')).status,404);
  assert.equal((await fetch(origin+'/.env')).status,404);
  assert.equal((await fetch(origin,{method:'HEAD'})).status,200);
});
