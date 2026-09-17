import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGutFeelServer } from "../server.mjs";
import { decodeMessage, encodeMessage } from "../server/multiuser.mjs";

const PUBLIC_ORIGIN = "https://play.gutfeel.test";
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function logonMessage(movie, name, password = "pass") {
  return {
    subject: "Logon",
    senderId: name,
    recipients: ["System"],
    content: {
      type: "list",
      value: [movie, name, password].map((value) => ({
        type: "string",
        value,
      })),
    },
  };
}

function property(content, name) {
  return content?.pairs?.find(([key]) => key.value === name)?.[1];
}

async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, "close");
  if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  else socket.close();
  await Promise.race([closed, delay(100)]);
  if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
}

async function startPublicServer(t) {
  const { server, multiuser } = createGutFeelServer({
    publicOrigin: PUBLIC_ORIGIN,
    legacyOpen: false,
  });
  const sockets = new Set();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await Promise.all([...sockets].map(closeSocket));
    await new Promise((resolve) => multiuser.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;
  return {
    httpBase: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
    sockets,
  };
}

async function api(
  app,
  pathname,
  { method = "GET", token = "", origin = PUBLIC_ORIGIN, body } = {},
) {
  const headers = {};
  if (origin != null) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(app.httpBase + pathname, init);
  const text = await response.text();
  let value = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { status: response.status, value };
}

async function createLobby(app) {
  const result = await api(app, "/api/lobbies", {
    method: "POST",
    body: {},
  });
  assert.equal(result.status, 201);
  assert.match(result.value.lobbyId, /^[A-Za-z0-9_-]+$/);
  assert.ok(result.value.facilitatorToken);
  assert.ok(result.value.creatorPlayerToken);
  return result.value;
}

async function joinLobby(app, lobbyId) {
  const result = await api(app, `/api/lobbies/${lobbyId}/join`, {
    method: "POST",
    body: {},
  });
  assert.equal(result.status, 201);
  assert.ok(result.value.playerToken);
  return result.value;
}

function socketPath({ lobbyId, credential, instance, ...query }) {
  const params = new URLSearchParams({
    lobby: lobbyId,
    instance,
    ...Object.fromEntries(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    ),
  });
  if (credential) params.set("credential", credential);
  return `/multiuser?${params}`;
}

async function openClient(
  app,
  { lobbyId, credential, credentialHeader = false, instance, movie = "DS", name, origin = PUBLIC_ORIGIN, ...query },
) {
  const socket = new WebSocket(
    app.wsBase + socketPath({
      lobbyId,
      credential: credentialHeader ? "" : credential,
      instance,
      ...query,
    }),
    {
      origin,
      ...(credentialHeader
        ? { headers: { "x-gutfeel-credential": credential } }
        : {}),
    },
  );
  app.sockets.add(socket);
  const inbox = [];
  socket.on("message", (bytes) =>
    inbox.push({ raw: Buffer.from(bytes), message: decodeMessage(bytes) }),
  );
  await once(socket, "open");
  socket.send(encodeMessage(logonMessage(movie, name)));
  const client = {
    name,
    socket,
    inbox,
    send(message) {
      socket.send(encodeMessage(message));
    },
    async next(match, timeout = 1000) {
      const predicate =
        typeof match === "function"
          ? (entry) => match(entry.message, entry.raw)
          : (entry) => !match || entry.message.subject === match;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const index = inbox.findIndex(predicate);
        if (index >= 0) return inbox.splice(index, 1)[0];
        await delay(5);
      }
      throw new Error(`message timeout: ${String(match)}`);
    },
  };
  await client.next("Logon");
  return client;
}

async function rejectedClient(
  app,
  { lobbyId, credential, instance, movie = "DS", name, origin = PUBLIC_ORIGIN, ...query },
) {
  const socket = new WebSocket(
    app.wsBase + socketPath({ lobbyId, credential, instance, ...query }),
    { origin },
  );
  app.sockets.add(socket);
  const closed = once(socket, "close");
  await once(socket, "open");
  if (socket.readyState === WebSocket.OPEN)
    socket.send(encodeMessage(logonMessage(movie, name)));
  const [code, reason] = await closed;
  return { code, reason: reason.toString() };
}

