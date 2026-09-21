// ════════════════════════════════════════
//  J.A.R.V.I.S  —  COMMAND UI (local bridge)
// ════════════════════════════════════════

let camStream=null, recog=null, auCtx=null, analyser=null, audDat=null, micSrc=null, localRecorder=null, localSpeechStream=null, localSpeechTimer=null, localTranscribing=false;
let isListen=false, isSpeaking=false, history=[], afId=null, session=null;

const $ = id => document.getElementById(id);
const vcam=$('vcam'), hc=$('hc'), hCtx=hc.getContext('2d');
const ac=$('ac'), aCtx=ac.getContext('2d');
const vc=$('viz'), vCtx=vc.getContext('2d');
const msgs=$('msgs'), ti=$('ti'), thk=$('thinking');
const mst=$('main-st'), clk=$('clk'), vst=$('vst');
const rv=$('rv'), rc=$('rc'), rm=$('rm'), rapi=$('rapi');
const camOff=$('cam-off'), cb=$('cb'), ab=$('ab');
const viDot=$('vi-dot');

// ── BOOT ──────────────────────────────
const LINES=[
  'INITIALIZING J.A.R.V.I.S COMMAND UI...','LOADING NEURAL ARCHITECTURE MODULES...',
  'CALIBRATING VOICE SYNTHESIS CODEC...','ESTABLISHING LOCAL BRIDGE LINK...',
  'LOADING HUD SUBSYSTEMS...','CHECKING PERIPHERAL INTERFACES...',
  '> AUDIO I/O SUBSYSTEM: READY','> VIDEO CAPTURE MODULE: STANDBY',
  '> NATURAL LANGUAGE CORE: ACTIVE','ALL SYSTEMS NOMINAL. WELCOME, SIR.'
];

async function boot(){
  const log=$('boot-log'), bar=$('boot-bar'), bl=$('boot');
  for(let i=0;i<LINES.length;i++){
    await sl(150+Math.random()*80);
    const d=document.createElement('div');
    d.textContent=LINES[i];
    if(LINES[i].startsWith('>'))d.style.color='#00d4ff';
    if(i===LINES.length-1){d.style.color='#ffd700';d.style.fontWeight='bold';}
    log.appendChild(d);
    bar.style.width=((i+1)/LINES.length*100)+'%';
  }
  await sl(700);
  bl.style.opacity='0';
  $('ui').style.opacity='1';
  await sl(700);
  bl.style.display='none';
  initClock();
  initVoice();
  connectBridge();
  animLoop(0);
}
const sl=ms=>new Promise(r=>setTimeout(r,ms));

// ── LOCAL BRIDGE ──────────────────────
async function ensureSession(){
  if (session) return session;
  const r = await fetch('/api/session');
  if (!r.ok) throw new Error('Could not reach the local JARVIS bridge.');
  session = await r.json();
  return session;
}
async function connectBridge(){
  try{
    const s = await ensureSession();
    const label = s.provider==='openrouter'?'OpenRouter':s.provider==='bytez'?'Bytez':s.provider==='gemini'?'Gemini':s.provider==='omniroute'?'OmniRoute':'Hermes';
    $('bridge-status').textContent = s.configured ? `${label.toUpperCase()} READY` : `${label.toUpperCase()} NOT CONFIGURED`;
    rapi.textContent = s.configured ? 'ONLINE' : 'OFFLINE';
    rapi.className = s.configured ? 'rv on' : 'rv off';
  }catch{
    $('bridge-status').textContent='BRIDGE UNREACHABLE';
    rapi.textContent='OFFLINE'; rapi.className='rv off';
  }
}

// ── CLOCK ─────────────────────────────
function initClock(){
  const u=()=>{const n=new Date();clk.textContent=[n.getHours(),n.getMinutes(),n.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':')};
  u(); setInterval(u,1000);
}

