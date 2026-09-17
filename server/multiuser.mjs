/* Shockwave Multiuser Server protocol adapter.
 *
 * The wire format follows the original SMUS value layouts. The browser relay
 * has two independent modes: normal movie/server sessions and raw peer-host
 * tunnels used by goMU's WaitForNetConnection/ConnectToNetServer pair.
 */
import { performance } from "node:perf_hooks";
import { WebSocketServer } from "ws";
import { musCipher } from "./mus-blowfish.mjs";

const FRAME_HEADER = 0x7200;
const OPEN = 1;
const SYSTEM = "System";
const DEFAULT_CIPHER_KEY = "IPAddress resolution";

export const TAG = Object.freeze({
  void: 0,
  int: 1,
  symbol: 2,
  string: 3,
  picture: 5,
  float: 6,
  list: 7,
  point: 8,
  rect: 9,
  propList: 10,
  color: 18,
  date: 19,
  media: 20,
  vector3: 22,
  transform3: 23,
});
const TYPE_BY_TAG = new Map(
  Object.entries(TAG).map(([type, tag]) => [tag, type]),
);

class Reader {
  constructor(bytes) {
    this.buffer = Buffer.from(bytes);
    this.offset = 0;
  }
  remaining() {
    return this.buffer.length - this.offset;
  }
  require(length) {
    if (length < 0 || this.offset + length > this.buffer.length) {
      throw new RangeError("truncated Multiuser frame");
    }
  }
  readUInt8() {
    this.require(1);
    return this.buffer[this.offset++];
  }
  readUInt16() {
    this.require(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }
  readInt32() {
    this.require(4);
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }
  readUInt32() {
    this.require(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }
  readDouble() {
    this.require(8);
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }
  readFloat() {
    this.require(4);
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }
  readBytes(length) {
    this.require(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  readLengthPrefixedBytes() {
    const length = this.readUInt32();
    const value = Buffer.from(this.readBytes(length));
    if (length & 1) this.readUInt8();
    return value;
  }
  readString() {
    return this.readLengthPrefixedBytes().toString("latin1");
  }
  readCount(minimumBytesPerItem, maximum = 4096) {
    const count = this.readUInt32();
    if (count > maximum || count > Math.floor(this.remaining() / minimumBytesPerItem)) {
      throw new RangeError("invalid Multiuser collection length");
    }
    return count;
  }
  readValue(depth = 0) {
    if (depth > 32) throw new RangeError("Multiuser value nesting too deep");
    const tag = this.readUInt16();
    const type = TYPE_BY_TAG.get(tag);
    if (!type) throw new TypeError(`unsupported Lingo tag ${tag}`);
    switch (type) {
      case "void":
        return { type };
      case "int":
        return { type, value: this.readInt32() };
      case "float":
        return { type, value: this.readDouble() };
      case "string":
      case "symbol":
        return { type, value: this.readString() };
      case "picture":
      case "media":
        return { type, value: this.readLengthPrefixedBytes() };
      case "list": {
        const count = this.readCount(2);
        return {
          type,
          value: Array.from({ length: count }, () => this.readValue(depth + 1)),
        };
      }
      case "propList": {
        const count = this.readCount(4);
        return {
          type,
          pairs: Array.from({ length: count }, () => [
            this.readValue(depth + 1),
            this.readValue(depth + 1),
          ]),
        };
      }
      case "point":
        return {
          type,
          x: this.readCoordinate(),
          y: this.readCoordinate(),
        };
      case "rect":
        return {
          type,
          left: this.readCoordinate(),
          top: this.readCoordinate(),
          right: this.readCoordinate(),
          bottom: this.readCoordinate(),
        };
      case "color":
        return { type, value: Buffer.from(this.readBytes(4)) };
      case "date":
        return { type, value: Buffer.from(this.readBytes(8)) };
      case "vector3":
        return {
          type,
          x: this.readFloat(),
          y: this.readFloat(),
          z: this.readFloat(),
        };
      case "transform3":
        return {
          type,
          values: Array.from({ length: 16 }, () => this.readFloat()),
        };
      default:
        throw new TypeError(`unsupported Lingo type ${type}`);
    }
  }
  readCoordinate() {
    const value = this.readValue();
    if (value.type !== "int" && value.type !== "float") {
      throw new TypeError(`MUS coordinate must be int or float, got ${value.type}`);
    }
    return value;
  }
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(Number(value) >>> 0);
  return bytes;
}
function int32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(Number(value));
  return bytes;
}
function double(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(Number(value));
  return bytes;
}
function float(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatBE(Number(value));
  return bytes;
}
function tagged(type, payload = Buffer.alloc(0)) {
  const tag = TAG[type];
  if (tag == null) throw new TypeError(`unsupported Lingo type ${type}`);
  const header = Buffer.alloc(2);
  header.writeUInt16BE(tag);
  return Buffer.concat([header, payload]);
}
function lengthPrefixedBytes(value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([
    uint32(bytes.length),
    bytes,
    bytes.length & 1 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
}
function stringBytes(value) {
  return lengthPrefixedBytes(Buffer.from(String(value), "latin1"));
}
function fixedBytes(value, expectedLength, type) {
  const bytes = Buffer.from(value ?? []);
  if (bytes.length !== expectedLength)
    throw new RangeError(`${type} requires ${expectedLength} bytes`);
  return bytes;
}
function valueBytes(value) {
  if (value == null || value.type === "void") return tagged("void");
  const type = value.type ?? (typeof value === "number" ? "int" : "string");
  switch (type) {
    case "int":
      return tagged(type, int32(value.value ?? value));
    case "float":
      return tagged(type, double(value.value ?? value));
    case "string":
    case "symbol":
      return tagged(type, stringBytes(value.value ?? value));
    case "picture":
    case "media":
      return tagged(type, lengthPrefixedBytes(value.value ?? value.raw ?? []));
    case "list": {
      const items = value.value ?? [];
      return tagged(
        type,
        Buffer.concat([uint32(items.length), ...items.map(valueBytes)]),
      );
    }
    case "propList": {
      const pairs = value.pairs ?? value.value ?? [];
      return tagged(
        type,
        Buffer.concat([
          uint32(pairs.length),
          ...pairs.flatMap(([key, item]) => [
            valueBytes(key),
            valueBytes(item),
          ]),
        ]),
      );
    }
    case "point":
      return tagged(
        type,
        Buffer.concat([coordinateBytes(value.x), coordinateBytes(value.y)]),
      );
    case "rect":
      return tagged(
        type,
        Buffer.concat([
          coordinateBytes(value.left),
          coordinateBytes(value.top),
          coordinateBytes(value.right),
          coordinateBytes(value.bottom),
        ]),
      );
    case "color":
      return tagged(type, fixedBytes(value.value ?? value.raw, 4, type));
    case "date":
      return tagged(type, fixedBytes(value.value ?? value.raw, 8, type));
    case "vector3":
      return tagged(
        type,
        Buffer.concat([float(value.x), float(value.y), float(value.z)]),
      );
    case "transform3": {
      const values = value.values ?? [];
      if (values.length !== 16)
        throw new RangeError("transform3 requires 16 values");
      return tagged(type, Buffer.concat(values.map(float)));
    }
    default:
      throw new TypeError(`unsupported Lingo type ${type}`);
  }
}

function coordinateBytes(value) {
  if (value && typeof value === "object" && (value.type === "int" || value.type === "float")) {
    return valueBytes(value);
  }
  return valueBytes({
    type: Number.isInteger(Number(value)) ? "int" : "float",
    value: Number(value),
  });
}

export function encodeMessage(message) {
  const recipients = message.recipients ?? [];
  let content = valueBytes(message.content);
  if (
    message.subject === "Logon" &&
    recipients.length === 1 &&
    recipients[0] === SYSTEM &&
    message.encrypt !== false
  ) {
    content = musCipher(
      content,
      Buffer.from(message.encryptionKey || DEFAULT_CIPHER_KEY, "latin1"),
    );
  }
  const payload = Buffer.concat([
    int32(message.errorCode ?? message.error_code ?? 0),
    uint32(message.timeStamp ?? message.time_stamp ?? 0),
    stringBytes(message.subject ?? ""),
    stringBytes(message.senderId ?? message.sender_id ?? ""),
    uint32(recipients.length),
    ...recipients.map(stringBytes),
    content,
  ]);
  const header = Buffer.alloc(6);
  header.writeUInt16BE(FRAME_HEADER, 0);
  header.writeUInt32BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

export function decodeMessage(input, options = {}) {
  const bytes = Buffer.from(input);
  const reader = new Reader(bytes);
  if (reader.readUInt16() !== FRAME_HEADER)
    throw new TypeError("invalid Multiuser header");
  const payloadLength = reader.readUInt32();
  if (payloadLength !== bytes.length - 6)
    throw new RangeError("invalid Multiuser payload length");
  const errorCode = reader.readInt32();
  const timeStamp = reader.readUInt32();
  const subject = reader.readString();
  const senderId = reader.readString();
  const recipientCount = reader.readCount(4, 16);
  const recipients = Array.from({ length: recipientCount }, () =>
    reader.readString(),
  );
  let content;
  if (
    subject === "Logon" &&
    recipients.length === 1 &&
    recipients[0] === SYSTEM &&
    options.decrypt !== false
  ) {
    const decrypted = musCipher(
      reader.readBytes(reader.remaining()),
      Buffer.from(options.encryptionKey || DEFAULT_CIPHER_KEY, "latin1"),
    );
    const contentReader = new Reader(decrypted);
    content = contentReader.readValue();
    if (contentReader.remaining() !== 0) {
      throw new RangeError("trailing bytes in Multiuser content");
    }
  } else {
    content = reader.readValue();
    if (reader.remaining() !== 0) {
      throw new RangeError("trailing bytes in Multiuser content");
    }
  }
  return { errorCode, timeStamp, subject, senderId, recipients, content };
}

function stringValue(value) {
  return value?.type === "string" || value?.type === "symbol"
    ? value.value
    : "";
}
function commandArgument(content) {
  return content?.type === "list"
    ? stringValue(content.value[0])
    : stringValue(content);
}
function lingoString(value) {
  return { type: "string", value: String(value) };
}
function lingoSymbol(value) {
  return { type: "symbol", value: String(value) };
}
function lingoList(values) {
  return {
    type: "list",
    value: values.map((value) =>
      typeof value === "string" ? lingoString(value) : value,
    ),
  };
}
function lingoPropList(entries) {
  return {
    type: "propList",
    pairs: Object.entries(entries).map(([key, value]) => [
      lingoSymbol(key),
      typeof value === "string" ? lingoString(value) : value,
    ]),
  };
}
function canonicalGroupName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}
function canonicalUserName(value) {
  return String(value ?? "").toLowerCase();
}
function serverClock() {
  return Math.trunc(performance.now()) >>> 0;
}

export class MultiuserRelay {
  constructor(options = {}) {
    this.options = options;
    this.clients = new Map();
    this.groups = new Map();
    this.peerHosts = new Map();
    this.now = options.now ?? serverClock;
  }
  timestamp() {
    return Number(this.now()) >>> 0;
  }
  clientKey(movie, name) {
    return `${movie}\0${canonicalUserName(name)}`;
  }
  groupKey(movie, name) {
    return `${movie}\0${canonicalGroupName(name)}`;
  }
  peerKey(name, port) {
    return `${canonicalUserName(name)}\0${port}`;
  }
  sendMessage(ws, message) {
    if (ws.readyState === OPEN)
      this.sendRaw(ws, encodeMessage({ timeStamp: this.timestamp(), ...message }));
  }
  sendRaw(ws, bytes) {
    if (ws.readyState !== OPEN) return false;
    if (ws.bufferedAmount > (this.options.maxSendQueueBytes ?? 2 * 1024 * 1024)) {
      this.closeSocket(ws, 1013, "slow consumer");
      return false;
    }
    try {
      ws.send(bytes);
      return true;
    } catch {
      this.closeSocket(ws, 1011, "relay send failed");
      return false;
    }
  }
  closeSocket(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
  systemMessage(subject, recipients, content, errorCode = 0) {
    return {
      subject,
      recipients,
      content,
      errorCode,
      senderId: SYSTEM,
      timeStamp: this.timestamp(),
    };
  }
  movieClients(movie) {
    return [...this.clients.values()].filter(
      (client) => client.movie === movie,
    );
  }
  deliverMovieMessage(sender, message) {
    const targets = new Set();
    for (const recipient of message.recipients ?? []) {
      const normalized = recipient.toLowerCase();
      if (recipient === "*" || normalized === "@allusers") {
        for (const client of this.movieClients(sender.movie))
          targets.add(client);
      } else if (recipient.startsWith("@")) {
        for (const client of this.groups.get(
          this.groupKey(sender.movie, recipient),
        )?.members ?? [])
          targets.add(client);
      } else {
        const client = this.clients.get(
          this.clientKey(sender.movie, recipient),
        );
        if (client) targets.add(client);
      }
    }
    const forwarded = {
      ...message,
      senderId: sender.name,
      timeStamp: this.timestamp(),
    };
    for (const target of targets) this.sendMessage(target.ws, forwarded);
  }
  notifyMovie(movie, subject, content) {
    const message = this.systemMessage(subject, ["*"], content);
    for (const client of this.movieClients(movie))
      this.sendMessage(client.ws, message);
  }
  handleConnection(ws, request, scope = {}) {
    const query = new URL(request.url || "/", "ws://localhost").searchParams;
    const role = query.get("role") || "";
    const requestedMaximum = Number(query.get("maxConnections") || 16);
    const connection = {
      ws,
      role,
      mode: query.get("mode") || "",
      queryUser: query.get("userId") || "",
      hostUser: query.get("hostUser") || "",
      hostAddress: query.get("host") || "",
      port: query.get("port") || "",
      maxConnections:
        Number.isSafeInteger(requestedMaximum) && requestedMaximum > 0
          ? Math.min(requestedMaximum, this.options.maxPeerConnections ?? 16)
          : (this.options.maxPeerConnections ?? 16),
      client: null,
      peerHost: null,
      registeredPeerKey: null,
      grant: scope.grant ?? null,
      instance: scope.instance ?? "",
      rateWindowStartedAt: Date.now(),
      rateFrames: 0,
      rateBytes: 0,
    };
    if (this.options.authorizeConnection && !this.options.authorizeConnection(connection)) {
      this.closeSocket(ws, 1008, "connection role not allowed");
      return;
    }
    if (this.options.onConnectionOpen && !this.options.onConnectionOpen(connection)) {
      this.closeSocket(ws, 1008, "connection limit reached");
      return;
    }
    if (role === "connect")
      connection.peerHost =
        this.peerHosts.get(
          this.peerKey(connection.hostUser, connection.port),
        ) ?? null;
    connection.logonTimer = setTimeout(
      () => !connection.client && this.closeSocket(ws, 1008, "Logon timeout"),
      this.options.logonTimeoutMs ?? 5_000,
    );
    connection.logonTimer.unref?.();
    ws.on("message", (data) => {
      try {
        this.handleFrame(connection, Buffer.from(data));
      } catch {
        this.closeSocket(ws, 1011, "relay policy failure");
      }
    });
    ws.on("close", () => {
      clearTimeout(connection.logonTimer);
      try { this.handleClose(connection); } catch {}
      try { this.options.onConnectionClose?.(connection); } catch {}
    });
  }
  handleFrame(connection, rawFrame) {
    const now = Date.now();
    if (now - connection.rateWindowStartedAt >= 10_000) {
      connection.rateWindowStartedAt = now;
      connection.rateFrames = 0;
      connection.rateBytes = 0;
    }
    connection.rateFrames++;
    connection.rateBytes += rawFrame.length;
    if (connection.rateFrames > 1_200 || connection.rateBytes > 20 * 1024 * 1024) {
      this.closeSocket(connection.ws, 1008, "message rate exceeded");
      return;
    }
    let message;
    try {
      message = decodeMessage(rawFrame);
    } catch {
      this.closeSocket(connection.ws, 1003, "invalid Multiuser frame");
      return;
    }
    if (!connection.client) {
      this.handleLogon(connection, message);
      return;
    }
    const senderName = canonicalUserName(message.senderId);
    const senderAllowed = !connection.role
      ? true
      : connection.role === "peer-host"
      ? senderName === canonicalUserName(connection.client.name) ||
        connection.peerHost?.peers.has(senderName)
      : senderName === canonicalUserName(connection.client.name);
    if (this.options.enforceSenderIdentity && !senderAllowed) {
      this.closeSocket(connection.ws, 1008, "invalid sender identity");
      return;
    }
    if (this.options.authorizeMessage && !this.options.authorizeMessage(connection.client, message, connection)) {
      this.closeSocket(connection.ws, 1008, "message not allowed");
      return;
    }
    if (
      canonicalUserName(message.subject) === "startgame" &&
      connection.grant?.role === "facilitator"
    ) this.options.onFacilitatorStart?.(connection.client, message, connection);
    if (connection.role === "peer-host") {
      this.routeFromPeerHost(connection.peerHost, message, rawFrame);
      return;
    }
    if (connection.role === "connect") {
      if (connection.peerHost?.ws.readyState === OPEN)
        this.sendRaw(connection.peerHost.ws, rawFrame);
      return;
    }
    this.handleServerMessage(connection.client, message);
  }
  handleLogon(connection, message) {
    if (
      message.subject !== "Logon" ||
      message.recipients.length !== 1 ||
      message.recipients[0] !== SYSTEM
    ) {
      this.closeSocket(connection.ws, 1008, "Logon required");
      return;
    }
    const values =
      message.content?.type === "list" ? message.content.value : [];
    const movie = stringValue(values[0]);
    const logonName = stringValue(values[1]) || message.senderId;
    const name = connection.queryUser || logonName;
    const peerHostForLogon =
      connection.role === "connect"
        ? (connection.peerHost ??
          this.peerHosts.get(
            this.peerKey(connection.hostUser, connection.port),
          ))
        : null;
    if (
      (!movie && !peerHostForLogon) ||
      !name ||
      (connection.queryUser &&
        canonicalUserName(connection.queryUser) !==
          canonicalUserName(logonName))
    ) {
      this.closeSocket(connection.ws, 1008, "invalid identity");
      return;
    }
    if (this.options.authorizeIdentity && !this.options.authorizeIdentity(connection, name, movie)) {
      this.closeSocket(connection.ws, 1008, "identity not allowed");
      return;
    }
    if (connection.role === "peer-host") {
      const key = this.peerKey(name, connection.port);
      if (this.peerHosts.has(key)) {
        this.closeSocket(connection.ws, 1008, "duplicate peer host");
        return;
      }
      const peerHost = {
        ws: connection.ws,
        name,
        movie,
        peers: new Map(),
        maxConnections: connection.maxConnections,
        key,
      };
      this.peerHosts.set(key, peerHost);
      connection.peerHost = peerHost;
      connection.registeredPeerKey = key;
      connection.client = {
        ws: connection.ws,
        name,
        movie,
        groups: new Set(),
        peerHost,
        isPeerHost: true,
        grant: connection.grant,
      };
    } else if (connection.role === "connect") {
      const peerHost = peerHostForLogon;
      if (
        !peerHost ||
        peerHost.ws.readyState !== OPEN ||
        peerHost.peers.size >= peerHost.maxConnections ||
        peerHost.peers.has(canonicalUserName(name))
      ) {
        this.closeSocket(connection.ws, 1008, "peer unavailable");
        return;
      }
      const client = {
        ws: connection.ws,
        name,
        movie,
        groups: new Set(),
        peerHost,
        grant: connection.grant,
      };
      peerHost.peers.set(canonicalUserName(name), client);
      connection.client = client;
      this.sendMessage(
        peerHost.ws,
        this.systemMessage(
          "WaitForNetConnection",
          [peerHost.name],
          lingoPropList({
            userID: name,
            Password: stringValue(values[2]),
            movieID: movie,
          }),
        ),
      );
    } else {
      const key = this.clientKey(movie, name);
      if (this.clients.has(key)) {
        this.closeSocket(connection.ws, 1008, "duplicate user");
        return;
      }
      const client = { ws: connection.ws, name, movie, groups: new Set(), grant: connection.grant };
      this.clients.set(key, client);
      connection.client = client;
    }
    clearTimeout(connection.logonTimer);
    if (!connection.role) this.options.onClientLogon?.(connection.client, connection);
    this.options.onAnyClientLogon?.(connection.client, connection);
    this.sendMessage(
      connection.ws,
      this.systemMessage(
        "Logon",
        [name],
        lingoString(this.options.logonMessage ?? "Gut Feel Multiuser Server"),
      ),
    );
    if (!connection.role)
      this.notifyMovie(movie, "userLogon", lingoPropList({ user: name }));
  }
  handleServerMessage(client, message) {
    const command = (message.recipients?.[0] ?? "").toLowerCase();
    if (
      command === "system.group.getusers" ||
      message.subject === "Group.GetUsers" ||
      message.subject === "GetUsers"
    ) {
      this.sendGroupMembers(client, message);
      return;
    }
    if (
      command === "system.movie.getusers" ||
      message.subject === "Movie.GetUsers" ||
      message.subject === "GetUserList"
    ) {
      this.sendMessage(
        client.ws,
        this.systemMessage(
          message.subject,
          [client.name],
          lingoList(
            this.movieClients(client.movie).map((candidate) => candidate.name),
          ),
        ),
      );
      return;
    }
    if (
      command === "system.movie.getgroups" ||
      message.subject === "Movie.GetGroups" ||
      message.subject === "GetGroupList"
    ) {
      const names = [...this.groups.values()]
        .filter((group) => group.movie === client.movie)
        .map((group) => group.name);
      this.sendMessage(
        client.ws,
        this.systemMessage(message.subject, [client.name], lingoList(names)),
      );
      return;
    }
    if (
      command === "system.group.join" ||
      message.subject === "Group.Join" ||
      message.subject === "JoinGroup"
    ) {
      this.joinGroup(client, commandArgument(message.content));
      return;
    }
    if (
      command === "system.group.leave" ||
      message.subject === "Group.Leave" ||
      message.subject === "LeaveGroup"
    ) {
      this.leaveGroup(client, commandArgument(message.content));
      return;
    }
    this.deliverMovieMessage(client, message);
  }
  groupFor(movie, requestedName, create = false) {
    const canonical = canonicalGroupName(requestedName);
    if (!canonical) return null;
    const key = this.groupKey(movie, canonical);
    let group = this.groups.get(key);
    if (!group && create) {
      group = { key, movie, name: String(requestedName), members: new Set() };
      this.groups.set(key, group);
    }
    return group ?? null;
  }
  joinGroup(client, requestedName) {
    const group = this.groupFor(client.movie, requestedName, true);
    if (!group || group.members.has(client)) return;
    group.members.add(client);
    client.groups.add(group.key);
    this.options.onGroupJoin?.(client, group);
    this.notifyMovie(
      client.movie,
      "groupJoin",
      lingoPropList({ user: client.name, groupName: group.name }),
    );
  }
  leaveGroup(client, requestedName, notify = true) {
    const group = this.groupFor(client.movie, requestedName);
    if (!group || !group.members.delete(client)) return;
    client.groups.delete(group.key);
    this.options.onGroupLeave?.(client, group);
    if (notify)
      this.notifyMovie(
        client.movie,
        "groupLeave",
        lingoPropList({ user: client.name, groupName: group.name }),
      );
    if (group.members.size === 0) this.groups.delete(group.key);
  }
  sendGroupMembers(client, message) {
    const requestedName = commandArgument(message.content);
    const group = this.groupFor(client.movie, requestedName);
    const members = [...(group?.members ?? [])].map((member) => member.name);
    this.sendMessage(
      client.ws,
      this.systemMessage(
        message.subject,
        [client.name],
        lingoPropList({
          groupName: group?.name ?? String(requestedName),
          groupMembers: lingoList(members),
        }),
      ),
    );
  }
  routeFromPeerHost(peerHost, message, rawFrame) {
    if (!peerHost) return;
    const targets = new Set();
    for (const recipient of message.recipients ?? []) {
      const normalized = recipient.toLowerCase();
      if (recipient === "*" || normalized === "@allusers")
        for (const peer of peerHost.peers.values()) targets.add(peer);
      else {
        const peer = peerHost.peers.get(canonicalUserName(recipient));
        if (peer) targets.add(peer);
      }
    }
    for (const peer of targets) this.sendRaw(peer.ws, rawFrame);
  }
  notifyPeerUserLogoff(peerHost, departed) {
    if (!peerHost) return;
    const remainingPeers = [...peerHost.peers.values()];
    const content = lingoPropList({
      user: departed.name,
      movieName: departed.movie,
      // Native goMU includes the peer host itself in ppConNames unless
      // ppHostNotUser is enabled. Gut Feel uses the default (host included).
      userCount: { type: "int", value: remainingPeers.length + 1 },
    });
    const message = {
      subject: "system.userLogOff",
      recipients: [peerHost.name, ...remainingPeers.map((peer) => peer.name)],
      content,
      errorCode: 0,
      senderId: peerHost.name,
    };
    if (peerHost.ws.readyState === OPEN) this.sendMessage(peerHost.ws, message);
    for (const peer of remainingPeers)
      if (peer.ws.readyState === OPEN) this.sendMessage(peer.ws, message);
  }
  handleClose(connection) {
    const client = connection.client;
    if (!client) return;
    if (connection.role === "peer-host") {
      if (
        connection.registeredPeerKey &&
        this.peerHosts.get(connection.registeredPeerKey) === connection.peerHost
      )
        this.peerHosts.delete(connection.registeredPeerKey);
      const peerHost = connection.peerHost;
      if (peerHost) {
        const peers = [...peerHost.peers.values()];
        const content = lingoPropList({
          user: peerHost.name,
          movieName: peerHost.movie,
          userCount: { type: "int", value: peers.length },
        });
        const message = {
          subject: "system.userLogOff",
          recipients: peers.map((peer) => peer.name),
          content,
          errorCode: 0,
          senderId: peerHost.name,
        };
        for (const peer of peers)
          if (peer.ws.readyState === OPEN) this.sendMessage(peer.ws, message);
      }
      for (const peer of connection.peerHost?.peers.values() ?? [])
        if (peer.ws.readyState === OPEN)
          this.closeSocket(peer.ws, 1011, "peer host unavailable");
      connection.peerHost?.peers.clear();
      this.options.onAnyClientClose?.(client, connection);
      return;
    }
    if (connection.role === "connect") {
      const peerHost = client.peerHost;
      const peerKey = canonicalUserName(client.name);
      if (peerHost?.peers.get(peerKey) !== client) return;
      peerHost.peers.delete(peerKey);
      this.notifyPeerUserLogoff(peerHost, client);
      if (peerHost.ws.readyState === OPEN)
        this.sendMessage(
          peerHost.ws,
          this.systemMessage(
            "ConnectionProblem",
            [peerHost.name],
            lingoString(client.name),
            -1,
          ),
        );
      this.options.onAnyClientClose?.(client, connection);
      return;
    }
    const key = this.clientKey(client.movie, client.name);
    if (this.clients.get(key) !== client) return;
    this.clients.delete(key);
    for (const groupKey of [...client.groups]) {
      const group = this.groups.get(groupKey);
      if (group) this.leaveGroup(client, group.name);
    }
    this.notifyMovie(
      client.movie,
      "userLogoff",
      lingoPropList({ user: client.name }),
    );
    this.options.onClientClose?.(client, connection);
    this.options.onAnyClientClose?.(client, connection);
  }
}

export function attachMultiuser(server, options = {}) {
  const safeClose = (socket, code, reason) => { try { socket.close(code, reason); } catch {} };
  const webSocketServer = new WebSocketServer({
    server,
    path: options.path,
    maxPayload: options.maxPayload ?? 1024 * 1024,
    verifyClient: options.verifyOrigin
      ? ({ origin, req }) => options.verifyOrigin(origin, req)
      : undefined,
  });
  const relay = new MultiuserRelay(options);
  const heartbeat = setInterval(() => {
    for (const socket of webSocketServer.clients) {
      try {
        if (socket.gutfeelAlive === false) {
          socket.terminate();
          continue;
        }
        socket.gutfeelAlive = false;
        socket.ping();
      } catch {
        try { socket.terminate(); } catch {}
      }
    }
  }, options.pingIntervalMs ?? 30_000);
  heartbeat.unref?.();
  webSocketServer.on("connection", (socket, request) => {
    socket.gutfeelAlive = true;
    socket.on("pong", () => { socket.gutfeelAlive = true; });
    let context;
    try {
      context = options.resolveConnection?.(request) ?? null;
    } catch (error) {
      safeClose(socket, 1008, error?.code ?? "lobby authorization failed");
      return;
    }
    try {
      (context?.relay ?? relay).handleConnection(socket, request, context ?? {});
    } catch {
      safeClose(socket, 1011, "relay setup failure");
    }
  });
  webSocketServer.on("close", () => clearInterval(heartbeat));
  return webSocketServer;
}
