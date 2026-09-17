import test from 'node:test';
import assert from 'node:assert/strict';
import { createGutFeelServer } from '../server.mjs';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';

test('serves the shell and rejects traversal/sibling paths', async t => {
  const { server, multiuser } = createGutFeelServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { multiuser.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Gut Feel/);
  const head = await fetch(`${base}/shell.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /javascript/);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${base}/%2e%2e/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/../web/publicity`)).status, 404);
  const technical = await fetch(`${base}/technical.html`);
  assert.equal(technical.status, 200);
  assert.match(await technical.text(), /How the old game runs in a browser/);
  const legal = await fetch(`${base}/legal.html`);
  assert.equal(legal.status, 200);
  assert.match(await legal.text(), /Legal and attributions/);
  const localSource = await fetch(`${base}/source`);
  assert.equal(localSource.status, 200);
  assert.match(await localSource.text(), /this development working tree/);
  const original=await (await fetch(`${base}/shell.js`,{headers:{'accept-encoding':'identity'}})).text();
  const compressed=await new Promise((resolve,reject)=>{request(`${base}/shell.js`,{headers:{'accept-encoding':'gzip'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({res,body:Buffer.concat(chunks)}));}).on('error',reject).end()});
  assert.equal(compressed.res.headers['content-encoding'],'gzip'); assert.equal(compressed.res.headers.vary,'Accept-Encoding'); assert.equal(gunzipSync(compressed.body).toString(),original);
  assert.equal(compressed.res.headers['content-length'],undefined);
  const identity=await new Promise((resolve,reject)=>{request(`${base}/shell.js`,{headers:{'accept-encoding':'gzip;q=0'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({res,body:Buffer.concat(chunks)}));}).on('error',reject).end()});
  assert.equal(identity.res.headers['content-encoding'],undefined); assert.equal(Number(identity.res.headers['content-length']),identity.body.length); assert.equal(identity.body.toString(),original);
});

test('public source route redirects to configured corresponding source', async t => {
  const { server, multiuser } = createGutFeelServer({
    sourceCodeUrl: 'https://code.example.test/gutfeel/release-1/',
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { multiuser.close(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/source`, {
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://code.example.test/gutfeel/release-1/');
});