async function rejectedUpgrade(app, origin) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${app.wsBase}/multiuser`, { origin });
    app.sockets.add(socket);
    socket.once("open", () => reject(new Error("unexpected WebSocket upgrade")));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
    socket.once("error", () => {});
  });
}

async function assertNoSubject(client, subject, milliseconds = 60) {
  await delay(milliseconds);
  assert.equal(
    client.inbox.some(({ message }) => message.subject === subject),
    false,
    `${subject} crossed a lobby boundary`,
  );
}

function joinGroup(client, name = "@Group1") {
  client.send({
    subject: "JoinGroup",
    senderId: client.name,
    recipients: ["system.group.join"],
    content: { type: "string", value: name },
  });
}

test("public lobby API enforces Origin, capacity, state and role authority", async (t) => {
  const app = await startPublicServer(t);

  assert.equal(
    (await api(app, "/api/lobbies", {
      method: "POST",
      origin: "https://foreign.example",
      body: {},
    })).status,
    403,
  );
  assert.equal(
    (await api(app, "/api/lobbies", {
      method: "POST",
      origin: null,
      body: {},
    })).status,
    403,
  );
  assert.ok((await rejectedUpgrade(app, "https://foreign.example")) >= 400);
  assert.ok((await rejectedUpgrade(app, undefined)) >= 400);
  const unscoped = await rejectedClient(app, {
    lobbyId: "",
    credential: "",
    instance: "unscoped-client",
    name: "Alice",
  });
  assert.equal(unscoped.code, 1008);
  assert.match(unscoped.reason, /lobby_credential_required/);

  const capacity = await createLobby(app);
  for (let index = 0; index < 4; index++)
    assert.equal(
      (await api(app, `/api/lobbies/${capacity.lobbyId}/join`, {
        method: "POST",
        body: {},
      })).status,
      201,
    );
  const full = await api(app, `/api/lobbies/${capacity.lobbyId}/join`, {
    method: "POST",
    body: {},
  });
  assert.equal(full.status, 409);
  assert.equal(full.value.error, "lobby_full");

  const lobby = await createLobby(app);
  const host = await openClient(app, {
    lobbyId: lobby.lobbyId,
    credential: lobby.facilitatorToken,
    credentialHeader: true,
    instance: "host-main-0001",
    name: "Host",
    mode: "host",
  });
  const alice = await openClient(app, {
    lobbyId: lobby.lobbyId,
    credential: lobby.creatorPlayerToken,
    instance: "alice-session-01",
    name: "Alice",
  });
  joinGroup(alice);
  await alice.next(
    (message) =>
      message.subject === "groupJoin" &&
      property(message.content, "user")?.value === "Alice",
  );

  const playerStart = await api(app, `/api/lobbies/${lobby.lobbyId}/start`, {
    method: "POST",
    token: lobby.creatorPlayerToken,
    body: {},
  });
  assert.equal(playerStart.status, 403);
  assert.equal(playerStart.value.error, "facilitator_required");

  const starting = await api(app, `/api/lobbies/${lobby.lobbyId}/start`, {
    method: "POST",
    token: lobby.facilitatorToken,
    body: {},
  });
  assert.equal(starting.status, 200);
  assert.equal(starting.value.state, "starting");
  assert.equal(
    (await api(app, `/api/lobbies/${lobby.lobbyId}/join`, {
      method: "POST",
      body: {},
    })).status,
    409,
  );

  host.send({
    subject: "StartGame",
    senderId: "Host",
    recipients: ["Alice"],
    content: { type: "void" },
  });
  await alice.next("StartGame");
  assert.equal(
    (await api(app, `/api/lobbies/${lobby.lobbyId}`)).value.state,
    "running",
  );

  assert.equal(
    (await api(app, `/api/lobbies/${lobby.lobbyId}/leave`, {
      method: "POST",
      token: lobby.creatorPlayerToken,
      body: {},
    })).status,
    204,
  );
  assert.equal(
    (await api(app, `/api/lobbies/${lobby.lobbyId}/end`, {
      method: "POST",
      token: lobby.facilitatorToken,
      body: {},
    })).status,
    204,
  );
});

test("two lobbies reuse original names and groups without normal-message crossover", async (t) => {
  const app = await startPublicServer(t);
  const lobbyA = await createLobby(app);
  const lobbyB = await createLobby(app);
  const bobA = await joinLobby(app, lobbyA.lobbyId);
  const bobB = await joinLobby(app, lobbyB.lobbyId);

  const hostA = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.facilitatorToken,
    instance: "host-session-a1",
    name: "Host",
    mode: "host",
  });
  const hostB = await openClient(app, {
    lobbyId: lobbyB.lobbyId,
    credential: lobbyB.facilitatorToken,
    instance: "host-session-b1",
    name: "Host",
    mode: "host",
  });
  const aliceA = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.creatorPlayerToken,
    instance: "alice-session-a",
    name: "Alice",
  });
  const aliceB = await openClient(app, {
    lobbyId: lobbyB.lobbyId,
    credential: lobbyB.creatorPlayerToken,
    instance: "alice-session-b",
    name: "Alice",
  });
  const playerBobA = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: bobA.playerToken,
    instance: "bob-session-a01",
    name: "Bob",
  });
  const playerBobB = await openClient(app, {
    lobbyId: lobbyB.lobbyId,
    credential: bobB.playerToken,
    instance: "bob-session-b01",
    name: "Bob",
  });

  for (const client of [aliceA, aliceB, playerBobA, playerBobB])
    joinGroup(client);
  await Promise.all([
    aliceA.next((message) => message.subject === "groupJoin" && property(message.content, "user")?.value === "Bob"),
    aliceB.next((message) => message.subject === "groupJoin" && property(message.content, "user")?.value === "Bob"),
  ]);

  aliceA.send({
    subject: "direct-A",
    senderId: "Alice",
    recipients: ["Bob"],
    content: { type: "string", value: "only A" },
  });
  const direct = (await playerBobA.next("direct-A")).message;
  assert.equal(direct.senderId, "Alice");
  assert.equal(direct.content.value, "only A");
  await assertNoSubject(playerBobB, "direct-A");

  aliceA.send({
    subject: "group-A",
    senderId: "Alice",
    recipients: ["@Group1"],
    content: { type: "string", value: "group A" },
  });
  assert.equal((await playerBobA.next("group-A")).message.content.value, "group A");
  await assertNoSubject(playerBobB, "group-A");

  const duplicate = await rejectedClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.creatorPlayerToken,
    instance: "alice-session-a",
    name: "ALICE",
  });
  assert.equal(duplicate.code, 1008);

  await closeSocket(aliceA.socket);
  await playerBobA.next(
    (message) =>
      message.subject === "groupLeave" &&
      property(message.content, "user")?.value === "Alice",
  );
  const afterClose = await api(app, `/api/lobbies/${lobbyA.lobbyId}`);
  assert.equal(
    afterClose.value.players.find((player) => player.displayName === "Alice")?.connected,
    false,
  );
  const reconnected = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.creatorPlayerToken,
    instance: "alice-session-a",
    name: "Alice",
  });
  reconnected.send({
    subject: "Group.GetUsers",
    senderId: "Alice",
    recipients: ["system.group.getUsers"],
    content: { type: "string", value: "@Group1" },
  });
  assert.deepEqual(
    (await reconnected.next("Group.GetUsers")).message.content.pairs
      .find(([key]) => key.value === "groupMembers")[1].value
      .map((member) => member.value),
    ["Bob"],
  );
  assert.equal(hostA.socket.readyState, WebSocket.OPEN);
  assert.equal(hostB.socket.readyState, WebSocket.OPEN);
  assert.equal(aliceB.socket.readyState, WebSocket.OPEN);
});

test("peer hosts are lobby-scoped and reject role or sender escalation", async (t) => {
  const app = await startPublicServer(t);
  const lobbyA = await createLobby(app);
  const lobbyB = await createLobby(app);
  const bobA = await joinLobby(app, lobbyA.lobbyId);
  const bobB = await joinLobby(app, lobbyB.lobbyId);

  const peerHostA = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.creatorPlayerToken,
    instance: "alice-device-a1",
    movie: "peer-relay",
    name: "Alice",
    role: "peer-host",
    host: "localhost",
    userId: "Alice",
    port: 1777,
    maxConnections: 5,
  });
  const peerHostB = await openClient(app, {
    lobbyId: lobbyB.lobbyId,
    credential: lobbyB.creatorPlayerToken,
    instance: "alice-device-b1",
    movie: "peer-relay",
    name: "Alice",
    role: "peer-host",
    host: "localhost",
    userId: "Alice",
    port: 1777,
    maxConnections: 5,
  });
  const peerBobA = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: bobA.playerToken,
    instance: "bob-device-a001",
    movie: "",
    name: "Bob",
    role: "connect",
    host: "peer-host",
    hostUser: "Alice",
    userId: "Bob",
    port: 1777,
  });
  const peerBobB = await openClient(app, {
    lobbyId: lobbyB.lobbyId,
    credential: bobB.playerToken,
    instance: "bob-device-b001",
    movie: "",
    name: "Bob",
    role: "connect",
    host: "peer-host",
    hostUser: "Alice",
    userId: "Bob",
    port: 1777,
  });
  await Promise.all([
    peerHostA.next("WaitForNetConnection"),
    peerHostB.next("WaitForNetConnection"),
  ]);

  peerHostA.send({
    subject: "peer-A",
    senderId: "Alice",
    recipients: ["@allusers"],
    content: { type: "string", value: "only peer A" },
  });
  assert.equal((await peerBobA.next("peer-A")).message.content.value, "only peer A");
  await assertNoSubject(peerBobB, "peer-A");

  const facilitatorEscalation = await rejectedClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.facilitatorToken,
    instance: "host-peer-fail1",
    movie: "peer-relay",
    name: "Host",
    role: "peer-host",
    userId: "Host",
    port: 1777,
  });
  assert.equal(facilitatorEscalation.code, 1008);

  const crossLobby = await rejectedClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: bobB.playerToken,
    instance: "cross-lobby-001",
    movie: "",
    name: "Bob",
    role: "connect",
    hostUser: "Alice",
    userId: "Bob",
    port: 1777,
  });
  assert.equal(crossLobby.code, 1008);

  const spoofClosed = once(peerBobA.socket, "close");
  peerBobA.send({
    subject: "spoof",
    senderId: "Alice",
    recipients: ["Alice"],
    content: { type: "string", value: "forged" },
  });
  const [code] = await spoofClosed;
  assert.equal(code, 1008);
  await assertNoSubject(peerHostA, "spoof");
  assert.equal(peerHostA.socket.readyState, WebSocket.OPEN);
  assert.equal(peerHostB.socket.readyState, WebSocket.OPEN);
});

test("Host directory is lobby-scoped and survives only authenticated Host reconnects", async (t) => {
  const app = await startPublicServer(t);
  const lobbyA = await createLobby(app);
  const lobbyB = await createLobby(app);

  assert.equal(
    (await api(app, "/legacy/MUI/ipconfig.php?mymoviename=DS&myhostname=forged")).status,
    401,
  );
  const playerAsHost = await rejectedClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.creatorPlayerToken,
    instance: "player-host-fail",
    name: "Host",
    mode: "host",
  });
  assert.equal(playerAsHost.code, 1008);

  const hostA = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.facilitatorToken,
    instance: "host-directory-a",
    name: "Host",
    mode: "host",
  });
  const hostB = await openClient(app, {
    lobbyId: lobbyB.lobbyId,
    credential: lobbyB.facilitatorToken,
    instance: "host-directory-b",
    name: "Host",
    mode: "host",
  });

  const listingPath = (lobby, credential, instance) =>
    `/legacy/MUI/ipcheck.php?mymoviename=DS&lobby=${encodeURIComponent(lobby)}&credential=${encodeURIComponent(credential)}&instance=${encodeURIComponent(instance)}`;
  const listingA = await api(
    app,
    listingPath(lobbyA.lobbyId, lobbyA.creatorPlayerToken, "alice-list-a1"),
  );
  assert.equal(listingA.status, 200);
  assert.deepEqual(listingA.value, [["Host", "DS", "localhost"]]);
  const listingB = await api(
    app,
    listingPath(lobbyB.lobbyId, lobbyB.creatorPlayerToken, "alice-list-b1"),
  );
  assert.deepEqual(listingB.value, [["Host", "DS", "localhost"]]);

  const crossLobby = await api(
    app,
    listingPath(lobbyA.lobbyId, lobbyB.creatorPlayerToken, "cross-list-001"),
  );
  assert.equal(crossLobby.status, 401);
  const mutation = await api(
    app,
    `/legacy/MUI/ipdelete.php?mymoviename=DS&lobby=${lobbyA.lobbyId}&credential=${lobbyA.facilitatorToken}&instance=host-directory-a`,
  );
  assert.equal(mutation.status, 405);

  await closeSocket(hostA.socket);
  await delay(20);
  assert.deepEqual(
    (await api(
      app,
      listingPath(lobbyA.lobbyId, lobbyA.creatorPlayerToken, "alice-list-a2"),
    )).value,
    [],
  );
  assert.deepEqual(
    (await api(
      app,
      listingPath(lobbyB.lobbyId, lobbyB.creatorPlayerToken, "alice-list-b2"),
    )).value,
    [["Host", "DS", "localhost"]],
  );

  const replacement = await openClient(app, {
    lobbyId: lobbyA.lobbyId,
    credential: lobbyA.facilitatorToken,
    instance: "host-directory-a",
    name: "Host",
    mode: "host",
  });
  assert.deepEqual(
    (await api(
      app,
      listingPath(lobbyA.lobbyId, lobbyA.creatorPlayerToken, "alice-list-a3"),
    )).value,
    [["Host", "DS", "localhost"]],
  );
  assert.equal(replacement.socket.readyState, WebSocket.OPEN);
  assert.equal(hostB.socket.readyState, WebSocket.OPEN);
});

test("facilitator name rejection leaves the token and server healthy", async (t) => {
  const app = await startPublicServer(t);
  const lobby = await createLobby(app);
  const instance = "facilitator-name-check";

  const rejected = await rejectedClient(app, {
    lobbyId: lobby.lobbyId,
    credential: lobby.facilitatorToken,
    instance,
    name: "RenamedHost",
    mode: "host",
  });
  assert.equal(rejected.code, 1008);
  assert.match(rejected.reason, /identity not allowed/);

  const health = await fetch(`${app.httpBase}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const host = await openClient(app, {
    lobbyId: lobby.lobbyId,
    credential: lobby.facilitatorToken,
    instance,
    name: "Host",
    mode: "host",
  });
  const listing = await api(
    app,
    `/legacy/MUI/ipcheck.php?mymoviename=DS&lobby=${encodeURIComponent(lobby.lobbyId)}&credential=${encodeURIComponent(lobby.creatorPlayerToken)}&instance=facilitator-listing`,
  );
  assert.equal(listing.status, 200);
  assert.deepEqual(listing.value, [["Host", "DS", "localhost"]]);
  assert.equal(host.socket.readyState, WebSocket.OPEN);
});

