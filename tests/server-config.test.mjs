import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  clientAddress,
  normalizePublicOrigin,
  normalizeSourceCodeUrl,
  parseTrustedProxyAddresses,
  serverConfiguration,
} from "../server/config.mjs";

test("production requires one explicit canonical HTTP(S) public origin", () => {
  assert.throws(
    () => serverConfiguration({}, { NODE_ENV: "production" }),
    /PUBLIC_ORIGIN is required/,
  );
  assert.equal(
    serverConfiguration({}, {
      NODE_ENV: "production",
      PUBLIC_ORIGIN: "https://play.example.test/",
      SOURCE_CODE_URL: "https://code.example.test/gutfeel/",
    }).publicOrigin,
    "https://play.example.test",
  );
  for (const invalid of [
    "ftp://play.example.test",
    "https://play.example.test/path",
    "https://user:pass@play.example.test",
    "not a URL",
  ]) assert.throws(() => normalizePublicOrigin(invalid), /PUBLIC_ORIGIN/);
  assert.throws(
    () => serverConfiguration({}, {
      NODE_ENV: "production",
      PUBLIC_ORIGIN: "https://play.example.test/",
    }),
    /SOURCE_CODE_URL is required/,
  );
  assert.equal(
    normalizeSourceCodeUrl("https://code.example.test/gutfeel"),
    "https://code.example.test/gutfeel",
  );
  for (const invalid of [
    "ftp://code.example.test/gutfeel",
    "https://user:pass@code.example.test/gutfeel",
    "not a URL",
  ]) assert.throws(() => normalizeSourceCodeUrl(invalid), /SOURCE_CODE_URL/);

  const result = spawnSync(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 2_000,
    env: { ...process.env, NODE_ENV: "production", PUBLIC_ORIGIN: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PUBLIC_ORIGIN is required/);

  const missingSource = spawnSync(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 2_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PUBLIC_ORIGIN: "https://play.example.test",
      SOURCE_CODE_URL: "",
    },
  });
  assert.equal(missingSource.status, 1);
  assert.match(missingSource.stderr, /SOURCE_CODE_URL is required/);
});

test("forwarded client addresses are used only behind explicitly trusted peers", () => {
  const request = (remoteAddress, forwarded) => ({
    socket: { remoteAddress },
    headers: forwarded == null ? {} : { "x-forwarded-for": forwarded },
  });
  assert.equal(
    clientAddress(request("127.0.0.1", "198.51.100.20")),
    "127.0.0.1",
  );
  const cloudflareRequest = {
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "x-gutfeel-client-ip": "203.0.113.7" },
  };
  assert.equal(clientAddress(cloudflareRequest), "127.0.0.1");
  assert.equal(
    clientAddress(cloudflareRequest, new Set(), true),
    "203.0.113.7",
  );
  assert.equal(
    clientAddress({
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "cf-connecting-ip": "203.0.113.8" },
    }, new Set(), true),
    "203.0.113.8",
  );
  assert.equal(
    serverConfiguration({}, {
      TRUST_CLOUDFLARE_CONNECTING_IP: "1",
    }).trustCloudflareConnectingIp,
    true,
  );

  const trusted = parseTrustedProxyAddresses("127.0.0.1, 10.0.0.2");
  assert.equal(
    clientAddress(request("127.0.0.1", "198.51.100.20"), trusted),
    "198.51.100.20",
  );
  assert.equal(
    clientAddress(
      request("::ffff:127.0.0.1", "192.0.2.66, 198.51.100.20, 10.0.0.2"),
      trusted,
    ),
    "198.51.100.20",
    "walk right-to-left past known proxies instead of trusting a spoofed leftmost hop",
  );
  assert.equal(
    clientAddress(request("127.0.0.1", "malformed forwarded value"), trusted),
    "127.0.0.1",
  );
});