// ── WEBCAM (HUD display only — not sent to the assistant) ──
async function toggleCam(){
  if(camStream){
    camStream.getTracks().forEach(t=>t.stop());
    camStream=null; vcam.srcObject=null;
    camOff.style.display='flex';
    cb.textContent='ACTIVATE CAM'; cb.classList.replace('btn-d','btn-p');
    ab.disabled=true; rc.textContent='OFFLINE'; rc.className='rv off';
    return;
  }
  try{
    camStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'}});
    vcam.srcObject=camStream; camOff.style.display='none';
    cb.textContent='DEACTIVATE CAM'; cb.classList.replace('btn-p','btn-d');
    ab.disabled=false; rc.textContent='ACTIVE'; rc.className='rv on';
    vcam.onloadedmetadata=()=>{hc.width=vcam.videoWidth||640;hc.height=vcam.videoHeight||480};
  }catch(e){addMsg('j','Camera access denied. Please allow camera permissions to enable the visual HUD, sir.')}
}

// ── HUD CANVAS ────────────────────────
function drawHUD(ts){
  const w=hc.width,h=hc.height;
  if(!w||!h||!camStream)return;
  hCtx.clearRect(0,0,w,h);
  drawHex(w,h);
  drawScan(ts,w,h);
  drawBrackets(w,h);
  drawReticle(ts,w,h);
  drawLabels(ts,w,h);
  drawVignette(w,h);
}
function drawHex(w,h){
  const s=17; hCtx.strokeStyle='rgba(0,140,190,.06)'; hCtx.lineWidth=.5;
  const rows=Math.ceil(h/(s*1.5))+1, cols=Math.ceil(w/(s*1.73))+1;
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const cx=c*s*1.732+(r%2)*s*.866, cy=r*s*1.5;
    hCtx.beginPath();
    for(let i=0;i<6;i++){const a=(Math.PI/3)*i;hCtx.lineTo(cx+s*Math.cos(a),cy+s*Math.sin(a));}
    hCtx.closePath(); hCtx.stroke();
  }
}
function drawScan(ts,w,h){
  const sy=((Math.sin(ts*.0007)+1)/2)*h;
  const g=hCtx.createLinearGradient(0,sy-18,0,sy+18);
  g.addColorStop(0,'transparent'); g.addColorStop(.5,'rgba(0,212,255,.13)'); g.addColorStop(1,'transparent');
  hCtx.fillStyle=g; hCtx.fillRect(0,sy-18,w,36);
  hCtx.beginPath(); hCtx.moveTo(0,sy); hCtx.lineTo(w,sy);
  hCtx.strokeStyle='rgba(0,212,255,.45)'; hCtx.lineWidth=1; hCtx.stroke();
}
function drawBrackets(w,h){
  const s=26,p=11; hCtx.strokeStyle='#00d4ff'; hCtx.lineWidth=2;
  [[p,p,1,1],[w-p,p,-1,1],[p,h-p,1,-1],[w-p,h-p,-1,-1]].forEach(([x,y,dx,dy])=>{
    hCtx.beginPath(); hCtx.moveTo(x+dx*s,y); hCtx.lineTo(x,y); hCtx.lineTo(x,y+dy*s); hCtx.stroke();
  });
}
function drawReticle(ts,w,h){
  const cx=w/2,cy=h/2,OR=24,sp=ts*.001;
  hCtx.strokeStyle='rgba(0,212,255,.65)'; hCtx.lineWidth=1.2;
  [0,Math.PI/2,Math.PI,Math.PI*1.5].forEach(a=>{
    hCtx.beginPath();
    hCtx.moveTo(cx+Math.cos(a)*(OR+2),cy+Math.sin(a)*(OR+2));
    hCtx.lineTo(cx+Math.cos(a)*(OR+18),cy+Math.sin(a)*(OR+18));
    hCtx.stroke();
  });
  hCtx.beginPath(); hCtx.arc(cx,cy,OR,0,Math.PI*2); hCtx.stroke();
  hCtx.strokeStyle='#00d4ff'; hCtx.lineWidth=1.5;
  for(let i=0;i<4;i++){const a=sp+(Math.PI/2)*i; hCtx.beginPath(); hCtx.arc(cx,cy,OR,a+.18,a+Math.PI/2-.18); hCtx.stroke();}
  hCtx.beginPath(); hCtx.arc(cx,cy,2.5,0,Math.PI*2); hCtx.fillStyle='#00d4ff'; hCtx.fill();
}
function drawLabels(ts,w,h){
  hCtx.font='9px monospace'; hCtx.fillStyle='rgba(0,212,255,.55)';
  hCtx.textAlign='left';
  hCtx.fillText(`RES ${vcam.videoWidth||0}×${vcam.videoHeight||0}`,12,h-24);
  hCtx.fillText('FEED ACTIVE (HUD ONLY)',12,h-12);
  hCtx.textAlign='right';
  const st=isListen?'LISTENING':isSpeaking?'SPEAKING':'MONITORING';
  hCtx.fillText(st,w-12,22);
  hCtx.fillText('T+'+Math.floor(ts/1000)+'s',w-12,34);
  hCtx.textAlign='left';
}
function drawVignette(w,h){
  const g=hCtx.createRadialGradient(w/2,h/2,h*.25,w/2,h/2,h*.85);
  g.addColorStop(0,'transparent'); g.addColorStop(1,'rgba(0,4,18,.38)');
  hCtx.fillStyle=g; hCtx.fillRect(0,0,w,h);
}

