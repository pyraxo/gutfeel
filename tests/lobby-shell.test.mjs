import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const publicFile = name => new URL(`../web/public/${name}`, import.meta.url);

function idsIn(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id));
}

function selectorsIn(source) {
  return new Set([...source.matchAll(/\$\('#([^']+)'\)/g)].map(([, id]) => id));
}

test('lobby shell contains every DOM control its startup scripts require', async () => {
  const [html, lobby, shell] = await Promise.all([
    readFile(publicFile('index.html'), 'utf8'),
    readFile(publicFile('lobby.js'), 'utf8'),
    readFile(publicFile('shell.js'), 'utf8'),
  ]);
  const ids = idsIn(html);
  const requiredLobbyIds = [
    'lobby', 'lobby-create', 'lobby-join', 'lobby-session', 'lobby-error',
    'creator-name', 'player-name', 'join-code', 'scenario', 'lobby-code',
    'lobby-state', 'lobby-roster', 'lobby-players', 'copy-invite', 'copy-code',
    'share-fallback', 'share-label', 'share-value', 'share-close',
    'open-mission-control', 'close-mission-control', 'start-lobby',
    'leave-lobby', 'switch-lobby', 'end-lobby', 'host-agent-frame',
    'play-surface', 'game-toolbar', 'game-lobby-toggle', 'game-lobby-panel', 'game-stage',
    'game-controls', 'controls-more', 'secondary-controls', 'game-lobby-close',
  ];
  for (const id of requiredLobbyIds) assert.ok(ids.has(id), `index.html is missing #${id}`);
  for (const id of selectorsIn(lobby)) assert.ok(ids.has(id), `lobby.js selects missing #${id}`);
  for (const id of selectorsIn(shell)) assert.ok(ids.has(id), `shell.js selects missing #${id}`);
  assert.match(html, /<script src="shell\.js"><\/script><script src="lobby\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="controls\.css">/);
  assert.match(html, /<script src="control-input\.js"><\/script><script src="shell\.js">/);
  assert.match(html, /<a href="\/">Play<\/a><a href="\?mode=tutorial">Training<\/a><a href="about\.html">About<\/a><a href="technical\.html">How it works<\/a>/);
  assert.match(html, /<main[^>]+>[\s\S]*Copyright and project status[\s\S]*id="lobby"/);
  assert.match(html, /href="legal\.html">Legal and attributions<\/a>/);
  assert.doesNotMatch(html, />Reports<|>Host a game</);
  assert.match(html, /<div id="game-stage">[\s\S]*id="game"[\s\S]*id="status"[\s\S]*id="game-controls"/);
  assert.match(lobby, /\/remove`/);
  assert.match(lobby, /endsWith\('\/technical\.html'\)/);
  assert.match(lobby, /!player\.creator/);
  assert.match(lobby, /!player\.connected \|\| !player\.ready/);
});
