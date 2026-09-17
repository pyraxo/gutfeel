import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import {
  attachMultiuser,
  decodeMessage,
  encodeMessage,
} from "../server/multiuser.mjs";
import { createGutFeelServer } from "../server.mjs";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function property(content, name) {
  return content?.pairs?.find(([key]) => key.value === name)?.[1];
}

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

async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, "close");
  socket.close();
  await Promise.race([closed, delay(100)]);
  if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
}

async function createRelay(t, options = {}) {
  const server = http.createServer();
  const webSocketServer = attachMultiuser(server, options);
  const sockets = new Set();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await Promise.all([...sockets].map(closeSocket));
    await new Promise((resolve) => webSocketServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    sockets,
  };
}

async function openClient(
  relay,
  { path = "", movie = "DS", name, password = "pass" },
) {
  const socket = new WebSocket(relay.url + path);
  relay.sockets.add(socket);
  const inbox = [];
  socket.on("message", (bytes) =>
    inbox.push({ raw: Buffer.from(bytes), message: decodeMessage(bytes) }),
  );
  await once(socket, "open");
  socket.send(encodeMessage(logonMessage(movie, name, password)));

  const client = {
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

async function rejectedClient(relay, { path = "", movie = "DS", name }) {
  const socket = new WebSocket(relay.url + path);
  relay.sockets.add(socket);
  await once(socket, "open");
  socket.send(encodeMessage(logonMessage(movie, name)));
  const [code, reason] = await once(socket, "close");
  return { code, reason: reason.toString() };
}

test("round trips the Rust wire layout and nested arbitrary Lingo values", () => {
  const message = {
    errorCode: -3,
    timeStamp: 42,
    subject: "Data",
    senderId: "alice",
    recipients: ["bob", "@room"],
    content: {
      type: "propList",
      pairs: [
        [
          { type: "symbol", value: "items" },
          {
            type: "list",
            value: [
              { type: "int", value: 7 },
              { type: "media", value: Buffer.from([1, 2, 3]) },
            ],
          },
        ],
      ],
    },
  };
  assert.deepEqual(decodeMessage(encodeMessage(message)), message);
});

test("matches the protocol frame header and rejects malformed lengths", () => {
  const frame = encodeMessage({
    subject: "x",
    senderId: "y",
    recipients: [],
    content: { type: "void" },
  });
  assert.equal(frame.readUInt16BE(0), 0x7200);
  assert.equal(frame.readUInt32BE(2), frame.length - 6);
  frame.writeUInt32BE(99, 2);
  assert.throws(() => decodeMessage(frame), /payload length/);
});

test("preserves every fixed-width Lingo value inside nested lists", () => {
  const color = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const date = Buffer.from("0011223344556677", "hex");
  const picture = Buffer.from([0, 255, 3, 4, 5]);
  const values = [
    { type: "float", value: Math.PI },
    {
      type: "point",
      x: { type: "int", value: -12 },
      y: { type: "float", value: 34.5 },
    },
    {
      type: "rect",
      left: { type: "int", value: 2 },
      top: { type: "float", value: 1.5 },
      right: { type: "int", value: 400 },
      bottom: { type: "int", value: 300 },
    },
    { type: "color", value: color },
    { type: "date", value: date },
    { type: "picture", value: picture },
    { type: "vector3", x: 1.25, y: -2.5, z: 3.75 },
    {
      type: "transform3",
      values: Array.from({ length: 16 }, (_, index) => index + 0.5),
    },
    {
      type: "list",
      value: [
        { type: "float", value: -0.125 },
        { type: "int", value: 9 },
      ],
    },
  ];
  const message = {
    subject: "values",
    senderId: "alice",
    recipients: ["bob"],
    content: { type: "list", value: values },
  };
  assert.deepEqual(decodeMessage(encodeMessage(message)), {
    errorCode: 0,
    timeStamp: 0,
    subject: "values",
    senderId: "alice",
    recipients: ["bob"],
    content: { type: "list", value: values },
  });
  assert.equal(
    encodeMessage({ subject: "f", content: { type: "float", value: 1.5 } })
      .subarray(-10)
      .toString("hex"),
    "00063ff8000000000000",
  );
  assert.equal(
    encodeMessage({
      subject: "p",
      content: { type: "picture", value: picture },
    })
      .subarray(-12)
      .toString("hex"),
    "00050000000500ff03040500",
  );
  assert.throws(
    () =>
      encodeMessage({
        subject: "bad",
        content: { type: "date", value: Buffer.alloc(7) },
      }),
    /date requires 8 bytes/,
  );
});

test("runs encrypted logon, movie isolation, groups, routing, notifications and cleanup", async (t) => {
  const rustHex =
    "7200000000500000000000000000000000054c6f676f6e000000000475736572000000010000000653797374656d8cb061ca1153a057f86cd8cb0c418e4006930d6c4a1c2f5ac6a34145b6a841160a69f3068c5d821e";
  assert.equal(
    encodeMessage(logonMessage("movieId", "user")).toString("hex"),
    rustHex,
  );

  let clock = 1000;
  const closedIdentities = [];
  const relay = await createRelay(t, {
    now: () => ++clock,
    onClientClose: (client) => closedIdentities.push([client.movie, client.name]),
  });
  const mainPath = (name, movie) =>
    `?host=localhost&port=1626&kind=connect&userId=${name}&movieId=${movie}`;
  const alice = await openClient(relay, {
    path: mainPath("alice", "DS"),
    name: "alice",
  });
  const bob = await openClient(relay, {
    path: mainPath("bob", "DS"),
    name: "bob",
  });
  const otherMovie = await openClient(relay, {
    path: mainPath("alice", "teamDS"),
    movie: "teamDS",
    name: "alice",
  });

  alice.send({
    subject: "join",
    senderId: "alice",
    recipients: ["system.group.join"],
    content: { type: "string", value: "@Room" },
  });
  bob.send({
    subject: "join",
    senderId: "bob",
    recipients: ["system.group.join"],
    content: { type: "string", value: "@room" },
  });
  const joined = (
    await bob.next(
      (message) =>
        message.subject === "groupJoin" &&
        property(message.content, "user")?.value === "bob",
    )
  ).message;
  assert.equal(property(joined.content, "groupName").value, "@Room");
  assert.ok(joined.timeStamp > 0);

  alice.send({
    subject: "GroupUpdate",
    senderId: "alice",
    recipients: ["system.group.getUsers"],
    content: { type: "string", value: "@ROOM" },
  });
  const groupUpdate = (await alice.next("GroupUpdate")).message;
  assert.equal(property(groupUpdate.content, "groupName").value, "@Room");
  assert.deepEqual(
    property(groupUpdate.content, "groupMembers").value.map(
      (item) => item.value,
    ),
    ["alice", "bob"],
  );

  const nestedContent = {
    type: "list",
    value: [
      { type: "float", value: 1.5 },
      {
        type: "point",
        x: { type: "int", value: 4 },
        y: { type: "int", value: -2 },
      },
    ],
  };
  alice.send({
    subject: "chat",
    senderId: "spoofed",
    recipients: ["bob"],
    content: nestedContent,
  });
  const chat = (await bob.next("chat")).message;
  assert.equal(chat.senderId, "alice");
  assert.deepEqual(chat.content, nestedContent);
  assert.ok(chat.timeStamp > joined.timeStamp);

  alice.send({
    subject: "groupChat",
    senderId: "alice",
    recipients: ["@room"],
    content: { type: "string", value: "hello" },
  });
  assert.equal((await bob.next("groupChat")).message.content.value, "hello");

  await closeSocket(bob.socket);
  await delay(10);
  assert.deepEqual(closedIdentities, [["DS", "bob"]]);
  const leave = (
    await alice.next(
      (message) =>
        message.subject === "groupLeave" &&
        property(message.content, "user")?.value === "bob",
    )
  ).message;
  assert.equal(property(leave.content, "groupName").value, "@Room");
  assert.equal(
    property((await alice.next("userLogoff")).message.content, "user").value,
    "bob",
  );

  alice.send({
    subject: "GroupUpdate",
    senderId: "alice",
    recipients: ["SYSTEM.GROUP.GETUSERS"],
    content: { type: "string", value: "room" },
  });
  assert.deepEqual(
    property(
      (await alice.next("GroupUpdate")).message.content,
      "groupMembers",
    ).value.map((item) => item.value),
    ["alice"],
  );

  // A closed identity can reconnect, but native MUS does not restore group
  // membership implicitly. The original client re-runs its normal join flow.
  const bobReconnected = await openClient(relay, {
    path: mainPath("bob", "DS"),
    name: "bob",
  });
  bobReconnected.send({
    subject: "GroupUpdate",
    senderId: "bob",
    recipients: ["system.group.getUsers"],
    content: { type: "string", value: "@room" },
  });
  assert.deepEqual(
    property(
      (await bobReconnected.next("GroupUpdate")).message.content,
      "groupMembers",
    ).value.map((item) => item.value),
    ["alice"],
  );

  const duplicate = await rejectedClient(relay, { name: "alice" });
  assert.equal(duplicate.code, 1008);
  assert.match(duplicate.reason, /duplicate user/);

  otherMovie.send({
    subject: "users",
    senderId: "alice",
    recipients: ["system.movie.getusers"],
    content: { type: "void" },
  });
  assert.deepEqual(
    (await otherMovie.next("users")).message.content.value.map(
      (item) => item.value,
    ),
    ["alice"],
  );

  alice.send({
    subject: "leave",
    senderId: "alice",
    recipients: ["system.group.leave"],
    content: { type: "string", value: "@room" },
  });
  await alice.next(
    (message) =>
      message.subject === "groupLeave" &&
      property(message.content, "user")?.value === "alice",
  );
  alice.send({
    subject: "groups",
    senderId: "alice",
    recipients: ["system.movie.getgroups"],
    content: { type: "void" },
  });
  assert.deepEqual((await alice.next("groups")).message.content.value, []);
});

test("matches user identities case-insensitively without crossing movie boundaries", async (t) => {
  const relay = await createRelay(t);
  const missingMovie = await rejectedClient(relay, {
    movie: "",
    name: "orphan",
  });
  assert.equal(missingMovie.code, 1008);
  assert.match(missingMovie.reason, /invalid identity/);

  const host = await openClient(relay, { movie: "DS", name: "Host" });
  const player = await openClient(relay, { movie: "DS", name: "player" });
  const otherMovieHost = await openClient(relay, {
    movie: "teamDS",
    name: "host",
  });

  player.send({
    subject: "UpdateTeamScore",
    senderId: "player",
    recipients: ["host"],
    content: { type: "string", value: "report data" },
  });
  const delivered = (await host.next("UpdateTeamScore")).message;
  assert.equal(delivered.senderId, "player");
  assert.equal(delivered.content.value, "report data");
  await delay(30);
  assert.equal(
    otherMovieHost.inbox.some(
      ({ message }) => message.subject === "UpdateTeamScore",
    ),
    false,
  );

  const duplicate = await rejectedClient(relay, { movie: "DS", name: "HOST" });
  assert.equal(duplicate.code, 1008);
  assert.match(duplicate.reason, /duplicate user/);

  player.send({
    subject: "mAddScenario",
    senderId: "player",
    recipients: ["hOsT"],
    content: { type: "symbol", value: "normal" },
  });
  assert.equal(
    (await host.next("mAddScenario")).message.content.value,
    "normal",
  );
  assert.equal(host.socket.readyState, WebSocket.OPEN);
});

test("relays peer-host endpoints with direct scoping, duplicate rejection and lifecycle cleanup", async (t) => {
  let clock = 5000;
  const relay = await createRelay(t, { now: () => ++clock });
  const hostPath =
    "?role=peer-host&host=localhost&userId=Host&port=1777&maxConnections=2";
  const host = await openClient(relay, {
    path: hostPath,
    movie: "peer-relay",
    name: "Host",
  });
  const alice = await openClient(relay, {
    path: "?role=connect&host=peer-host&hostUser=hOsT&userId=alice&port=1777",
    movie: "",
    name: "alice",
  });
  const bob = await openClient(relay, {
    path: "?role=connect&host=peer-host&hostUser=HOST&userId=bob&port=1777",
    movie: "peer-relay",
    name: "bob",
  });
  const authorization = (
    await host.next(
      (message) =>
        message.subject === "WaitForNetConnection" &&
        property(message.content, "userID")?.value === "alice",
    )
  ).message;
  assert.equal(property(authorization.content, "movieID").value, "");
  assert.ok(authorization.timeStamp > 0);

  const direct = encodeMessage({
    subject: "opaque",
    senderId: "Host",
    recipients: ["ALICE"],
    content: { type: "media", value: Buffer.from([0, 255, 9]) },
  });
  host.socket.send(direct);
  assert.ok(
    (
      await alice.next(
        (message, raw) => message.subject === "opaque" && raw.equals(direct),
      )
    ).raw.equals(direct),
  );
  await delay(30);
  assert.equal(
    bob.inbox.some(({ message }) => message.subject === "opaque"),
    false,
  );

  const broadcast = encodeMessage({
    subject: "all",
    senderId: "Host",
    recipients: ["@allUsers"],
    content: { type: "string", value: "hello" },
  });
  host.socket.send(broadcast);
  assert.ok(
    (
      await alice.next(
        (message, raw) => message.subject === "all" && raw.equals(broadcast),
      )
    ).raw.equals(broadcast),
  );
  assert.ok(
    (
      await bob.next(
        (message, raw) => message.subject === "all" && raw.equals(broadcast),
      )
    ).raw.equals(broadcast),
  );

  // Gut Feel wraps ppHost.muPost("@allusers", ...) this way. The depot's
  // mCreateAmmo content contains a point, and every connected ppC must receive
  // the exact native frame so its goMU callback can unwrap and dispatch it.
  const depotBroadcast = encodeMessage({
    subject: "pph@all",
    senderId: "bob",
    recipients: ["@allusers"],
    content: {
      type: "list",
      value: [
        { type: "string", value: "bob" },
        { type: "string", value: "mCreateAmmo" },
        {
          type: "list",
          value: [
            { type: "string", value: "P" },
            {
              type: "point",
              x: { type: "int", value: 588 },
              y: { type: "int", value: 215 },
            },
            { type: "int", value: 1 },
            { type: "string", value: "bob" },
            { type: "int", value: 1 },
          ],
        },
      ],
    },
  });
  host.socket.send(depotBroadcast);
  for (const peer of [alice, bob]) {
    const received = await peer.next(
      (message, raw) =>
        message.subject === "pph@all" && raw.equals(depotBroadcast),
    );
    assert.ok(received.raw.equals(depotBroadcast));
    assert.deepEqual(received.message.content.value[2].value[1], {
      type: "point",
      x: { type: "int", value: 588 },
      y: { type: "int", value: 215 },
    });
  }

  const reverse = encodeMessage({
    subject: "reverse",
    senderId: "alice",
    recipients: ["HOST"],
    content: { type: "string", value: "ok" },
  });
  alice.socket.send(reverse);
  assert.ok(
    (
      await host.next(
        (message, raw) => message.subject === "reverse" && raw.equals(reverse),
      )
    ).raw.equals(reverse),
  );

  const duplicatePeer = await rejectedClient(relay, {
    path: "?role=connect&host=peer-host&hostUser=host&userId=ALICE&port=1777",
    movie: "peer-relay",
    name: "ALICE",
  });
  assert.equal(duplicatePeer.code, 1008);

  const fullPeerHost = await rejectedClient(relay, {
    path: "?role=connect&host=peer-host&hostUser=host&userId=carol&port=1777",
    movie: "peer-relay",
    name: "carol",
  });
  assert.equal(fullPeerHost.code, 1008);
  assert.match(fullPeerHost.reason, /peer unavailable/);

  const duplicateHost = await rejectedClient(relay, {
    path: "?role=peer-host&host=localhost&userId=hOsT&port=1777&maxConnections=2",
    movie: "peer-relay",
    name: "hOsT",
  });
  assert.equal(duplicateHost.code, 1008);
  assert.match(duplicateHost.reason, /duplicate peer host/);

  await closeSocket(alice.socket);
  const disconnected = (
    await host.next(
      (message) =>
        message.subject === "ConnectionProblem" &&
        message.content.value === "alice",
    )
  ).message;
  assert.equal(disconnected.errorCode, -1);
  assert.ok(disconnected.timeStamp > authorization.timeStamp);

  const hostLogoff = (await host.next("system.userLogOff")).message;
  assert.equal(property(hostLogoff.content, "user").value, "alice");
  assert.equal(property(hostLogoff.content, "movieName").value, "");
  assert.equal(property(hostLogoff.content, "userCount").value, 2);
  const peerLogoff = (await bob.next("system.userLogOff")).message;
  assert.equal(property(peerLogoff.content, "user").value, "alice");
  assert.equal(peerLogoff.errorCode, 0);

  const bobClosed = once(bob.socket, "close");
  await closeSocket(host.socket);
  const hostLost = (await bob.next("system.userLogOff")).message;
  assert.equal(property(hostLost.content, "user").value, "Host");
  assert.equal(property(hostLost.content, "userCount").value, 1);
  await bobClosed;

  const replacement = await openClient(relay, {
    path: hostPath,
    movie: "peer-relay",
    name: "Host",
  });
  assert.equal(replacement.socket.readyState, WebSocket.OPEN);
});

test("registers an authenticated Host-mode connection and removes only its directory entry", async (t) => {
  const { server, multiuser } = createGutFeelServer({ legacyOpen: true });
  const sockets = new Set();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await Promise.all([...sockets].map(closeSocket));
    await new Promise((resolve) => multiuser.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;
  const httpBase = `http://127.0.0.1:${port}`;
  await fetch(`${httpBase}/legacy/MUI/ipconfig.php?mymoviename=DS&myhostname=Host`);
  await fetch(`${httpBase}/legacy/MUI/ipconfig.php?mymoviename=DS&myhostname=OtherHost`);

  const relay = { url: `ws://127.0.0.1:${port}/multiuser`, sockets };
  const player = await openClient(relay, { movie: "DS", name: "player" });
  assert.equal(
    await fetch(`${httpBase}/health`).then((response) => response.json()).then((health) => health.hosts),
    2,
  );

  const rejectedHost = await rejectedClient(relay, {
    path: "?mode=host&userId=spoofed",
    movie: "DS",
    name: "differentLogon",
  });
  assert.equal(rejectedHost.code, 1008);
  assert.equal(
    await fetch(`${httpBase}/health`).then((response) => response.json()).then((health) => health.hosts),
    2,
  );

  const host = await openClient(relay, {
    path: "?mode=host&userId=hOsT",
    movie: "DS",
    name: "hOsT",
  });
  assert.equal(
    await fetch(`${httpBase}/health`).then((response) => response.json()).then((health) => health.hosts),
    2,
  );
  const registered = await fetch(
    `${httpBase}/legacy/MUI/ipcheck.php?mymoviename=DS`,
  ).then((response) => response.text());
  assert.equal(registered, '[["OtherHost","DS","localhost"],["hOsT","DS","localhost"]]');

  await closeSocket(host.socket);
  await delay(10);

  const listing = await fetch(
    `${httpBase}/legacy/MUI/ipcheck.php?mymoviename=DS`,
  ).then((response) => response.text());
  assert.equal(listing, '[["OtherHost","DS","localhost"]]');
  await closeSocket(player.socket);
});