// ── ARC REACTOR ───────────────────────
function drawArc(ts){
  const x=50,y=50; aCtx.clearRect(0,0,100,100);
  const bg=aCtx.createRadialGradient(x,y,0,x,y,44);
  bg.addColorStop(0,'rgba(0,25,55,.85)'); bg.addColorStop(1,'rgba(0,4,18,.92)');
  aCtx.fillStyle=bg; aCtx.beginPath(); aCtx.arc(x,y,44,0,Math.PI*2); aCtx.fill();
  aCtx.strokeStyle='rgba(0,212,255,.35)'; aCtx.lineWidth=1.8;
  aCtx.beginPath(); aCtx.arc(x,y,42,0,Math.PI*2); aCtx.stroke();
  for(let i=0;i<12;i++){
    const a=ts*.0009+(Math.PI*2/12)*i;
    const b=.25+.75*((Math.sin(a*2.5+ts*.0025)+1)/2);
    aCtx.strokeStyle=`rgba(0,212,255,${b})`; aCtx.lineWidth=2.5;
    aCtx.beginPath(); aCtx.arc(x,y,37,a,a+.14); aCtx.stroke();
  }
  aCtx.strokeStyle='rgba(0,150,255,.6)'; aCtx.lineWidth=1.2;
  aCtx.beginPath();
  for(let i=0;i<6;i++){const a=-ts*.0004+(Math.PI/3)*i;aCtx.lineTo(x+19*Math.cos(a),y+19*Math.sin(a));}
  aCtx.closePath(); aCtx.stroke();
  aCtx.strokeStyle='rgba(0,200,255,.55)'; aCtx.lineWidth=1;
  aCtx.beginPath();
  for(let i=0;i<3;i++){const a=ts*.0006+(Math.PI*2/3)*i-Math.PI/2;aCtx.lineTo(x+11*Math.cos(a),y+11*Math.sin(a));}
  aCtx.closePath(); aCtx.stroke();
  const cg=aCtx.createRadialGradient(x,y,0,x,y,9);
  cg.addColorStop(0,'rgba(180,240,255,.9)'); cg.addColorStop(.5,'rgba(0,180,255,.55)'); cg.addColorStop(1,'transparent');
  aCtx.fillStyle=cg; aCtx.beginPath(); aCtx.arc(x,y,9,0,Math.PI*2); aCtx.fill();
  const pr=3.5+2*Math.sin(ts*.0045);
  aCtx.beginPath(); aCtx.arc(x,y,pr,0,Math.PI*2); aCtx.fillStyle='rgba(220,248,255,.96)'; aCtx.fill();
}

