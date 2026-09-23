import {readFile} from 'node:fs/promises';
import {openDatabase,readDashboard,collectCapture,safeError} from './database.mjs';

// Uses the application's actual connection and query functions. Read-only by default.
const uri=process.env.ADVISOR_DATABASE_URL;
if(!uri){console.error('Set ADVISOR_DATABASE_URL to your PostgreSQL URI. Optionally set ADVISOR_CA_FILE and ADVISOR_POLICY. Add --collect only when you want a real advisory cycle to write capture/event records.');process.exitCode=1;}
else{
  let connection;
  try{
    const ca=process.env.ADVISOR_CA_FILE?await readFile(process.env.ADVISOR_CA_FILE,'utf8'):'';
    connection=await openDatabase(uri,ca);
    const policy=process.env.ADVISOR_POLICY||'default';
    let collected=null;if(process.argv.includes('--collect'))collected=await collectCapture(connection.pool,policy);
    const data=await readDashboard(connection.pool,policy);
    console.log(JSON.stringify({connected:true,postgresVersion:connection.info.version,extensionVersion:connection.info.advisor_version,policy,collectionRequested:!!collected,captureAvailable:!!data.capture,captureAction:data.capture?.recommendation.action??null,policyAction:collected?.automatedAdvisory?.action??data.matchingEvent?.action??null,rows:{history:data.history.length,queries:data.queries.length,events:data.events.length,infrastructure:data.infrastructure.length,outbox:data.outbox.length,calibration:data.calibration.length},warnings:data.warnings},null,2));
    if(data.warnings.length)process.exitCode=2;
  }catch(error){console.error(safeError(error).error);process.exitCode=1;}
  finally{await connection?.pool.end();}
}
