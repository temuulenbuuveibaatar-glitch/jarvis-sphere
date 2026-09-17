import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('every desktop start blocks browser recognition unless local speech is ready', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.slice(source.indexOf('function startVoice()'), source.indexOf('function handleTranscript('));
  let localCalls = 0, browserCalls = 0;
  const context = vm.createContext({ recognition: null, sending: false, voiceMode: true,
    session: { localSpeechReady: false }, awake: false,
    navigator: { userAgent: 'Electron/40' },
    window: { SpeechRecognition: function () { browserCalls++; } },
    $: () => ({ classList: { remove() {} } }), stopWakeAudio() {}, setSpeech() {},
    startLocalVoice() { localCalls++; }
  });
  vm.runInContext(start + ';startVoice();', context);
  assert.equal(browserCalls, 0);
  assert.equal(context.voiceMode, false);
  context.voiceMode = true; context.session.localSpeechReady = true;
  vm.runInContext('startVoice()', context);
  assert.equal(localCalls, 1);
});