test("facilitator removes only non-creator members while the lobby is waiting", async (t) => {
  const app = await startPublicServer(t);
  const lobby = await createLobby(app);
  const joined = await joinLobby(app, lobby.lobbyId);

  assert.equal(lobby.memberId, lobby.snapshot.creatorMemberId);
  assert.equal(
    lobby.snapshot.players.find((player) => player.id === lobby.memberId)?.creator,
    true,
  );
  assert.ok(joined.memberId);
  assert.equal(
    joined.snapshot.players.find((player) => player.id === joined.memberId)?.creator,
    false,
  );

  const bob = await openClient(app, {
    lobbyId: lobby.lobbyId,
    credential: joined.playerToken,
    instance: "remove-bob-session",
    name: "Bob",
  });
  const wrongRole = await api(app, `/api/lobbies/${lobby.lobbyId}/remove`, {
    method: "POST",
    token: lobby.creatorPlayerToken,
    body: { memberId: joined.memberId },
  });
  assert.equal(wrongRole.status, 403);

  const removedSocket = once(bob.socket, "close");
  const removed = await api(app, `/api/lobbies/${lobby.lobbyId}/remove`, {
    method: "POST",
    token: lobby.facilitatorToken,
    body: { memberId: joined.memberId },
  });
  assert.equal(removed.status, 204);
  assert.equal((await removedSocket)[0], 1008);

  const removedGet = await api(app, `/api/lobbies/${lobby.lobbyId}`, {
    token: joined.playerToken,
  });
  assert.equal(removedGet.status, 401);
  const removedWebSocket = await rejectedClient(app, {
    lobbyId: lobby.lobbyId,
    credential: joined.playerToken,
    instance: "removed-bob-retry",
    name: "Bob",
  });
  assert.equal(removedWebSocket.code, 1008);

  const creatorRemoval = await api(app, `/api/lobbies/${lobby.lobbyId}/remove`, {
    method: "POST",
    token: lobby.facilitatorToken,
    body: { memberId: lobby.memberId },
  });
  assert.equal(creatorRemoval.status, 409);
  assert.equal(creatorRemoval.value.error, "creator_cannot_be_removed");
  const snapshot = await api(app, `/api/lobbies/${lobby.lobbyId}`);
  assert.equal(snapshot.value.playerCount, 1);
  assert.equal(snapshot.value.creatorMemberId, lobby.memberId);
});

