import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pg_stat_statements} from '@electric-sql/pglite/contrib/pg_stat_statements';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {openDatabase,readDashboard,safeError} from '../database.mjs';

let openssl=true;try{execFileSync('openssl',['version'],{stdio:'ignore'});}catch{openssl=false;}
test('pg driver: TLS succeeds with a trusted matching certificate and rejects untrusted or mismatched certificates',{skip:!openssl,timeout:30000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'advisor-tls-'));const keyPath=join(directory,'key.pem'),certPath=join(directory,'cert.pem');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=advisor-isolated-test','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath],{stdio:'ignore'});
  const key=await readFile(keyPath),cert=await readFile(certPath,'utf8');
  const db=await PGlite.create({extensions:{pg_stat_statements,pg_workload_advisor:new URL('./fixtures/pg_workload_advisor.tar.gz',import.meta.url)}});
  await db.exec('CREATE EXTENSION pg_stat_statements; CREATE EXTENSION pg_workload_advisor;');
  const tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:3});await tcp.start();
  const sockets=new Set();const secureContext=tls.createSecureContext({key,cert});
  const proxy=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let initial=Buffer.alloc(0);
    const upgrade=chunk=>{
      initial=Buffer.concat([initial,chunk]);if(initial.length<8)return;
      socket.removeListener('data',upgrade);
      if(initial.readInt32BE(0)!==8||initial.readInt32BE(4)!==80877103){socket.destroy();return;}
      socket.write('S');
      const secure=new tls.TLSSocket(socket,{isServer:true,secureContext});secure.on('error',()=>secure.destroy());
      secure.once('secure',()=>{
        const port=Number(tcp.getServerConn().split(':').at(-1));const upstream=net.connect({host:'127.0.0.1',port});
        sockets.add(upstream);upstream.on('close',()=>{sockets.delete(upstream);secure.destroy();});upstream.on('error',()=>secure.destroy());secure.on('close',()=>upstream.destroy());secure.pipe(upstream).pipe(secure);
      });
    };socket.on('data',upgrade);
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));await tcp.stop();await db.close();});
  const uri=`postgresql://postgres@127.0.0.1:${proxy.address().port}/postgres?sslmode=verify-full`;
  await assert.rejects(openDatabase(uri),error=>/certificate/.test(safeError(error).error));
  const connected=await openDatabase(uri,cert);try{const result=await readDashboard(connected.pool);assert.equal(result.capture,null);assert.deepEqual(result.warnings,[]);}finally{await connected.pool.end();}
  const order=dns.getDefaultResultOrder();dns.setDefaultResultOrder('ipv4first');
  try{await assert.rejects(openDatabase(uri.replace('127.0.0.1','localhost'),cert),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID');}finally{dns.setDefaultResultOrder(order);}
});