// ── VISUALIZER ────────────────────────
function drawViz(ts){
  const w=110,h=34,bars=32,bw=(w/bars)-.8;
  vCtx.clearRect(0,0,w,h);
  for(let i=0;i<bars;i++){
    let v;
    if(audDat&&analyser){analyser.getByteFrequencyData(audDat); v=audDat[Math.floor(i*audDat.length/bars)]/255;}
    else v=.04+.07*Math.abs(Math.sin(ts*.0018+i*.42));
    if(isListen)v=Math.min(1,v*1.9+.07*Math.abs(Math.sin(ts*.012+i)));
    const bh=Math.max(1,v*h), hue=185+v*50, a=.35+v*.65;
    vCtx.fillStyle=`hsla(${hue},100%,62%,${a})`;
    vCtx.fillRect(i*(bw+.8),h-bh,bw,bh);
  }
}

// ── ANIMATION LOOP ────────────────────
function animLoop(ts){drawHUD(ts);drawArc(ts);drawViz(ts);afId=requestAnimationFrame(animLoop);}

// ── MIC AUDIO ────────────────────────
async function initMicAudio(){
  if(auCtx)return;
  try{
    auCtx=new AudioContext();
    micSrc=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    analyser=auCtx.createAnalyser(); analyser.fftSize=128;
    audDat=new Uint8Array(analyser.frequencyBinCount);
    auCtx.createMediaStreamSource(micSrc).connect(analyser);
  }catch(e){}
}

// ── LOCAL VOICE ───────────────────────
function setVoiceState(active, text='SYSTEM ONLINE · AWAITING COMMAND'){
  isListen=active; $('mic').classList.toggle('live',active);
  vst.textContent=active?'LISTENING':'STANDBY'; vst.style.color=active?'var(--r)':'';
  rv.textContent=active?'LISTENING':'READY'; rv.className=active?'rv warn':'rv';
  mst.textContent=text;
  viDot.innerHTML=active?'<span class="sdot" style="background:var(--r);box-shadow:0 0 6px var(--r)"></span>VOICE':'<span class="sdot" style="background:#555;box-shadow:none"></span>VOICE';
}
function initVoice(){ setVoiceState(false); }
async function toggleListen(){
  if(localRecorder?.state==='recording'){ clearTimeout(localSpeechTimer); localRecorder.stop(); return; }
  if(localTranscribing) return;
  try{
    const s=await ensureSession();
    if(!s.localSpeechReady) throw new Error('Local speech is still starting. Retry shortly.');
    localSpeechStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    const chunks=[], mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'';
    localRecorder=mime?new MediaRecorder(localSpeechStream,{mimeType:mime}):new MediaRecorder(localSpeechStream);
    localRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    localRecorder.onstop=async()=>{
      localRecorder=null; localSpeechStream?.getTracks().forEach(t=>t.stop()); localSpeechStream=null;
      if(!chunks.length){setVoiceState(false);return;}
      localTranscribing=true; setVoiceState(false,'TRANSCRIBING LOCALLY...');
      try{
        const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary=''; for(const byte of bytes)binary+=String.fromCharCode(byte);
        const r=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json','X-Jarvis-Token':s.token},body:JSON.stringify({audio:btoa(binary)})});
        const d=await r.json(); if(!r.ok)throw new Error(d.error||'Local transcription failed.');
        if(d.transcript){ti.value=d.transcript;await handleSend(d.transcript,false);} else mst.textContent='NO SPEECH DETECTED · READY';
      }catch(e){ mst.textContent=`LOCAL VOICE ERROR · ${e.message||'UNAVAILABLE'}`; }
      finally{localTranscribing=false;setVoiceState(false,mst.textContent);}
    };
    localRecorder.start(); setVoiceState(true,'LOCAL VOICE INPUT ACTIVE · LISTENING...');
    localSpeechTimer=setTimeout(()=>localRecorder?.state==='recording'&&localRecorder.stop(),3200);
  }catch(e){setVoiceState(false,`LOCAL VOICE ERROR · ${e.message||'MICROPHONE UNAVAILABLE'}`);}
}

