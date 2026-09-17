import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const hostAgentUrl = new URL('../web/public/host-agent.js', import.meta.url);
const lobbyUrl = new URL('../web/public/lobby.js', import.meta.url);

async function hostAgentHarness() {
  const source = (await readFile(hostAgentUrl, 'utf8'))
    .replace("import {bootstrapLobbyMovie, startLobbyMatch} from './lobby-runtime.js';\n", '');
  let messageListener;
  const parent = {postMessage() {}};
  const window = {
    addEventListener(type, listener) {
      if (type === 'message') messageListener = listener;
    },
    getAudioContext() { return null; },
  };
  const context = {
    window,
    parent,
    location: {origin: 'https://gutfeel.example'},
    document: {querySelector() { return {textContent: ''}; }},
    setInterval() {},
    fetch() { return new Promise(() => {}); },
    bootstrapLobbyMovie() {},
    startLobbyMatch() {},
  };
  vm.runInNewContext(source, context);
  return {context, parent, listener: messageListener};
}

test('a hidden Host starts capture-capped and accepts visibility only from its same-origin parent', async () => {
  const {context, parent, listener} = await hostAgentHarness();
  assert.equal(context.window.__dirplayerFlashCaptureMaxFps, 1);

  listener({source: {}, origin: 'https://gutfeel.example', data: {
    type: 'gutfeel:lobby-host-visibility', lobbyId: 'lobby-a', visible: true,
  }});
  listener({source: parent, origin: 'https://untrusted.example', data: {
    type: 'gutfeel:lobby-host-visibility', lobbyId: 'lobby-a', visible: true,
  }});
  assert.equal(context.window.__dirplayerFlashCaptureMaxFps, 1);

  // Initialisation records the identity before its asynchronous lobby lookup;
  // a following parent message can therefore update only this Host's cap.
  listener({source: parent, origin: 'https://gutfeel.example', data: {
    type: 'gutfeel:lobby-host-init', lobbyId: 'lobby-a', credential: 'secret', instance: 'one',
  }});
  listener({source: parent, origin: 'https://gutfeel.example', data: {
    type: 'gutfeel:lobby-host-visibility', lobbyId: 'lobby-a', visible: true,
  }});
  assert.equal(context.window.__dirplayerFlashCaptureMaxFps, 0);

  listener({source: parent, origin: 'https://gutfeel.example', data: {
    type: 'gutfeel:lobby-host-visibility', lobbyId: 'other-lobby', visible: false,
  }});
  assert.equal(context.window.__dirplayerFlashCaptureMaxFps, 0);

  listener({source: parent, origin: 'https://gutfeel.example', data: {
    type: 'gutfeel:lobby-host-visibility', lobbyId: 'lobby-a', visible: false,
  }});
  assert.equal(context.window.__dirplayerFlashCaptureMaxFps, 1);
});

test('the lobby re-synchronizes Host capture visibility after load and both Host handshakes', async () => {
  const source = await readFile(lobbyUrl, 'utf8');
  assert.match(source, /function postHostCaptureVisibility\(visible\)/);
  assert.match(source, /type: 'gutfeel:lobby-host-visibility'/);
  assert.match(source, /function openMissionControl\(open\)[\s\S]*?postHostCaptureVisibility\(open\)/);
  assert.match(source, /gutfeel:lobby-host-agent-loaded[\s\S]*?postHostCaptureVisibility\(/);
  assert.match(source, /gutfeel:lobby-host-ready[\s\S]*?postHostCaptureVisibility\(/);
  assert.match(source, /hostFrame\.addEventListener\('load',[\s\S]*?postHostCaptureVisibility\(/);
});
