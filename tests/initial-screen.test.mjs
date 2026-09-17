import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../web/public/index.html', import.meta.url), 'utf8');

test('the initial HTML cannot paint the generic game screen before route setup', () => {
  for (const id of ['play-surface', 'game-controls']) {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `Missing ${id}`);
    assert.match(tag, /\bhidden\b/, `${id} is visible before the page chooses Play or Training`);
  }
});

test('route setup does not wait for the large game runtime to download', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)];
  const shell = scripts.findIndex(match => match[2] === 'shell.js');
  const runtime = scripts.findIndex(match => match[2] === 'runtime/dirplayer-polyfill.js');
  assert.ok(shell >= 0);
  assert.ok(runtime < 0 || runtime > shell || /\b(?:async|defer)\b/.test(scripts[runtime][1] + scripts[runtime][3]),
    'The runtime blocks shell.js while the generic launch screen is visible');
});
