import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_IP_HEADER,
  CREDENTIAL_HEADER,
  prepareContainerRequest,
} from "../cloudflare/request.mjs";

test("Cloudflare forwarding removes credentials from the URL", () => {
  const request = new Request(
    "https://gutfeel.atzy.dev/multiuser?lobby=abc&credential=secret&instance=one",
    {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        [CLIENT_IP_HEADER]: "198.51.100.4",
        [CREDENTIAL_HEADER]: "spoofed",
        upgrade: "websocket",
      },
    },
  );

  const forwarded = prepareContainerRequest(request);
  const url = new URL(forwarded.url);
  assert.equal(url.searchParams.get("credential"), null);
  assert.equal(url.searchParams.get("lobby"), "abc");
  assert.equal(url.searchParams.get("instance"), "one");
  assert.equal(forwarded.headers.get(CREDENTIAL_HEADER), "secret");
  assert.equal(forwarded.headers.get(CLIENT_IP_HEADER), "203.0.113.9");
  assert.equal(forwarded.headers.get("upgrade"), "websocket");
});

test("Cloudflare forwarding clears spoofed internal headers", () => {
  const request = new Request("https://gutfeel.atzy.dev/health", {
    headers: {
      [CLIENT_IP_HEADER]: "198.51.100.4",
      [CREDENTIAL_HEADER]: "spoofed",
    },
  });
  const forwarded = prepareContainerRequest(request);
  assert.equal(forwarded.headers.get(CREDENTIAL_HEADER), null);
  assert.equal(forwarded.headers.get(CLIENT_IP_HEADER), null);
});
