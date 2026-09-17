import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const publicFile = name => new URL(`../web/public/${name}`, import.meta.url);

test('expanded story keeps its history, archive source, and technical route', async () => {
  const about = await readFile(publicFile('about.html'), 'utf8');
  assert.match(about, /We had a whole digestive system to run/);
  assert.match(about, /Astra made the recovery possible/);
  assert.match(about, /Amdon Consulting Pte Ltd/);
  assert.match(about, /web\.archive\.org\/web\/20240418010756/);
  assert.match(about, /href="technical\.html">Read how it works/);
  assert.doesNotMatch(about, /\bcarry(?:ing|ies|ied)?\b/i);
});

test('technical guide exposes every major system in simple sections', async () => {
  const technical = await readFile(publicFile('technical.html'), 'utf8');
  for (const id of [
    'original-files', 'system-map', 'runtime', 'original-and-new', 'bridge',
    'startup', 'multiplayer', 'reports', 'security', 'assets', 'limits',
  ]) assert.match(technical, new RegExp(`id="${id}"`), `technical.html is missing #${id}`);
  assert.match(technical, /<table>/);
  assert.match(technical, /Terms used on this page/);
});

test('legal page separates original rights from project and third-party licences', async () => {
  const legal = await readFile(publicFile('legal.html'), 'utf8');
  assert.match(legal, /Amdon Consulting Pte Ltd/);
  assert.match(legal, /not affiliated with or endorsed/);
  assert.match(legal, /GNU GPL version 3 only/);
  assert.match(legal, /href="\/source"/);
  assert.match(legal, /DirPlayer/);
  assert.match(legal, /Ruffle/);
  assert.match(legal, /ws 8\.21\.3/);
  assert.match(legal, /Bricolage Grotesque/);
});