test("waiting facilitator disconnect permits the same Host to reconnect", async (t) => {
  const app = await startPublicServer(t);
  const lobby = await createLobby(app);
  const host = await openClient(app, {
    lobbyId: lobby.lobbyId,
    credential: lobby.facilitatorToken,
    instance: "waiting-host-session",
    name: "Host",
    mode: "host",
  });
  const alice = await openClient(app, {
    lobbyId: lobby.lobbyId,
    credential: lobby.creatorPlayerToken,
    instance: "waiting-alice-session",
    name: "Alice",
  });

  await closeSocket(host.socket);
  await delay(10);
  const waiting = await api(app, `/api/lobbies/${lobby.lobbyId}`);
  assert.equal(waiting.status, 200);
  assert.equal(waiting.value.state, "waiting");
  assert.equal(waiting.value.facilitatorConnected, false);
  assert.equal(alice.socket.readyState, WebSocket.OPEN);

  const replacement = await openClient(app, {
    lobbyId: lobby.lobbyId,
    credential: lobby.facilitatorToken,
    instance: "waiting-host-session",
    name: "Host",
    mode: "host",
  });
  assert.equal(replacement.socket.readyState, WebSocket.OPEN);
  assert.equal(
    (await api(app, `/api/lobbies/${lobby.lobbyId}`)).value.facilitatorConnected,
    true,
  );
});

