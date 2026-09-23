import { gesturesFromHands } from './gestures.js';
import { ClapDetector } from './claps.js';
const $ = id => document.getElementById(id);
let session, history = [], sending = false, controller, speechEnabled = false, voiceMode = false, awake = false, recognition, localRecorder, localSpeechStream, localSpeechTimer, localTranscribing = false, wakeStream, wakeContext, wakeAnalyser, wakeFrame, lastClap = 0, wakeTimer, pendingChatAction;
let stream, worker, cameraGeneration = 0, cameraStarting = false, frameBusy = false, frameTimer, workerReady = false, pinchStarted = 0, latched = false, hover, smooth, primaryHand, sphereHand, sphereSpan, desktopArmed = false, desktopGeneration = 0, desktopLast = 0, scrollAnchor;
const readLocal = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
const sphereTheme = document.getElementById('sphere-theme');
if (sphereTheme) sphereTheme.disabled = true;
document.body.dataset.uiMode = 'command';
function message(role, text, error = false) {
  const article = document.createElement('article'); article.className = `message ${role}${error ? ' error' : ''}`;
  const label = document.createElement('span'); label.className = 'message-label'; label.textContent = role === 'user' ? 'YOU' : 'JARVIS';
  const content = document.createElement('p'); content.textContent = text;
  article.append(label, content); $('messages').append(article); article.scrollIntoView({ block: 'nearest' });
}
async function connect() {
  try { const response = await fetch('/api/session'); if (!response.ok) throw new Error(); session = await response.json(); const label = session.provider === 'openrouter' ? 'OpenRouter' : session.provider === 'bytez' ? 'Bytez' : session.provider === 'gemini' ? 'Gemini' : session.provider === 'omniroute' ? 'OmniRoute' : 'Hermes'; $('provider-name').textContent = session.route === 'omniroute' ? 'HERMES · OMNIROUTE' : label.toUpperCase(); $('chat-status').textContent = session.configured ? `${label} bridge ready · provider checked on send` : `${label} needs secure server configuration`; $('desktop-control').disabled = !session.desktopReady; if (!session.desktopReady) $('gesture-info').textContent = 'Desktop companion is unavailable. Air touch still works in JARVIS.'; if (session.localSpeechReady) document.querySelector('.core-detail').textContent = 'Local speech is ready. Wake JARVIS, then speak; audio stays on this device.'; connectObsidian(); refreshIntegrations(); }
  catch { $('chat-status').textContent = 'Local server disconnected. Reload to reconnect.'; }
}
connect();
function localActionFromText(text) {
  let match;
  if ((match = text.match(/^(?:send|post)(?: a message)?(?: to)? slack[:\s]+(.+)/i))) return { action: 'slack_message', text: match[1].trim() };
  if ((match = text.match(/^(?:send|post)(?: a message)?(?: to)? discord[:\s]+(.+)/i))) return { action: 'discord_message', text: match[1].trim() };
  if ((match = text.match(/^open (?:the )?(?:website|url)\s+(https?:\/\/\S+)/i))) return { action: 'open_url', url: match[1] };
  if ((match = text.match(/^open (?:the )?app\s+(.+)/i))) return { action: 'open_app', path: match[1].trim() };
  if ((match = text.match(/^find (?:a )?files?\s+(.+)/i))) return { action: 'find', query: match[1].trim() };
  if ((match = text.match(/^run (?:the )?command\s+(.+)/i))) return { action: 'run_command', command: match[1].match(/(?:[^\s"]+|"[^"]*")+/g)?.map(part => part.replaceAll('"', '')) || [] };
  return null;
}
function describeLocalAction(action) {
  if (action.action === 'slack_message') return `send this to Slack: “${action.text}”`;
  if (action.action === 'discord_message') return `send this to Discord: “${action.text}”`;
  if (action.action === 'open_url') return `open ${action.url}`;
  if (action.action === 'open_app') return `open ${action.path}`;
  if (action.action === 'find') return `find files matching “${action.query}”`;
  return `run ${action.command.join(' ')}`;
}
async function handleLocalChatAction(text) {
  if (/^(?:cancel|never mind)$/i.test(text) && pendingChatAction) {
    message('user', text); pendingChatAction = null; message('assistant', 'Cancelled.'); return true;
  }
  if (/^(?:confirm|yes,? do it|run it)$/i.test(text) && pendingChatAction) {
    const action = pendingChatAction; pendingChatAction = null; message('user', text); sending = true; $('send').disabled = true;
    $('core-state').textContent = 'EXECUTING'; $('core-caption').textContent = describeLocalAction(action); $('chat-status').textContent = 'Running approved local action…';
    try {
      const response = await fetch('/api/computer', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify(action) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Action failed.');
      const result = [data.message, data.output, data.results?.join('\n')].filter(Boolean).join('\n\n') || 'Done.'; message('assistant', result); $('chat-status').textContent = 'Local action completed';
    } catch (error) { message('assistant', error.message || 'Action failed.', true); $('chat-status').textContent = 'Local action failed'; }
    finally { sending = false; $('send').disabled = false; $('core-state').textContent = 'STANDBY'; $('core-caption').textContent = 'Awaiting your command'; }
    return true;
  }
  const action = localActionFromText(text);
  if (!action) return false;
  pendingChatAction = action; message('user', text); message('assistant', `Ready to ${describeLocalAction(action)}. Say “confirm” to proceed or “cancel” to stop.`); $('chat-status').textContent = 'Waiting for confirmation in this conversation';
  return true;
}
async function send(event) {
  event.preventDefault(); const text = $('prompt').value.trim();
  if (!text || sending) return;
  if (!session) { $('chat-status').textContent = 'Reconnect before sending.'; await connect(); return; }
  if (await handleLocalChatAction(text)) { $('prompt').value = ''; return; }
  sending = true; awake = false; clearTimeout(wakeTimer); recognition?.stop(); $('send').disabled = true; $('prompt').value = ''; message('user', text);
  const pending = [...history.slice(-14), { role: 'user', content: text }];
  while (pending.length > 1 && new TextEncoder().encode(JSON.stringify({ messages: pending })).length > 30000) pending.splice(0, 2);
  $('core-state').textContent = 'THINKING'; $('core-caption').textContent = 'Working on your request'; $('reactor').classList.add('thinking'); $('chat-status').textContent = `${$('provider-name').textContent} is thinking…`;
  controller = new AbortController(); const timeout = setTimeout(() => controller?.abort(), 95000);
  try {
    const request = () => fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify({ messages: pending }), signal: controller.signal });
    let response = await request();
    if (response.status === 503) { $('chat-status').textContent = `Reconnecting to ${$('provider-name').textContent}…`; await new Promise(resolve => setTimeout(resolve, 1100)); response = await request(); }
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.');
    history = [...pending, { role: 'assistant', content: data.reply.slice(0, 6000) }].slice(-14); message('assistant', data.reply); $('chat-status').textContent = `${$('provider-name').textContent} connected`;
    if (await speakReply(data.reply)) { voiceMode = false; $('chat-status').textContent = 'Voicebox is speaking. Start voice control when you are ready to listen again.'; }
  } catch (error) {
    message('assistant', error.name === 'AbortError' ? 'Request stopped. You can try again.' : error.message, true); $('chat-status').textContent = 'Request not completed'; $('prompt').value = text;
  } finally { clearTimeout(timeout); sending = false; controller = null; $('send').disabled = false; if (voiceMode) { $('core-state').textContent = 'LISTENING'; $('core-caption').textContent = 'Speak your command'; startVoice(); } else { $('core-state').textContent = 'STANDBY'; $('core-caption').textContent = 'Awaiting your command'; } $('reactor').classList.remove('thinking'); }
}
$('chat-form').addEventListener('submit', send);
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chat-form').requestSubmit(); } });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; $('prompt').focus(); }));
$('clear-chat').onclick = () => { if (sending) { controller?.abort(); return; } history = []; $('messages').replaceChildren(); message('assistant', 'Conversation cleared. What would you like to work on?'); };
$('sound').onclick = () => { if (!('speechSynthesis' in window)) { $('chat-status').textContent = 'Speech output is unavailable in this browser.'; return; } speechEnabled = !speechEnabled; $('sound').textContent = speechEnabled ? 'Speech on' : 'Speech off'; $('sound').setAttribute('aria-pressed', speechEnabled); if (!speechEnabled) speechSynthesis.cancel(); };
function setSpeech(enabled) { speechEnabled = enabled; $('sound').textContent = enabled ? 'Speech on' : 'Speech off'; $('sound').setAttribute('aria-pressed', enabled); }
async function speakReply(reply) {
  if (!speechEnabled || !('speechSynthesis' in window)) return false;
  if (session?.voiceboxReady) { try { const response = await fetch('/api/voicebox', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify({ text: reply }) }); if (response.ok) return true; } catch {} }
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(reply); const voice = speechSynthesis.getVoices().find(item => /microsoft guy|microsoft david|daniel|google uk english male/i.test(item.name)) || speechSynthesis.getVoices().find(item => /en/i.test(item.lang)); if (voice) utterance.voice = voice; utterance.rate = .92; utterance.pitch = .84;
  utterance.onend = () => { if (voiceMode && !sending) startVoice(); };
  speechSynthesis.speak(utterance);
  return false;
}
function setWakeState(source) {
  awake = true; clearTimeout(wakeTimer); $('reactor').classList.add('listening'); $('core-state').textContent = 'AWAKE'; $('core-caption').textContent = source; $('chat-status').textContent = 'JARVIS is listening for your command.';
  wakeTimer = setTimeout(() => { if (awake && !sending) { awake = false; $('core-state').textContent = 'WATCHING'; $('core-caption').textContent = 'Say “Jarvis, wake up” or clap twice'; } }, 12000);
}
function stopWakeAudio() { cancelAnimationFrame(wakeFrame); wakeStream?.getTracks().forEach(track => track.stop()); wakeStream = null; wakeAnalyser = null; wakeContext?.close(); wakeContext = null; }
async function startWakeAudio() {
  if (wakeAnalyser || !navigator.mediaDevices?.getUserMedia || !window.AudioContext) return;
  try {
    const audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (!voiceMode) { audio.getTracks().forEach(track => track.stop()); return; }
    wakeStream = audio; wakeContext = new AudioContext(); const source = wakeContext.createMediaStreamSource(wakeStream); wakeAnalyser = wakeContext.createAnalyser(); wakeAnalyser.fftSize = 1024; source.connect(wakeAnalyser);
    const samples = new Uint8Array(wakeAnalyser.fftSize); const claps = new ClapDetector();
    const monitor = () => { if (!wakeAnalyser || !voiceMode) return; wakeAnalyser.getByteTimeDomainData(samples); let peak = 0; for (const value of samples) peak = Math.max(peak, Math.abs(value - 128) / 128); const now = performance.now(); if (claps.sample(peak, now) && !awake && !sending && !window.speechSynthesis?.speaking) setWakeState('Two claps detected'); wakeFrame = requestAnimationFrame(monitor); };
    monitor();
  } catch { $('chat-status').textContent = 'Voice recognition is active. Allow microphone access for clap activation.'; }
}
function startVoice() {
  if (recognition || sending || !voiceMode || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) return;
  if (session?.localSpeechReady) return startLocalVoice();
  if (/Electron\//.test(navigator.userAgent)) {
    voiceMode = false; awake = false; stopWakeAudio(); setSpeech(false);
    $('voice').textContent = 'Start voice control';
    $('reactor').classList.remove('listening');
    $('core-state').textContent = 'STANDBY';
    $('chat-status').textContent = session?.localSpeechError || 'Local speech is starting or unavailable. Retry shortly.';
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { voiceMode = false; $('voice').textContent = 'Voice unavailable'; $('chat-status').textContent = 'Voice recognition is unavailable in this browser.'; return; }
  recognition = new Recognition(); recognition.lang = navigator.language || 'en-US'; recognition.interimResults = false; recognition.continuous = true;
  recognition.onresult = event => { for (let index = event.resultIndex; index < event.results.length; index++) if (event.results[index].isFinal) handleTranscript(event.results[index][0].transcript.trim()); };
  recognition.onerror = event => { if (event.error === 'no-speech' || event.error === 'aborted') return; voiceMode = false; awake = false; stopWakeAudio(); setSpeech(false); $('voice').textContent = 'Start voice control'; $('reactor').classList.remove('listening'); $('core-state').textContent = 'STANDBY'; $('core-caption').textContent = 'Awaiting your command'; $('chat-status').textContent = /not-allowed/.test(event.error) ? 'Microphone access was denied. Enable microphone access for desktop apps in Windows Settings, then try again.' : `Dictation failed (${event.error}). Try browser mode or configure a local speech service.`; };
  recognition.onend = () => { recognition = null; if (voiceMode && !sending && !window.speechSynthesis?.speaking) setTimeout(startVoice, 250); };
  try { recognition.start(); $('voice').textContent = 'Stop voice control'; $('reactor').classList.add('listening'); $('core-state').textContent = 'WATCHING'; $('core-caption').textContent = 'Say “Jarvis, wake up” or clap twice'; $('chat-status').textContent = 'Wake listening is active. Say Jarvis, wake up.'; } catch { recognition = null; $('chat-status').textContent = 'Could not start dictation.'; }
}
function handleTranscript(transcript) {
  const match = transcript.match(/\b(?:hey\s+)?jarvis\b[\s,]*(?:wake\s+up\b)?[\s,]*(.*)/i);
  if (!awake && match) { setWakeState('Wake phrase detected'); if (match[1]) { $('prompt').value = match[1].slice(0, 6000); $('chat-form').requestSubmit(); } }
  else if (awake && transcript) { awake = false; clearTimeout(wakeTimer); $('prompt').value = transcript.slice(0, 6000); $('chat-status').textContent = 'Command received.'; $('chat-form').requestSubmit(); }
}
async function startLocalVoice() {
  if (localRecorder || localTranscribing || !voiceMode || sending) return;
  try {
    localSpeechStream ||= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const chunks = []; const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    localRecorder = mimeType ? new MediaRecorder(localSpeechStream, { mimeType }) : new MediaRecorder(localSpeechStream);
    localRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    localRecorder.onstop = async () => {
      localRecorder = null; if (!chunks.length || !voiceMode) return;
      localTranscribing = true;
      try { const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify({ audio: btoa(binary) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (data.transcript) handleTranscript(data.transcript); }
      catch (error) { $('chat-status').textContent = `Local speech failed: ${error.message || 'transcription unavailable'}`; }
      finally { localTranscribing = false; if (voiceMode && !sending) setTimeout(startLocalVoice, 100); }
    };
    localRecorder.start(); localSpeechTimer = setTimeout(() => localRecorder?.state === 'recording' && localRecorder.stop(), 3200);
    $('voice').textContent = 'Stop voice control'; $('reactor').classList.add('listening'); $('core-state').textContent = 'WATCHING'; $('core-caption').textContent = 'Say “Jarvis, wake up” or clap twice'; $('chat-status').textContent = 'Local speech listening is active.';
  } catch { voiceMode = false; $('voice').textContent = 'Start voice control'; $('chat-status').textContent = 'Microphone access is required for local speech.'; }
}
$('voice').onclick = async () => {
  if (!voiceMode) {
    $('voice').disabled = true;
    try {
      const response = await fetch('/api/session');
      if (!response.ok) throw new Error('Cannot connect to the local speech service.');
      session = await response.json();
      if (/Electron\//.test(navigator.userAgent) && !session.localSpeechReady) {
        $('chat-status').textContent = `${session.localSpeechError || 'Local speech is still starting or unavailable. Retry shortly.'} Browser dictation is unavailable in this desktop app.`;
        return;
      }
    } catch (error) { $('chat-status').textContent = error.message; return; }
    finally { $('voice').disabled = false; }
  }
  voiceMode = !voiceMode; setSpeech(voiceMode);
  if (!voiceMode) { awake = false; clearTimeout(wakeTimer); recognition?.stop(); clearTimeout(localSpeechTimer); localRecorder?.state === 'recording' && localRecorder.stop(); localSpeechStream?.getTracks().forEach(track => track.stop()); localSpeechStream = null; stopWakeAudio(); speechSynthesis?.cancel(); $('voice').textContent = 'Start voice control'; $('reactor').classList.remove('listening'); $('core-state').textContent = 'STANDBY'; $('core-caption').textContent = 'Awaiting your command'; return; }
  startVoice(); startWakeAudio();
};
function stopCamera(info = 'Camera off. Processing stopped.') {
  cameraGeneration++; cameraStarting = false; workerReady = false; clearTimeout(frameTimer);
  stream?.getTracks().forEach(track => track.stop()); stream = null; worker?.terminate(); worker = null; $('camera').srcObject = null;
  frameBusy = false; smooth = null; primaryHand = null; sphereHand = null; sphereSpan = null; latched = false; pinchStarted = 0; hover?.classList.remove('air-hover'); hover = null;
  $('hand-cursor').hidden = true; $('camera').parentElement.classList.remove('live'); $('air-touch').textContent = 'Enable air touch ↗'; $('air-touch').disabled = false;
  $('gesture-state').textContent = 'OFFLINE'; $('gesture-info').textContent = info;
  setDesktopArmed(false);
}
async function frameLoop(generation) {
  if (generation !== cameraGeneration || !stream || !workerReady) return;
  if (!frameBusy && $('camera').readyState >= 2) {
    frameBusy = true;
    try { const frame = await createImageBitmap($('camera')); if (generation !== cameraGeneration || !worker) { frame.close(); return; } worker.postMessage({ type: 'frame', frame, time: performance.now() }, [frame]); }
    catch { stopCamera('Could not process a camera frame. Try restarting air touch.'); return; }
  }
  frameTimer = setTimeout(() => frameLoop(generation), $('low-power').checked ? 125 : 66);
}
function desktop(action) {
  if (!desktopArmed || !session) return;
  fetch('/api/desktop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify({ ...action, generation: desktopGeneration }) }).then(response => { if (!response.ok) setDesktopArmed(false); }).catch(() => setDesktopArmed(false));
}
async function setDesktopArmed(next) {
  if (next && (!stream || !workerReady || !session)) return;
  if (next) {
    const response = await fetch('/api/desktop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify({ action: 'arm' }) });
    if (!response.ok) throw new Error('Desktop control could not arm.');
    desktopGeneration = (await response.json()).generation;
  }
  desktopArmed = Boolean(next); scrollAnchor = null;
  $('desktop-control').textContent = desktopArmed ? 'Disarm desktop control' : 'Arm desktop control';
  $('desktop-control').setAttribute('aria-pressed', desktopArmed);
  if (!desktopArmed && session) fetch('/api/desktop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify({ action: 'disarm' }) }).catch(() => {});
}
function updateHands(hands) {
  const detected = gesturesFromHands(hands, Number($('sensitivity').value)); const cursor = $('hand-cursor');
  if (!detected.length) { cursor.hidden = true; primaryHand = null; sphereHand = null; sphereSpan = null; pinchStarted = 0; latched = false; smooth = null; scrollAnchor = null; hover?.classList.remove('air-hover'); hover = null; $('gesture-state').textContent = 'FINDING HAND'; return; }
  const hand = primaryHand ? detected.reduce((nearest, next) => Math.hypot(next.x - primaryHand.x, next.y - primaryHand.y) < Math.hypot(nearest.x - primaryHand.x, nearest.y - primaryHand.y) ? next : nearest) : detected[0];
  const second = detected.find(next => next !== hand); primaryHand = hand;
  const now = performance.now();
  if (desktopArmed) {
    $('gesture-state').textContent = hand.pinch ? 'DESKTOP CLICK' : second ? 'DESKTOP SCROLL' : 'DESKTOP ACTIVE';
  } else {
    $('gesture-state').textContent = second ? 'TWO HANDS' : hand.pinch ? 'PINCH' : hand.pointing ? 'POINT' : hand.openPalm ? 'PALM' : 'TRACKING';
  }
  const next = { x: hand.x * (innerWidth - 24) + 12, y: hand.y * (innerHeight - 24) + 12 };
  const distance = smooth ? Math.hypot(next.x - smooth.x, next.y - smooth.y) / Math.max(innerWidth, innerHeight) : 1;
  const follow = hand.pinch ? .62 : Math.min(.7, .16 + distance * 3.2);
  smooth = smooth ? { x: smooth.x * (1 - follow) + next.x * follow, y: smooth.y * (1 - follow) + next.y * follow } : next;
  cursor.hidden = false; cursor.style.left = `${smooth.x - 14}px`; cursor.style.top = `${smooth.y - 14}px`;
  cursor.classList.toggle('pinching', hand.pinch);
  cursor.classList.toggle('desktop-armed', desktopArmed);
  cursor.classList.toggle('pointing', Boolean(hand.pointing));
  cursor.classList.toggle('open-palm', Boolean(hand.openPalm));

  if (desktopArmed) {
    if (now - desktopLast >= 35) {
      desktopLast = now;
      desktop({ action: 'move', x: hand.x, y: hand.y });
    }
  }

  if (hand.pinch && sphereHand && !desktopArmed) window.jarvisSphere?.drag((hand.x - sphereHand.x) * 6, (hand.y - sphereHand.y) * 6);
  sphereHand = { x: hand.x, y: hand.y };
  if (second) {
    const span = Math.hypot(hand.x - second.x, hand.y - second.y);
    if (sphereSpan !== null && !desktopArmed) window.jarvisSphere?.zoom((span - sphereSpan) * 1.8);
    sphereSpan = span;
    if (desktopArmed) {
      if (scrollAnchor === null) scrollAnchor = second.y;
      else {
        const delta = Math.round((second.y - scrollAnchor) * 900);
        if (Math.abs(delta) >= 20 && now - desktopLast >= 45) {
          desktop({ action: 'scroll', delta: Math.max(-1200, Math.min(1200, -delta)) });
          scrollAnchor = second.y;
        }
      }
    }
  } else {
    sphereSpan = null;
    scrollAnchor = null;
  }
  if (!hand.pinch) { cursor.style.setProperty('--pinch-progress', '0deg'); latched = false; pinchStarted = 0; return; }
  if (!pinchStarted) pinchStarted = now;
  const heldFor = now - pinchStarted; cursor.style.setProperty('--pinch-progress', `${Math.min(360, heldFor * 2)}deg`);
  if (!latched && heldFor >= 160) {
    latched = true;
    if (desktopArmed) desktop({ action: 'click' });
    else window.jarvisSphere?.selectAt(smooth.x, smooth.y);
  }
}
$('air-touch').onclick = async () => {
  if (stream || cameraStarting) { stopCamera(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.Worker) { $('gesture-info').textContent = 'Air touch needs a current browser with camera and worker support.'; return; }
  cameraStarting = true; const generation = ++cameraGeneration;
  $('air-touch').textContent = 'Cancel camera startup'; $('gesture-state').textContent = 'STARTING'; $('gesture-info').textContent = 'Allow camera access when your browser asks.';
  try {
    const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 } }, audio: false });
    if (generation !== cameraGeneration) { media.getTracks().forEach(track => track.stop()); return; }
    stream = media; $('camera').srcObject = media; await $('camera').play();
    if (generation !== cameraGeneration) return;
    $('camera').parentElement.classList.add('live'); $('gesture-info').textContent = 'Loading local hand model…';
    worker = new Worker('/hand-worker.js');
    const startup = setTimeout(() => { if (generation === cameraGeneration && !workerReady) stopCamera('Hand model took too long to load. Try again.'); }, 30000);
    worker.onerror = () => { clearTimeout(startup); if (generation === cameraGeneration) stopCamera('Hand tracking failed to load. Check local assets and browser support.'); };
    worker.onmessage = ({ data }) => {
      if (generation !== cameraGeneration) return;
      if (data.type === 'ready') { clearTimeout(startup); workerReady = true; cameraStarting = false; $('air-touch').textContent = 'Disable air touch'; $('gesture-info').textContent = 'Point to move. Hold a pinch briefly to select. Escape turns the camera off.'; frameLoop(generation); }
      else if (data.type === 'landmarks') { frameBusy = false; updateHands(data.hands); }
      else if (data.type === 'error') { clearTimeout(startup); stopCamera(data.message); }
    };
    worker.postMessage({ type: 'init' });
    media.getVideoTracks()[0].onended = () => { if (generation === cameraGeneration) stopCamera('Camera disconnected.'); };
  } catch (error) { if (generation === cameraGeneration) stopCamera(error.name === 'NotAllowedError' ? 'Camera permission denied. Enable permission in your browser to use air touch.' : 'Camera unavailable. Connect a webcam and try again.'); }
};
$('sensitivity').oninput = () => { $('sensitivity-value').value = Number($('sensitivity').value).toFixed(2); };
$('desktop-control').onclick = async () => { if (!stream || !workerReady) { $('gesture-info').textContent = 'Enable air touch first, then arm desktop control.'; return; } try { await setDesktopArmed(!desktopArmed); $('gesture-info').textContent = desktopArmed ? 'Desktop control armed. First hand moves and pinches; second hand scrolls. Escape disarms.' : 'Desktop control disarmed.'; } catch { $('gesture-info').textContent = 'Desktop control could not arm.'; } };
$('low-power').onchange = () => { document.body.classList.toggle('low-power', $('low-power').checked); $('low-power').parentElement.querySelector('span').textContent = $('low-power').checked ? '8 FPS' : '15 FPS'; };
$('low-power').onchange();
document.addEventListener('keydown', e => { if (e.key === 'Escape') { stopCamera(); voiceMode = false; awake = false; recognition?.stop(); stopWakeAudio(); window.speechSynthesis?.cancel(); $('voice').textContent = 'Start voice control'; setSpeech(false); document.body.dataset.drawer = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopCamera('Camera paused while the workspace is hidden.'); voiceMode = false; recognition?.stop(); stopWakeAudio(); } });
window.addEventListener('pagehide', () => { stopCamera(); controller?.abort(); recognition?.stop(); stopWakeAudio(); window.speechSynthesis?.cancel(); });
$('notes').value = readLocal('jarvis.notes') || '';
$('notes').oninput = () => { $('notes-status').textContent = writeLocal('jarvis.notes', $('notes').value) ? 'SAVED ON THIS DEVICE' : 'STORAGE UNAVAILABLE · COPY YOUR NOTES'; };
async function connectObsidian() {
  if (!session) return;
  try { const response = await fetch('/api/obsidian', { headers: { 'X-Jarvis-Token': session.token } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); $('obsidian-status').textContent = `OBSIDIAN READY · ${data.notes.length} NOTES`; }
  catch { $('obsidian-status').textContent = 'OBSIDIAN VAULT UNAVAILABLE'; }
}
const localIntegrationButtons = {
  osiris: { button: $('osiris'), name: 'OSIRIS', url: 'http://127.0.0.1:3000' },
  godEye: { button: $('god-eye'), name: 'GOD’S EYE', url: 'http://127.0.0.1:4173' },
};
async function refreshIntegrations() {
  if (!session) return;
  try {
    const response = await fetch('/api/integrations', { headers: { 'X-Jarvis-Token': session.token } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    for (const [key, integration] of Object.entries(localIntegrationButtons)) {
      const ready = data.local?.[key]?.ready === true;
      integration.button.dataset.localReady = String(ready);
      integration.button.title = ready ? `Open local ${integration.name}` : `${integration.name} is not running on this computer.`;
    }
  } catch {
    for (const integration of Object.values(localIntegrationButtons)) integration.button.dataset.localReady = 'false';
  }
}
function openLocalIntegration(key) {
  const integration = localIntegrationButtons[key];
  if (integration.button.dataset.localReady !== 'true') {
    $('chat-status').textContent = `${integration.name} is offline on this computer. Start its local app, then retry.`;
    return;
  }
  window.open(integration.url, '_blank', 'noopener');
}
$('sync-obsidian').onclick = async () => {
  if (!session) return;
  const text = $('notes').value.trim();
  if (!text) { $('notes-status').textContent = 'WRITE A NOTE BEFORE SYNCING'; return; }
  $('sync-obsidian').disabled = true;
  try { const day = new Date().toISOString().slice(0, 10); const response = await fetch('/api/obsidian', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify({ action: 'append', path: `Jarvis/${day}.md`, text: `## ${new Date().toLocaleTimeString()}\n\n${text}` }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); $('obsidian-status').textContent = `SAVED · ${data.path}`; }
  catch (error) { $('obsidian-status').textContent = error.message || 'OBSIDIAN SYNC FAILED'; }
  finally { $('sync-obsidian').disabled = false; }
};
let remaining = 25 * 60, deadline = null;
function drawTimer() { if (deadline) { remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); if (!remaining) { deadline = null; $('focus').textContent = 'Start focus'; $('chat-status').textContent = 'Focus session complete. Take a short break.'; } } $('timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`; }
$('focus').onclick = () => { if (deadline) { drawTimer(); deadline = null; $('focus').textContent = 'Resume'; } else { if (!remaining) remaining = 1500; deadline = Date.now() + remaining * 1000; $('focus').textContent = 'Pause'; } };
$('reset-focus').onclick = () => { deadline = null; remaining = 1500; $('focus').textContent = 'Start focus'; drawTimer(); };
function clock() { const now = new Date(); $('clock').textContent = now.toLocaleTimeString('en-GB'); $('date').textContent = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase(); drawTimer(); }
clock(); setInterval(clock, 1000);
async function stats() { try { const response = await fetch('/api/status'); if (!response.ok) return; const data = await response.json(); $('cpu').textContent = `${data.cores} THREADS`; $('memory').textContent = `${((data.memoryTotal - data.memoryFree) / 1024 ** 3).toFixed(1)} / ${(data.memoryTotal / 1024 ** 3).toFixed(0)} GB`; } catch {} }
stats(); setInterval(() => { if (!document.hidden) stats(); }, 10000);
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('chat-status').textContent = 'Fullscreen unavailable in this browser.'; } };
$('chat-nav').onclick = () => $('prompt').focus(); $('notes-nav').onclick = () => $('notes').focus();
$('help').onclick = () => $('help-dialog').showModal(); $('close-help').onclick = () => $('help-dialog').close();
const intelligenceDialog = document.createElement('dialog');
intelligenceDialog.className = 'briefing-dialog';
intelligenceDialog.innerHTML = '<button class="briefing-close" aria-label="Close intelligence briefings">×</button><p class="eyebrow">PUBLIC-SOURCE INTELLIGENCE</p><h2>Current briefings</h2><p class="footnote">World, China, engineering, aircraft, markets, and OSIRIS intelligence.</p><div class="intel-list"></div>';
const intelligenceList = intelligenceDialog.querySelector('.intel-list');
intelligenceDialog.querySelector('button').onclick = () => intelligenceDialog.close();
document.body.append(intelligenceDialog);
$('intelligence').onclick = async () => {
  intelligenceList.replaceChildren(); intelligenceDialog.showModal();
  try {
    const response = await fetch('/api/briefings'); if (!response.ok) throw new Error();
    for (const feed of (await response.json()).feeds) for (const item of feed.items.slice(0, 3)) {
      const link = document.createElement('a'), category = document.createElement('span'), title = document.createElement('strong');
      link.href = item.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (feed.category === 'OSIRIS') {
        link.classList.add('intel-osiris');
        category.innerHTML = `<span class="osiris-badge">OSIRIS</span> · ${feed.source}`;
      } else {
        category.textContent = `${feed.category} · ${feed.source}`;
      }
      title.textContent = item.title; link.append(category, title); intelligenceList.append(link);
    }
  } catch { intelligenceList.textContent = 'Briefings are unavailable. Try again shortly.'; }
};
$('osiris').onclick = () => openLocalIntegration('osiris');
$('god-eye').onclick = () => openLocalIntegration('godEye');
$('command').onclick = () => {
  const frame = $('command-frame');
  if (!frame.getAttribute('src')) frame.src = '/command.html';
  $('command-dialog').showModal();
};
$('close-command').onclick = () => $('command-dialog').close();
$('agent').onclick = () => { $('agent-dialog').showModal(); loadAgentProjects(); };
$('close-agent').onclick = () => $('agent-dialog').close();
const agentRequest = async body => {
  if (!session) throw new Error('Reconnect before using the agent workspace.');
  const response = await fetch('/api/agent', body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify(body) } : { headers: { 'X-Jarvis-Token': session.token } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Agent workspace unavailable.'); return data;
};
const agentText = value => value == null || value === '' ? '—' : String(value);
function renderAgentProjects(projects) {
  const target = $('agent-projects');
  target.replaceChildren(...projects.map(project => {
    const item = document.createElement('article'); item.className = 'agent-project';
    const heading = document.createElement('div'); heading.className = 'agent-project-heading';
    const title = document.createElement('strong'); title.textContent = project.name || project.path;
    const state = document.createElement('span'); state.className = `agent-state ${project.enabled === false ? 'paused' : ''}`; state.textContent = project.enabled === false ? 'PAUSED' : 'ACTIVE';
    heading.append(title, state);
    const detail = document.createElement('small'); detail.textContent = `${agentText(project.path)}\nEvery ${agentText(project.scheduleMinutes || project.schedule_minutes || 60)} minutes · ${agentText(project.instruction || project.taskInstruction || 'No task instruction saved.')}`;
    const actions = document.createElement('div'); actions.className = 'agent-project-actions';
    const run = document.createElement('button'); run.type = 'button'; run.className = 'secondary'; run.textContent = 'Run now'; run.onclick = async () => { run.disabled = true; try { await agentRequest({ action: 'run_project', id: project.id }); await loadAgentProjects(); } catch (error) { $('agent-channel-status').textContent = error.message; } finally { run.disabled = false; } };
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Remove'; remove.onclick = async () => { remove.disabled = true; try { await agentRequest({ action: 'remove_project', id: project.id }); await loadAgentProjects(); } catch (error) { $('agent-channel-status').textContent = error.message; } finally { remove.disabled = false; } };
    actions.append(run, remove); item.append(heading, detail, actions); return item;
  }));
  if (!projects.length) target.textContent = 'No local projects registered.';
}
function renderAgentJobs(jobs) {
  const target = $('agent-jobs');
  target.replaceChildren(...jobs.slice(0, 12).map(job => {
    const item = document.createElement('article'); item.className = 'agent-job';
    const title = document.createElement('strong'); title.textContent = job.projectName || job.project_name || 'JARVIS job';
    const detail = document.createElement('small'); detail.textContent = `${agentText(job.status).toUpperCase()} · ${agentText(job.finishedAt || job.finished_at || job.startedAt || job.started_at)}${job.deploymentUrl || job.deployment_url ? `\n${job.deploymentUrl || job.deployment_url}` : ''}`;
    item.append(title, detail); return item;
  }));
  if (!jobs.length) target.textContent = 'No jobs have run yet.';
}
async function loadAgentProjects(scan = false) {
  try {
    const data = await agentRequest(scan ? { action: 'scan_projects' } : null);
    const projects = data.projects || []; renderAgentProjects(projects); renderAgentJobs(data.jobs || data.history || []);
    const channels = data.communications || session?.communications || {};
    const notificationText = `Slack ${channels.slack ? 'ready' : 'needs setup'} · Discord ${channels.discord ? 'ready' : 'needs setup'}`;
    $('agent-channel-status').textContent = `Alerts: ${notificationText}. Webhook values stay in local environment variables.`;
    $('agent-notification-health').textContent = notificationText;
    const current = data.currentJob || data.current_job;
    $('agent-current-task').textContent = current ? `${current.projectName || current.project_name || 'JARVIS'} · ${current.status || 'running'}` : 'No active job';
    const vault = data.vault || {}; $('agent-daily-path').textContent = vault.daily || 'C:\\jarvis\\01 Daily'; $('agent-research-path').textContent = vault.research || 'C:\\jarvis\\04 Research';
    const killSwitch = data.killSwitch ?? data.kill_switch;
    if (typeof killSwitch === 'boolean') $('agent-kill-switch').checked = !killSwitch;
    if (data.prompt && document.activeElement !== $('agent-prompt')) $('agent-prompt').value = data.prompt;
  } catch (error) { $('agent-projects').textContent = error.message || 'Agent workspace unavailable.'; }
}
$('agent-project-form').onsubmit = async event => {
  event.preventDefault(); const path = $('agent-project-path').value.trim(); if (!path) return;
  const button = $('add-agent-project'); button.disabled = true;
  try {
    await agentRequest({ action: 'add_project', path, instruction: $('agent-project-instruction').value.trim(), scheduleMinutes: Number($('agent-project-schedule').value) || 60, taskCommand: $('agent-project-command').value.trim(), deployCommand: $('agent-project-deploy').value.trim() });
    event.currentTarget.reset(); $('agent-project-schedule').value = '60'; await loadAgentProjects();
  } catch (error) { $('agent-channel-status').textContent = error.message || 'Could not register project.'; }
  finally { button.disabled = false; }
};
$('scan-agent-projects').onclick = () => loadAgentProjects(true);
$('agent-kill-switch').onchange = async event => {
  const enabled = event.currentTarget.checked; event.currentTarget.disabled = true;
  try { await agentRequest({ action: 'set_kill_switch', enabled: !enabled }); await loadAgentProjects(); }
  catch (error) { event.currentTarget.checked = !enabled; $('agent-channel-status').textContent = error.message || 'Could not update automation.'; }
  finally { event.currentTarget.disabled = false; }
};
$('save-agent-prompt').onclick = async () => {
  const button = $('save-agent-prompt'); button.disabled = true;
  try { await agentRequest({ action: 'set_prompt', prompt: $('agent-prompt').value.trim() }); await loadAgentProjects(); }
  catch (error) { $('agent-channel-status').textContent = error.message || 'Could not save the operating prompt.'; }
  finally { button.disabled = false; }
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
import './sphere.js';
let briefingFeeds;
async function openBriefing({ index, category }) {
  const dialog = $('briefing-dialog');
  $('briefing-category').textContent = `${category} / PARTICLE ${String(index + 1).padStart(4, '0')}`;
  $('briefing-title').textContent = 'Loading current briefing…'; $('briefing-summary').textContent = ''; $('briefing-meta').textContent = ''; $('briefing-link').hidden = true; dialog.showModal();
  try {
    if (!briefingFeeds) { const response = await fetch('/api/briefings'); if (!response.ok) throw new Error(); briefingFeeds = (await response.json()).feeds; }
    const feed = briefingFeeds.find(item => item.category === category), item = feed?.items[index % Math.max(1, feed.items.length)];
    if (!item) throw new Error();
    $('briefing-title').textContent = item.title; $('briefing-summary').textContent = item.summary || 'Open the original source for the complete report.';
    $('briefing-meta').textContent = `${feed.source} · ${item.published ? new Date(item.published).toLocaleString() : 'time not supplied'} · refreshed ${new Date(feed.fetchedAt).toLocaleTimeString()}`;
    $('briefing-link').href = item.link; $('briefing-link').hidden = false;
  } catch { $('briefing-title').textContent = 'Briefing unavailable'; $('briefing-summary').textContent = 'This source could not be refreshed. Select another particle or try again shortly.'; }
}
window.addEventListener('sphere-dot-select', event => openBriefing(event.detail));
async function showPreview({ index, category }) {
  const preview = $('briefing-preview'); preview.hidden = false; $('preview-category').textContent = `${category} / ZOOM PREVIEW`; $('preview-title').textContent = 'Loading current briefing…'; $('preview-meta').textContent = ''; $('market-chart').hidden = true;
  try {
    if (!briefingFeeds) { const response = await fetch('/api/briefings'); if (!response.ok) throw new Error(); briefingFeeds = (await response.json()).feeds; }
    const feed = briefingFeeds.find(item => item.category === category), item = feed?.items[index % Math.max(1, feed.items.length)]; if (!item) throw new Error();
    $('preview-title').textContent = item.title; $('preview-meta').textContent = `${feed.source} · ${item.published ? new Date(item.published).toLocaleString() : 'time not supplied'}`;
    if (category === 'MARKETS') { const market = await (await fetch('/api/markets')).json(), values = market.values; if (values?.length) { const low = Math.min(...values), range = Math.max(1e-8, Math.max(...values) - low); $('market-line').setAttribute('points', values.map((value, point) => `${point * 240 / (values.length - 1)},${68 - (value - low) / range * 64}`).join(' ')); $('market-chart').hidden = false; $('preview-meta').textContent = `${market.symbol} · ${market.currency} · ${new Date(market.fetchedAt).toLocaleTimeString()}`; } }
  } catch { $('preview-title').textContent = 'Briefing preview unavailable'; }
}
window.addEventListener('sphere-preview', event => showPreview(event.detail));
$('close-briefing').onclick = () => $('briefing-dialog').close();
let pendingComputerAction;
function computerFields() {
  const kind = $('computer-kind').value, labels = { open_url: ['Website URL', 'https://example.com'], open_app: ['Application path', 'C:\\Program Files\\App\\App.exe'], download: ['Download URL', 'https://example.com/file.pdf'], find: ['File name fragment', 'report'], run_command: ['Command and arguments', 'git status'], slack_message: ['Slack message', 'Status update from JARVIS'], discord_message: ['Discord message', 'Status update from JARVIS'], telegram_message: ['Telegram message', 'Status update from JARVIS'] };
  $('computer-main-label').childNodes[0].nodeValue = `${labels[kind][0]} `; $('computer-main').placeholder = labels[kind][1]; $('computer-extra-label').hidden = kind !== 'download';
}
function actionFromForm() {
  const kind = $('computer-kind').value, main = $('computer-main').value.trim();
  if (kind === 'slack_message' || kind === 'telegram_message') return { action: kind, text: main };
  if (kind === 'open_url') return { action: kind, url: main };
  if (kind === 'open_app') return { action: kind, path: main };
  if (kind === 'download') return { action: kind, url: main, name: $('computer-extra').value.trim() };
  if (kind === 'find') return { action: kind, query: main };
  return { action: kind, command: main.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(part => part.replaceAll('"', '')) || [] };
}
$('computer-kind').onchange = computerFields; computerFields();
$('close-computer').onclick = () => $('computer-dialog').close();
$('review-computer').onclick = () => { pendingComputerAction = actionFromForm(); $('computer-preview').textContent = JSON.stringify(pendingComputerAction, null, 2); $('approve-dialog').showModal(); };
$('cancel-computer').onclick = () => $('approve-dialog').close();
$('approve-computer').onclick = async () => {
  if (!pendingComputerAction || !session) return;
  $('approve-computer').disabled = true;
  try { const response = await fetch('/api/computer', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token }, body: JSON.stringify(pendingComputerAction) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); $('computer-result').textContent = [data.message, data.output, data.results?.join('\n')].filter(Boolean).join('\n\n'); $('approve-dialog').close(); }
  catch (error) { $('computer-result').textContent = error.message || 'Action failed.'; $('approve-dialog').close(); }
  finally { $('approve-computer').disabled = false; pendingComputerAction = null; }
};
const toolbar = document.createElement('nav');
toolbar.className = 'drawer-toolbar';
toolbar.setAttribute('aria-label', 'Controls');
for (const [name, label] of [['chat','Conversation'],['notes','Memory'],['air','Air touch']]) {
  const button = document.createElement('button'); button.textContent = label;
  button.onclick = () => { document.body.dataset.drawer = document.body.dataset.drawer === name ? '' : name; };
  toolbar.append(button);
}
document.body.append(toolbar);
const voiceStatus = document.createElement('p'); voiceStatus.id='voice-status'; voiceStatus.setAttribute('role','status');
$('voice').closest('.core-controls').after(voiceStatus);
new MutationObserver(() => { voiceStatus.textContent=$('chat-status').textContent; }).observe($('chat-status'), {childList:true,subtree:true,characterData:true});