// ── SPEECH SYNTHESIS ──────────────────
function speak(txt){
  if(!window.speechSynthesis)return;
  speechSynthesis.cancel();
  const clean=txt.replace(/[*_#`]/g,'').replace(/\n+/g,' ').trim();
  const u=new SpeechSynthesisUtterance(clean);
  u.rate=1.0; u.pitch=.88; u.volume=.9;
  const vs=speechSynthesis.getVoices();
  const v=vs.find(v=>v.lang==='en-GB'&&/male/i.test(v.name))
    ||vs.find(v=>v.lang==='en-GB')
    ||vs.find(v=>/daniel|james|oliver/i.test(v.name))
    ||vs.find(v=>v.lang.startsWith('en'));
  if(v)u.voice=v;
  u.onstart=()=>{isSpeaking=true;mst.textContent='J.A.R.V.I.S SPEAKING...'};
  u.onend=()=>{isSpeaking=false;mst.textContent='SYSTEM ONLINE · AWAITING COMMAND'};
  speechSynthesis.speak(u);
}

// ── LOCAL BRIDGE CHAT ──────────────────
async function callAPI(txt){
  const s = await ensureSession();
  const hist = history.slice(-14).map(h=>({role:h.role,content:h.content}));
  hist.push({role:'user',content:txt});
  const r = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json','X-Jarvis-Token':s.token}, body: JSON.stringify({messages:hist}) });
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || 'Request failed.');
  return d.reply;
}

// ── UI HELPERS ────────────────────────
function addMsg(role, text, imgAttached=false){
  const isJ=role==='j';
  const m=document.createElement('div');
  m.className='msg'+(isJ?'':' msg-u');
  const ava=document.createElement('div');
  ava.className='ava'; ava.textContent=isJ?'J':'U';
  const mb=document.createElement('div'); mb.className='mb';
  const ml=document.createElement('div'); ml.className='ml';
  ml.textContent=isJ?'J.A.R.V.I.S':'OPERATOR';
  const mc=document.createElement('div');
  mc.className='mc'+(imgAttached?' mc-img':'');
  mc.textContent=text;
  mb.append(ml,mc); m.append(ava,mb);
  msgs.appendChild(m); msgs.scrollTop=msgs.scrollHeight;
  rm.textContent=history.length+' TURNS';
}

async function handleSend(txt=null, withCam=false){
  const msg=(txt||ti.value).trim();
  if(!msg&&!withCam)return;
  ti.value='';
  const disp=msg||(withCam?'Analyze current camera view':'');
  addMsg('u',disp, withCam && !!camStream);
  history.push({role:'user',content:disp});
  thk.classList.add('on');
  mst.textContent='PROCESSING REQUEST...';
  try{
    const rep=await callAPI(disp);
    history.push({role:'assistant',content:rep});
    thk.classList.remove('on'); addMsg('j',rep); speak(rep);
    mst.textContent='SYSTEM ONLINE · AWAITING COMMAND';
  }catch(e){
    thk.classList.remove('on');
    const err=`I encountered an error, sir: ${e.message||'Unknown error'}. Make sure the JARVIS local bridge is running.`;
    addMsg('j',err); speak(err);
    mst.textContent='ERROR — BRIDGE UNAVAILABLE';
  }
  rm.textContent=history.length+' TURNS';
}

function analyzeView(){
  const t=ti.value.trim();
  handleSend(t||'Describe what tasks I could work on right now.', !!camStream);
}
function quickCmd(cmd){ ti.value=cmd; handleSend(cmd); }
function clearLog(){
  msgs.innerHTML=''; history=[]; rm.textContent='0 TURNS';
  addMsg('j','Communication log cleared, sir. Standing by for your next instruction.');
}

// ── EVENT LISTENERS ───────────────────
ti.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}});
document.addEventListener('click',()=>{if(window.speechSynthesis)speechSynthesis.getVoices();},{once:true});

// ── INIT ──────────────────────────────
boot();
