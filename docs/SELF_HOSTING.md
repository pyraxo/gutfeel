# Self-hosting Gut Feel

The service serves the browser client and report files over HTTP and upgrades
`/multiuser` to the WebSocket Multiuser transport. Keep the HTTP and WebSocket
origins together: clients resolve both through the same host and port.

## Docker

```sh
docker build -t gutfeel .
docker run --rm --name gutfeel \
  -e PUBLIC_ORIGIN=http://localhost:4173 \
  -e SOURCE_CODE_URL=https://code.example/gutfeel \
  -p 4173:4173 gutfeel
```

Open `http://localhost:4173`. For LAN play, open the Docker host’s LAN address
on each device and allow TCP port 4173 through its firewall. The container
uses `NODE_ENV=production` and refuses to start without `PUBLIC_ORIGIN`; replace
the localhost value above with the exact LAN origin that browsers open. The
container also requires `SOURCE_CODE_URL`, which must identify the published Corresponding
Source for the exact build served by the container. The site's `/source` route
redirects to that URL. Replace the example before starting the container. The
container holds no gameplay database; persistent process uptime is required while a live
session is running. Use a process supervisor or restart policy for long-lived
hosting.

The image runs as the unprivileged `node` user and includes a `/health`
container check. Its whitelist `.dockerignore` sends only the production
server, package manifests, Dockerfile, and `web/public` into the build context.

The browser lobby flow is the default. `GUTFEL_LEGACY_OPEN=1` restores the old
unscoped relay and unauthenticated legacy Host-directory mutation routes for a
trusted LAN compatibility test only. Do not enable it on an Internet service.

## Internet configuration

For Internet hosting, terminate TLS at a reverse proxy and forward both normal
HTTP requests and WebSocket upgrades to `http://127.0.0.1:4173`. Preserve the
`/multiuser` path and use a WebSocket-aware proxy with adequate idle timeouts.
Serve the site as HTTPS so browsers can use the corresponding secure WebSocket
connection. Do not expose a separate WebSocket port or rewrite the path.

Set `PUBLIC_ORIGIN` to the exact external origin, including scheme and any
non-default port. This value gates lobby HTTP requests and WebSocket upgrades:

```sh
docker run --rm --name gutfeel \
  -e PUBLIC_ORIGIN=https://gutfeel.example.org \
  -e SOURCE_CODE_URL=https://code.example/gutfeel \
  -p 127.0.0.1:4173:4173 \
  gutfeel
```

The reverse proxy must preserve the browser `Origin` header. Requests from
another Origin are rejected. Do not set `GUTFEL_LEGACY_OPEN` in this mode.

By default, API rate limits use the direct TCP peer. A local reverse proxy makes
that address the proxy itself, so opt in only the exact proxy peer addresses:

```sh
-e TRUSTED_PROXY_IPS=127.0.0.1,::1
```

The server ignores `X-Forwarded-For` from every other peer. For a trusted chain,
it walks right-to-left past configured proxy addresses and uses the first
untrusted address, avoiding blind trust in an attacker-supplied leftmost value.
Configure each trusted proxy to replace or correctly append the forwarding
header. Do not list broad client-facing networks or enable this variable unless
the named addresses are controlled proxies.

Player and facilitator credentials are kept out of share URLs, but the browser
WebSocket API cannot set an Authorization header. The runtime therefore sends
the scoped credential in the internal `/multiuser` query. Configure proxy and
access logs to omit or redact the `credential` query value, and do not retain
full WebSocket request targets in diagnostics.

Run one application replica. Lobby registries, original MUS groups, peer-host
routes, and Host-directory entries are in process memory. Horizontal replicas
would require tested socket affinity and shared lobby routing; a restart or
rolling replacement interrupts live games. The original game does not elect a
new peer host or reconstruct an interrupted match.

The `/health` endpoint is a lightweight readiness check. It reports the HTTP
service status and currently registered legacy Host directory entries; it does
not prove that a lobby invite is valid, that a peer route is live, or that a
session is playable.

The static server resolves requested paths beneath `web/public`, rejects NUL and
traversal paths, serves only regular files, and supports `HEAD`. Keep the
original asset tree and generated runtime files in the image; they are part of
the browser application.

This guide documents deployment setup only. The public repository intentionally
omits internal migration, implementation, performance, and validation notes.
