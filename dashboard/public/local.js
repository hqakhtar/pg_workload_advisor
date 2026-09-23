'use strict';
let liveData=null,connected=false,sessionToken='',selectedPolicy='default',refreshMode='off',refreshTimer=null,operationBusy=false,liveError='',lastCycle=null;
isSample=false;capture=null;telemetry=null;sourceEvent=null;
const time=value=>value?new Date(value).toLocaleString([], {timeZone:'UTC',hour12:false})+' UTC':'—';
const interval=value=>typeof value==='object'&&value!==null?Object.entries(value).map(([k,v])=>`${v} ${k}`).join(' '):String(value??'—');

async function api(path,body){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-CSRF-Token':sessionToken,...(body!==undefined?{'Content-Type':'application/json'}:{})},credentials:'same-origin',cache:'no-store',...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if(!response.ok){if(response.status===401){connected=false;clearTimeout(refreshTimer);refreshMode='off';}throw Error(result.error||'Request failed.');}return result;
}
function setLiveData(data){
  liveData=data;capture=data.capture?{...data.capture}:null;telemetry=null;sourceEvent=null;isSample=false;
  if(capture){
    if(lastCycle?.capture_key===capture.capture_key)capture.automatedAdvisory=lastCycle.automatedAdvisory;
    const event=data.matchingEvent;
    if(event&&event.capture_key===capture.capture_key){
      sourceEvent=event.payload;const p=event.payload?.data?.pressure||{};
      capture.automatedAdvisory={state:event.state,eventId:event.event_id,policy:event.policy_name,action:event.action,severity:event.severity,sustainedPressure:p.sustained,connectionPressure:p.connection,ratePressure:p.rate,infrastructurePressure:p.infrastructure,sustainedInfrastructurePressure:p.sustainedInfrastructurePressure};
      telemetry=event.payload?.data?.infrastructureTelemetry||null;
    }
    // Infrastructure panel is tied to evidence from the capture, not silently replaced by newer metrics.
    if(!telemetry)telemetry=data.captureTelemetry||null;
    if(telemetry)for(const key of ['cpu_pct','memory_pct','storage_latency_ms','storage_queue_depth','iops_utilization_pct','application_latency_ms','slo_error_pct'])if(telemetry[key]!=null)telemetry[key]=Number(telemetry[key]);
  }
}
function toolbar(){
  const source=`<label for="data-source">Data source</label><select id="data-source" ${operationBusy?'disabled':''}>${connected?'<option value="postgres" selected>PostgreSQL · connected</option><option value="settings">Connection settings…</option>':'<option value="" selected>Choose a data source</option><option value="postgres">PostgreSQL connection…</option>'}</select>`;
  if(!connected)return '<div class="live-toolbar">'+source+'</div>';
  const policies=liveData?.policies||[];
  return `<div class="live-toolbar">${source}<span class="live-state">${operationBusy?'Working…':liveData?'Updated '+esc(time(liveData.fetchedAt)):'Connected'}</span><label for="policy-select">Policy</label><select id="policy-select" ${operationBusy?'disabled':''}>${policies.length?policies.map(p=>`<option value="${esc(p.policy_name)}" ${p.policy_name===selectedPolicy?'selected':''}>${esc(p.policy_name)}</option>`).join(''):'<option>default</option>'}</select><button id="refresh-data" ${operationBusy?'disabled':''}>Refresh data</button><button class="primary" id="collect-data" ${operationBusy?'disabled':''}>Collect & evaluate</button><select id="auto-refresh" aria-label="Automatic refresh" ${operationBusy?'disabled':''}>${[['off','Automatic refresh off'],['read30','Read every 30 seconds'],['read60','Read every minute'],['collect300','Collect every 5 minutes'],['collect900','Collect every 15 minutes']].map(([id,label])=>`<option value="${id}" ${refreshMode===id?'selected':''}>${label}</option>`).join('')}</select><button id="disconnect-data" ${operationBusy?'disabled':''}>Disconnect</button></div>`;
}
function title(){return `<div class="page-title"><div><h1>${view==='overview'?'Scaling overview':NAV.find(n=>n[0]===view)[2]}</h1><p class="sub">${esc(capture.database?.name)} / ${esc(capture.server_id)} · ${capture.workload.citus_installed?'Citus enabled':'PostgreSQL'} · captured ${esc(time(capture.collected_at))}</p></div><button data-detail="capture">Capture details ↗</button></div>`;}
function render(){
  $('#nav').innerHTML=NAV.map(([id,icon,label])=>`<button class="${view===id?'active':''}" data-view="${id}" ${view===id?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join('');
  $('#breadcrumb').textContent=NAV.find(n=>n[0]===view)[2];$('#mode').textContent=connected?'PostgreSQL connected':'Not connected';$('#connection-button').textContent=connected?'Change connection':'Connect PostgreSQL';$('#connection-button').disabled=operationBusy;
  $('#live-controls').innerHTML=toolbar()+(connected?'<p class="collection-note">Refresh reads existing data. Collect & evaluate stores a capture, updates advisory events, and may queue notifications; it does not change cluster capacity.</p>':'');$('#footer-note').textContent='Localhost · credentials in server memory';
  let warnings=liveError?`<div class="live-errors" role="alert">${esc(liveError)}${liveData?' Showing the last successful read; it may be stale.':''}</div>`:'';
  if(liveData?.warnings?.length)warnings+=`<div class="live-errors">${liveData.warnings.map(w=>`<div><b>${esc(pretty(w.section))}:</b> ${esc(w.message)}</div>`).join('')}</div>`;
  if(view==='help'){$('#main').innerHTML=helpPage();return;}
  if(!connected){$('#main').innerHTML=warnings+`<section class="panel connection-panel"><span class="eyebrow">CITUS SCALING ADVISOR</span><h1 style="margin-top:12px">Connect your database</h1><p>Inspect advisor recommendations, query workload, resource pressure and capture history from PostgreSQL.</p><button class="primary" data-connect>Connect PostgreSQL →</button><p class="mini-note">Requires PostgreSQL 17+ with pg_stat_statements and pg_workload_advisor 1.0 installed. Enter connection settings or a URI locally; credentials are never sent to a hosted service.</p></section>`;return;}
  if(!capture){$('#main').innerHTML=warnings+`<section class="panel connection-panel"><h1>No advisor capture yet</h1><p>The connection is ready. Choose <b>Collect & evaluate</b> to run the advisor, or refresh if another process collects snapshots.</p><p>The first capture establishes a baseline. Further captures must respect the policy interval before reset-safe rates and sustained pressure can be calculated.</p><div class="strip neutral">Collecting stores a capture, evaluates policy, updates advisory events, and may enqueue Azure Monitor notifications. It never resets statistics or changes cluster capacity.</div></section>`;return;}
  $('#main').innerHTML=warnings+title()+({overview,workload,resources,distribution,history:historyPage,policy:policyPage,contract}[view])();
}

function trend(metric='cpu'){
  const rows=(metric==='cpu'?(liveData?.infrastructure||[]).map(t=>({at:t.collected_at,value:t.cpu_pct})):(liveData?.history||[]).map(h=>({at:h.collected_at,value:h.payload?.resource?.connection_utilization_pct}))).filter(x=>x.value!=null&&Number.isFinite(Number(x.value))&&Number.isFinite(Date.parse(x.at))).reverse();
  if(rows.length<2)return '<div class="empty">At least two recorded samples are needed for a trend. Missing values are not plotted as zero.</div>';
  const threshold=Number(liveData?.selectedPolicy?.[metric==='cpu'?'cpu_pct':'connection_utilization_pct']??85),first=Date.parse(rows[0].at),span=Math.max(1,Date.parse(rows.at(-1).at)-first);
  const pts=rows.map(x=>`${42+(Date.parse(x.at)-first)/span*546},${190-clamp(x.value)*1.6}`).join(' ');
  return `<svg class="chart" viewBox="0 0 630 225" role="img" aria-label="${metric==='cpu'?'CPU':'Connection utilization'} history">${[0,25,50,75,100].map(v=>`<line x1="42" y1="${190-v*1.6}" x2="607" y2="${190-v*1.6}" stroke="#eef1f7"/><text x="5" y="${194-v*1.6}">${v}%</text>`).join('')}<line x1="42" y1="${190-threshold*1.6}" x2="607" y2="${190-threshold*1.6}" stroke="#caa368" stroke-dasharray="4 5"/><polyline points="${pts}" fill="none" stroke="#477fe0" stroke-width="2.5"/><text x="42" y="215">${esc(new Date(first).toISOString().slice(11,16))}</text><text x="542" y="215">${esc(new Date(rows.at(-1).at).toISOString().slice(11,16))}</text></svg><div class="legend"><span>${rows.length} samples · UTC</span><span>${liveData?.selectedPolicy?'Policy':'Default'} threshold ${threshold}%</span></div>`;
}
function workload(){return baseWorkload();}
function resources(){return baseResources();}
function historyPage(){const rows=liveData.history;return `<section class="panel"><div class="panel-head"><div><h2>Capture history</h2><p>Latest ${rows.length} captures · selected server and database</p></div></div>${table(['Collected','Window','Action','Confidence','Connections'],rows.map(h=>[`<button class="link-button" data-history="${esc(h.capture_key)}">${esc(time(h.collected_at))} ↗</button>`,h.payload?.window?.valid?num(h.payload.window.seconds)+' sec · valid':esc(pretty(h.payload?.window?.blocker||'Invalid')),esc(h.recommended_action),badge(h.recommendation_confidence,'blue'),pct(h.payload?.resource?.connection_utilization_pct)]))}</section><section class="panel" style="margin-top:20px"><div class="panel-head"><div><h2>Observed outcome calibration</h2><p>Feedback scoped to this server and database</p></div></div>${table(['Action','Confidence','Feedback','Positive outcomes'],liveData.calibration.map(r=>[esc(r.recommended_action),esc(r.recommendation_confidence),num(r.feedback_count),r.feedback_count?`${num(r.positive_outcome_count)} (${pct(r.positive_outcome_count/r.feedback_count*100)})`:'No feedback']))}</section>`;}
function policyPage(){const p=liveData.selectedPolicy,e=capture.automatedAdvisory;return `<div class="grid-equal">${panel('Current capture evaluation',e?`<div class="key-value"><span>Policy</span><strong>${esc(e.policy)}</strong></div><div class="key-value"><span>Action</span><code>${esc(e.action||'No action')}</code></div><div class="key-value"><span>State</span>${badge(pretty(e.state))}</div><div class="key-value"><span>Severity</span><strong>${esc(e.severity||'Not provided')}</strong></div><div class="key-value"><span>Sustained pressure</span><strong>${yes(e.sustainedPressure)}</strong></div>`:'<p class="readout">No current policy action is recorded for this exact capture. Historical events below are not applied to the latest advice.</p>')}${panel('Active policy',p?`<p class="readout">${esc(p.policy_name)} · ${p.enabled?'Enabled':'Disabled'}</p>${table(['Setting','Value'],Object.entries(p).filter(([k])=>!['created_at','updated_at','policy_name','min_seconds','telemetry_max_age_seconds'].includes(k)).map(([k,v])=>[esc(pretty(k)),esc(interval(v))]))}`:'<div class="empty">The selected policy is unavailable. Check permissions or choose another policy.</div>')}</div><section class="panel" style="margin-top:20px"><div class="panel-head"><h2>Advisory events</h2></div>${table(['Event','Action','Severity','State','Last seen'],liveData.events.map(r=>[esc(r.event_id),esc(r.action),badge(r.severity,r.severity==='CRITICAL'?'red':'amber'),esc(r.state),esc(time(r.last_seen_at))]))}</section><section class="panel" style="margin-top:20px"><div class="panel-head"><h2>Azure Monitor delivery</h2></div>${table(['Outbox','Event type','Status','Attempts','Delivered'],liveData.outbox.map(r=>[esc(r.outbox_id),esc(r.event_type),esc(r.status),num(r.attempts),esc(time(r.delivered_at))]))}</section>`;}
function contract(){return panel('Local PostgreSQL integration',`<p class="readout">The Node.js server owns the database connection. Dashboard reads run in a read-only transaction. Collection is a separate, explicit write operation.</p>${table(['Control / view','SQL source'],[['Refresh data','latest_advice(), capture_history, query_scores(), advisory_policy, advisory_event, infrastructure_telemetry, azure_monitor_outbox and scoped feedback aggregation'],['Collect & evaluate','run_advisory_cycle($1)'],['Automatic read refresh','Same read-only queries; never creates captures'],['Automatic collection','run_advisory_cycle($1), respecting minimum_window_seconds'],['Statistics reset','Never called'],['Extension installation / regression scripts','Never run by the app']])}<p class="readout">Read operations use the connected server and database. An event affects the advice only when its capture key matches the latest capture and its policy matches the selected policy. Historical events remain visible in the policy view.</p><p class="mini-note">CPU, memory and storage metrics require an external collector to populate infrastructure_telemetry. PostgreSQL connections do not supply OS telemetry automatically.</p>`);}

function scheduleRefresh(){clearTimeout(refreshTimer);if(!connected||refreshMode==='off')return;let seconds=refreshMode==='read30'?30:refreshMode==='read60'?60:refreshMode==='collect300'?300:900;if(refreshMode.startsWith('collect'))seconds=Math.max(seconds,Number(liveData?.selectedPolicy?.minimum_window_seconds||300)+2);refreshTimer=setTimeout(()=>refreshData(refreshMode.startsWith('collect')),seconds*1000);}
async function refreshData(collect=false){
  if(operationBusy||!connected)return;operationBusy=true;liveError='';render();
  try{if(collect){const result=await api('/api/collect',{policy:selectedPolicy});lastCycle=result.capture;}const data=await api('/api/dashboard?policy='+encodeURIComponent(selectedPolicy));setLiveData(data);}catch(error){liveError=error.message;}finally{operationBusy=false;render();scheduleRefresh();}
}
function clearConnectionSecrets(){for(const id of ['pg-password','connection-uri','ca-cert'])$('#'+id).value='';}
function configureConnectionForm(){
  const hosted=!!globalThis.ADVISOR_HOSTED_PREVIEW,uri=$('#connection-method').value==='uri';
  $('#connection-fields').hidden=uri;$('#connection-fields').disabled=uri;
  $('#connection-uri-fields').hidden=!uri;$('#connection-uri-fields').disabled=!uri||hosted;
  $('#pg-password').disabled=hosted;$('#connection-uri').disabled=hosted;$('#ca-cert').disabled=hosted;
  $('#connection-preview-note').hidden=!hosted;$('#connection-privacy-note').hidden=hosted;
  $('#connect-submit').disabled=hosted||operationBusy;
  $('#connect-submit').textContent=hosted?'Requires PostgreSQL mode':operationBusy?'Connecting…':'Connect & load data';
}
function openConnection(){
  if(operationBusy)return;
  $('#connection-error').textContent='';configureConnectionForm();$('#connection-dialog').showModal();
  $(globalThis.ADVISOR_HOSTED_PREVIEW&&$('#connection-method').value==='uri'?'#connection-method':$('#connection-method').value==='uri'?'#connection-uri':'#pg-host').focus();
}
$('#connection-dialog').addEventListener('close',clearConnectionSecrets);
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='connection-button'||button.hasAttribute('data-connect'))openConnection();
  if(button.id==='refresh-data')await refreshData(false);
  if(button.id==='collect-data')await refreshData(true);
  if(button.id==='disconnect-data'&&!operationBusy){operationBusy=true;clearTimeout(refreshTimer);try{await api('/api/disconnect',{});connected=false;liveData=null;capture=null;telemetry=null;sourceEvent=null;lastCycle=null;refreshMode='off';liveError='';}catch(e){liveError=e.message;}finally{operationBusy=false;render();}}
  if(button.dataset.history){const row=liveData.history.find(r=>r.capture_key===button.dataset.history);if(row){$('#detail-title').textContent='Historical capture';$('#detail-body').innerHTML=`<pre>${esc(JSON.stringify(row.payload,null,2))}</pre>`;$('#detail').showModal();}}
});
document.addEventListener('change',event=>{if(event.target.id==='connection-method'){clearConnectionSecrets();configureConnectionForm();}if(event.target.id==='data-source'&&event.target.value){openConnection();render();}if(event.target.id==='auto-refresh'){refreshMode=event.target.value;scheduleRefresh();render();}if(event.target.id==='policy-select'){selectedPolicy=event.target.value;lastCycle=null;void refreshData(false);}});
$('#connection-form').addEventListener('submit',async event=>{
  event.preventDefault();if(operationBusy||globalThis.ADVISOR_HOSTED_PREVIEW)return;
  operationBusy=true;clearTimeout(refreshTimer);configureConnectionForm();$('#connection-error').textContent='';
  const body={ca:$('#ca-cert').value};
  if($('#connection-method').value==='uri')body.connectionString=$('#connection-uri').value;
  else body.settings={host:$('#pg-host').value,port:$('#pg-port').value,database:$('#pg-database').value,username:$('#pg-username').value,password:$('#pg-password').value,sslmode:$('#pg-tls').value};
  clearConnectionSecrets();let succeeded=false;
  try{await api('/api/connect',body);succeeded=true;connected=true;liveData=null;capture=null;sourceEvent=null;telemetry=null;lastCycle=null;selectedPolicy='default';liveError='';refreshMode='off';$('#connection-dialog').close();}catch(error){$('#connection-error').textContent=error.message;}finally{operationBusy=false;configureConnectionForm();render();}
  if(succeeded)await refreshData();else scheduleRefresh();
});
configureConnectionForm();
render();
if(!globalThis.ADVISOR_HOSTED_PREVIEW)(async()=>{try{const session=await api('/api/session');sessionToken=session.csrf;connected=session.connected;if(connected)await refreshData();else render();}catch(e){liveError='Local server unavailable: '+e.message;render();}})();
