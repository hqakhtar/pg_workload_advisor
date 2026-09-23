'use strict';
const TOUR_SEEN_KEY='pg-workload-advisor-tour-v1';
const GUIDE_SECTIONS=[
  ['overview','◫','Start with the recommendation','See the scaling advice, its relevant extension tag, confidence and the reasons behind it.'],
  ['workload','≋','Understand your workload','Explore analytical, hybrid and transactional workload shares, then inspect individual query fingerprints.'],
  ['resources','▥','Find resource pressure','Compare observed connections, activity and valid interval rates with the selected policy thresholds.'],
  ['distribution','◇','Check balance and locality','See whether uneven shard bytes or cross-node execution should be addressed before adding capacity.'],
  ['history','◷','Look beyond one snapshot','Review captured intervals, past recommendations and recorded outcome feedback.'],
  ['policy','☷','Follow the policy decision','Inspect policy thresholds, advisory events, their severity and notification delivery status.'],
  ['contract','⌘','Trace the SQL sources','Map each view and control to the extension functions and tables that supply its evidence.']
];
function helpPage(){
  const hosted=!!globalThis.ADVISOR_HOSTED_PREVIEW;
  return `<section class="help-hero"><div><span class="eyebrow">HELP & GUIDE</span><h1>From advice to understanding.</h1><p>Start with the recommendation. Follow the evidence when you want to know why. This guide helps you get comfortable with every part of the PG Workload Advisor.</p><button class="primary" data-tour-start>Take the guided tour <span aria-hidden="true">→</span></button><span class="help-duration">9 short steps · about 2 minutes</span></div><div class="help-hero-art" aria-hidden="true"><span>OBSERVE</span><i></i><span>UNDERSTAND</span><i></i><span>DECIDE</span></div></section>
  <div class="help-mode"><span class="help-mode-icon" aria-hidden="true">ⓘ</span><div><strong>${hosted?'You’re exploring the local demo':'You’re using the local PostgreSQL app'}</strong><p>${hosted?'Switch sample scenarios or import your advisor JSON. Run npm start in this dashboard folder to enable PostgreSQL connections and collection; demo mode does not connect to a database.':'Choose PostgreSQL connection in Data source, then enter your host, port, database, username, password and TLS settings, or a connection URI. PostgreSQL 17+, pg_stat_statements and pg_workload_advisor 1.0 must already be installed. The app does not install extensions.'}</p></div></div>
  <section aria-labelledby="guide-sections-title"><div class="help-section-heading"><h2 id="guide-sections-title">Find your way around</h2><span>Choose a section to explore it</span></div><div class="help-section-grid">${GUIDE_SECTIONS.map(([id,icon,title,description])=>`<button class="help-section-card" data-view="${id}"><span class="help-card-icon" aria-hidden="true">${icon}</span><span><small>${esc(NAV.find(n=>n[0]===id)[2])}</small><strong>${title}</strong><span>${description}</span></span><span class="help-card-arrow" aria-hidden="true">↗</span></button>`).join('')}</div></section>
  <div class="help-reading-grid"><section class="panel help-reading"><span class="eyebrow">READING THE ADVICE</span><h2>Three things to check first</h2><ol class="help-checks"><li><strong>The action and its tag</strong><p>The headline explains the recommended action. Its single relevant category tag may be SCALE_OUT, REBALANCE_FIRST, OPTIMIZE_LOCALITY_FIRST or another applicable extension category.</p></li><li><strong>Confidence and coverage</strong><p>HIGH, MEDIUM or LOW is the extension’s confidence. Telemetry coverage is a separate completeness score, not the probability that scaling will succeed.</p></li><li><strong>The evidence behind it</strong><p>Open “Why this advice?” to trace the decision, then inspect the values and SQL sources. A matching policy evaluation can refine the capture recommendation.</p></li></ol><p class="help-footnote">Advice identifies a candidate action. Version 1.0 does not calculate an exact worker count, cost or predicted performance gain.</p></section>
  <section class="panel help-reading"><span class="eyebrow">KEEPING DATA CURRENT</span><h2>Refresh or collect?</h2><div class="help-control"><strong>Refresh data</strong><p>Reads the latest saved advice and supporting rows. It does not create a new capture.</p><span class="badge blue">Read only</span></div><div class="help-control"><strong>Collect & evaluate</strong><p>Runs an advisory cycle, stores a capture, updates events and may queue notifications. It does not change cluster capacity.</p><span class="badge">Writes advisor records</span></div><div class="help-control"><strong>Automatic refresh</strong><p>Choose periodic reads or collection in the local app. Collection respects the selected policy’s minimum interval.</p></div>${hosted?'<p class="help-footnote">These database controls are disabled in this local demo. Imported data is a snapshot and will not refresh itself.</p>':''}</section></div>
  <section class="panel help-faq" aria-labelledby="guide-faq-title"><div class="panel-head"><h2 id="guide-faq-title">A few useful answers</h2></div><div class="panel-body">
  <details><summary>Where did the warning badge go?</summary><p>The headline shows the relevant scaling tag and confidence. Event severity, such as WARNING, belongs in <b>Policy & events</b>; it describes an event’s urgency, not a separate scaling recommendation.</p></details>
  <details><summary>Why are some values blank or unavailable?</summary><p>Missing evidence is not zero. CPU, memory and storage metrics need an external collector. Rates need a valid interval between captures; the first capture, a statistics reset or an interval that is too short can prevent rate calculations.</p></details>
  <details><summary>Are workload percentages query-count percentages?</summary><p>No. They are heuristic classifications weighted by execution time. Shard-byte fairness measures stored data balance, not CPU or query-rate balance. The drill-downs explain each metric’s scope.</p></details>
  <details><summary>Why can the policy action differ from the capture advice?</summary><p>The capture and policy are separate evaluation layers. Policy evaluation also considers rate and infrastructure pressure. Only an event matching the latest capture and selected policy affects the current advice; older events remain in the event history.</p></details>
  <details><summary>How do I connect or troubleshoot an empty dashboard?</summary><p>${hosted?'Choose PostgreSQL connection in Data source to explore the form and see how to start PostgreSQL mode with npm start. Enter passwords and connect there. To inspect an existing snapshot here, use Import advisor JSON.':'Choose PostgreSQL connection in Data source or use Connect PostgreSQL. Fill in the connection settings, or switch to Connection URI. The selector confirms PostgreSQL · connected after the connection succeeds. Check database reachability, credentials, TLS trust, extension installation and permissions if connection fails.'} If there is no capture yet, the local app’s Collect & evaluate control establishes a baseline. Allow the policy interval before collecting again. Section warnings identify unavailable supporting data.</p></details>
  <details><summary>Where are my connection details and imported data stored?</summary><p>The local server keeps connection details in memory until disconnect or 30 minutes of inactivity; they are not saved in browser storage. Imported JSON in the local demo stays in page memory. Only your walkthrough completion preference is saved in this browser.</p></details>
  </div></section><div class="help-end"><span>Want another look around?</span><button data-tour-start>Restart the walkthrough →</button></div>`;
}