test("facilitator loss ends starting and running lobbies without host election", async (t) => {
  const app = await startPublicServer(t);

  async function readyLobby(suffix) {
    const lobby = await createLobby(app);
    const host = await openClient(app, {
      lobbyId: lobby.lobbyId,
      credential: lobby.facilitatorToken,
      instance: `loss-host-${suffix}`,
      name: "Host",
      mode: "host",
    });
    const player = await openClient(app, {
      lobbyId: lobby.lobbyId,
      credential: lobby.creatorPlayerToken,
      instance: `loss-alice-${suffix}`,
      name: "Alice",
    });
    joinGroup(player);
    await player.next(
      (message) =>
        message.subject === "groupJoin" &&
        property(message.content, "user")?.value === "Alice",
    );
    const start = await api(app, `/api/lobbies/${lobby.lobbyId}/start`, {
      method: "POST",
      token: lobby.facilitatorToken,
      body: {},
    });
    assert.equal(start.status, 200);
    assert.equal(start.value.state, "starting");
    return { lobby, host, player };
  }

  const starting = await readyLobby("starting");
  const removeStarting = await api(
    app,
    `/api/lobbies/${starting.lobby.lobbyId}/remove`,
    {
      method: "POST",
      token: starting.lobby.facilitatorToken,
      body: { memberId: starting.lobby.memberId },
    },
  );
  assert.equal(removeStarting.status, 409);
  assert.equal(removeStarting.value.error, "invalid_lobby_state");
  const startingPlayerClosed = once(starting.player.socket, "close");
  await closeSocket(starting.host.socket);
  assert.equal((await startingPlayerClosed)[0], 1001);
  assert.equal(
    (await api(app, `/api/lobbies/${starting.lobby.lobbyId}`)).status,
    404,
  );

  const running = await readyLobby("running");
  running.host.send({
    subject: "StartGame",
    senderId: "Host",
    recipients: ["Alice"],
    content: { type: "void" },
  });
  await running.player.next("StartGame");
  assert.equal(
    (await api(app, `/api/lobbies/${running.lobby.lobbyId}`)).value.state,
    "running",
  );
  const removeRunning = await api(
    app,
    `/api/lobbies/${running.lobby.lobbyId}/remove`,
    {
      method: "POST",
      token: running.lobby.facilitatorToken,
      body: { memberId: running.lobby.memberId },
    },
  );
  assert.equal(removeRunning.status, 409);
  assert.equal(removeRunning.value.error, "invalid_lobby_state");
  const runningPlayerClosed = once(running.player.socket, "close");
  await closeSocket(running.host.socket);
  assert.equal((await runningPlayerClosed)[0], 1001);
  assert.equal(
    (await api(app, `/api/lobbies/${running.lobby.lobbyId}`)).status,
    404,
  );
});
