import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/public/bridge.js', import.meta.url), 'utf8');
function bridge(page, session) {
  const context = {URL, URLSearchParams, location: new URL(page), window: {fetch: async () => {}}};
  vm.runInNewContext(source, context);
  context.window.gutfeelLobbySession = session;
  return context.window.dirplayerResolveSocketUrl;
}

test('a player on the Host navigation route retains player authority', () => {
  const resolve = bridge('https://gutfeel.example/?mode=host', {
    lobbyId: 'test-lobby', credential: 'player-credential', instance: 'browser-instance', role: 'player',
  });
  const main = new URL(resolve('localhost', 1626, {kind: 'connect', userId: 'Alice_1'}));
  assert.equal(main.protocol, 'wss:');
  assert.equal(main.host, 'gutfeel.example');
  assert.equal(main.searchParams.get('mode'), null);
  assert.equal(main.searchParams.get('credential'), 'player-credential');
  const peer = new URL(resolve('localhost', 1627, {kind: 'peer-host', userId: 'Alice_1'}));
  assert.equal(peer.searchParams.get('role'), 'peer-host');
  assert.equal(peer.searchParams.get('mode'), null);
});

test('the facilitator frame gets Host mode from its credential role', () => {
  const resolve = bridge('https://gutfeel.example/host-agent.html', {
    lobbyId: 'test-lobby', credential: 'host-credential', instance: 'host-instance', role: 'facilitator',
  });
  const endpoint = new URL(resolve('localhost', 1626, {kind: 'connect', userId: 'host'}));
  assert.equal(endpoint.searchParams.get('mode'), 'host');
});
