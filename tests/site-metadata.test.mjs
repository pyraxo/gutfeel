import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicFile = (name) => new URL(`../web/public/${name}`, import.meta.url);

const pages = [
  ["index.html", "https://gutfeel.atzy.dev/"],
  ["about.html", "https://gutfeel.atzy.dev/about.html"],
  ["technical.html", "https://gutfeel.atzy.dev/technical.html"],
  ["legal.html", "https://gutfeel.atzy.dev/legal.html"],
  ["report.html", "https://gutfeel.atzy.dev/report.html"],
];

test("public pages expose canonical social and install metadata", async () => {
  for (const [name, canonical] of pages) {
    const html = await readFile(publicFile(name), "utf8");
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.match(html, /<meta property="og:title" content="[^"]+">/);
    assert.match(html, /<meta property="og:description" content="[^"]+">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/gutfeel\.atzy\.dev\/report-assets\/anatomy\.png">/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));
    assert.match(html, /<link rel="icon"[^>]+href="\/report-assets\/icon\.png">/);
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  }
});

test("homepage structured data and crawl files are valid", async () => {
  const homepage = await readFile(publicFile("index.html"), "utf8");
  const match = homepage.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(match);
  const structured = JSON.parse(match[1]);
  assert.equal(structured.url, "https://gutfeel.atzy.dev/");
  assert.equal(structured.isAccessibleForFree, true);

  const manifest = JSON.parse(await readFile(publicFile("manifest.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.icons[0].src, "/report-assets/icon.png");

  const robots = await readFile(publicFile("robots.txt"), "utf8");
  assert.match(robots, /Sitemap: https:\/\/gutfeel\.atzy\.dev\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/host-agent\.html/);

  const sitemap = await readFile(publicFile("sitemap.xml"), "utf8");
  for (const [, canonical] of pages) assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
});

test("internal mission control cannot be indexed", async () => {
  const html = await readFile(publicFile("host-agent.html"), "utf8");
  assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive">/);
});