const TOUR_STEPS=[
  {view:'overview',focus:'advice',title:'Your next step, at a glance',body:'The overview leads with scaling advice and the one relevant extension tag. Read the reason and expected qualitative benefit before considering a capacity change.',tip:'The confidence badge describes the evidence. It is not an event severity warning.'},
  {view:'overview',focus:'evidence',title:'Follow the “why”',body:'Telemetry coverage, workload fit, shard fairness and the observation interval help you assess the recommendation. “Why this advice?” and the evidence rows open deeper explanations.',tip:'Look for observed values, decision boundaries and the SQL source behind each signal.'},
  {view:'workload',focus:'page',title:'Understand what is running',body:'Workload breaks down analytical, hybrid and transactional activity. Query evidence lets you inspect the fingerprints that contribute to the analysis.',tip:'These are execution-time-weighted heuristic shares, not a count of queries.'},
  {view:'resources',focus:'page',title:'Find the pressure points',body:'Resources compares connections, waiting activity and valid interval rates with policy thresholds. Infrastructure metrics show CPU, memory and storage evidence when supplied.',tip:'A blank value means unavailable evidence. PostgreSQL does not automatically supply OS telemetry.'},
  {view:'distribution',focus:'page',title:'Check before you scale out',body:'Distribution explains shard-byte fairness and query locality. Imbalance or too much cross-node execution can take priority over adding workers.',tip:'Fairness measures stored bytes. It does not measure CPU balance or per-worker query load.'},
  {view:'history',focus:'page',title:'Put one capture in context',body:'Capture history shows earlier recommendations and observation intervals. Open a capture to inspect its recorded payload; outcome calibration uses actual operator feedback.',tip:'An imported snapshot has no history unless those supporting rows were supplied.'},
  {view:'policy',focus:'page',title:'See how policy shapes the advice',body:'Policy & events shows thresholds, matching capture evaluation, event state and severity. The notification outbox shows whether a queued event was delivered.',tip:'An advisory event recommends an action. It does not execute a capacity change.'},
  {view:'contract',focus:'page',title:'Trace the data to its source',body:'SQL contract maps the dashboard to pg_workload_advisor 1.0 functions and tables. Use it to understand where the values come from and which operations write records.',tip:'Refresh reads existing data. An advisory cycle collects and evaluates a new capture.'},
  {view:'overview',focus:'controls',title:'Stay current, and come back for help',body:()=>globalThis.ADVISOR_HOSTED_PREVIEW?'This local demo supports sample scenarios and imported advisor JSON. Database connection, refresh and collection are available in PostgreSQL mode, started with npm start.':'Connect PostgreSQL to read your advisor data. Refresh data reads saved records; Collect & evaluate writes a capture and updates events. Automatic modes let you schedule either operation.',tip:'Open Help & guide in the left menu to restart this tour or find a reference at any time.'}
];
let tourIndex=0,tourActive=false,tourReturnView='overview';
function showTourStep(index){
  tourIndex=Math.max(0,Math.min(TOUR_STEPS.length-1,index));const step=TOUR_STEPS[tourIndex];
  navigate(step.view);document.body.dataset.tourFocus=step.focus;
  $('#tour-step').textContent=`STEP ${tourIndex+1} OF ${TOUR_STEPS.length}`;
  $('#tour-section').textContent=NAV.find(n=>n[0]===step.view)[2];
  $('#tour-title').textContent=step.title;
  const body=typeof step.body==='function'?step.body():step.body;
  $('#tour-body').innerHTML=`<p>${esc(body)}</p><div class="tour-tip">${esc(step.tip)}</div>${!globalThis.ADVISOR_HOSTED_PREVIEW&&(!connected||!capture)?'<p class="tour-empty-note">The data views will appear after you connect and have an advisor capture. You can still explore this guide now.</p>':''}`;
  $('#tour-progress').innerHTML=TOUR_STEPS.map((_,i)=>`<span class="${i===tourIndex?'current':i<tourIndex?'complete':''}"></span>`).join('');
  $('#tour-back').disabled=tourIndex===0;$('#tour-next').textContent=tourIndex===TOUR_STEPS.length-1?'Finish tour':'Next →';
  if($('#tour-dialog').open)$('#tour-next').focus();
}
function startTour(){
  if(tourActive)return;tourReturnView=view;tourActive=true;showTourStep(0);$('#tour-dialog').showModal();$('#tour-next').focus();
}
function endTour(){
  if(!tourActive)return;tourActive=false;delete document.body.dataset.tourFocus;
  try{localStorage.setItem(TOUR_SEEN_KEY,'seen');}catch{}
  $('#tour-dialog').close();navigate(tourReturnView);$('#nav button[aria-current="page"]')?.focus();
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-tour-start'))startTour();
  if(button.hasAttribute('data-tour-close'))endTour();
  if(button.hasAttribute('data-tour-back')&&tourActive)showTourStep(tourIndex-1);
  if(button.hasAttribute('data-tour-next')&&tourActive){if(tourIndex===TOUR_STEPS.length-1)endTour();else showTourStep(tourIndex+1);}
});
$('#tour-dialog').addEventListener('cancel',event=>{event.preventDefault();endTour();});
$('#tour-dialog').addEventListener('close',()=>{if(tourActive)endTour();});
document.addEventListener('DOMContentLoaded',()=>{
  let seen=false;try{seen=localStorage.getItem(TOUR_SEEN_KEY)==='seen';}catch{}
  if(!seen&&view==='overview')startTour();
},{once:true});
