import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const MAX_PLAYERS = 5;
const MAX_LOBBIES = 1000;
const LOBBY_TTL_MS = 8 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 15 * 60 * 1000;

const opaque = (bytes) => randomBytes(bytes).toString("base64url");
const digest = (value) => createHash("sha256").update(String(value)).digest();
const digestKey = (value) => digest(value).toString("hex");
const safeEqual = (left, right) => {
  const a = digest(left);
  const b = Buffer.isBuffer(right) ? right : digest(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const canonical = (value) => String(value ?? "").toLowerCase();
const displayName = (identity) =>
  identity ? String(identity).replace(/_[1-9][0-9]{0,2}$/, "") : null;

export class LobbyRegistry {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.relayFactory = options.relayFactory;
    this.lobbies = new Map();
    this.rateBuckets = new Map();
  }

  create() {
    if (this.lobbies.size >= MAX_LOBBIES) throw this.error(503, "lobby_capacity_reached");
    const now = this.now();
    const lobbyId = opaque(16);
    const facilitatorToken = opaque(32);
    const creatorPlayerToken = opaque(32);
    const lobby = {
      id: lobbyId,
      state: "waiting",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + LOBBY_TTL_MS,
      emptySince: now,
      facilitator: {
        tokenDigest: digest(facilitatorToken),
        sockets: new Set(),
        boundName: null,
        connected: false,
      },
      members: new Map(),
      creatorMemberId: null,
      hostEntry: null,
      relay: null,
    };
    const creator = this.#newMember(creatorPlayerToken, true);
    lobby.creatorMemberId = creator.id;
    lobby.members.set(digestKey(creatorPlayerToken), creator);
    lobby.relay = this.relayFactory?.(this.#relayOptions(lobby)) ?? null;
    this.lobbies.set(lobbyId, lobby);
    return {
      lobbyId,
      facilitatorToken,
      creatorPlayerToken,
      memberId: creator.id,
      snapshot: this.snapshot(lobby),
    };
  }

  join(lobbyId) {
    const lobby = this.require(lobbyId);
    if (lobby.state !== "waiting") throw this.error(409, "lobby_not_waiting");
    if (lobby.members.size >= MAX_PLAYERS) throw this.error(409, "lobby_full");
    const playerToken = opaque(32);
    const member = this.#newMember(playerToken, false);
    lobby.members.set(digestKey(playerToken), member);
    this.#touch(lobby);
    return { playerToken, memberId: member.id, snapshot: this.snapshot(lobby) };
  }

  get(lobbyId) {
    const lobby = this.lobbies.get(String(lobbyId));
    if (!lobby || this.#expired(lobby)) return null;
    return lobby;
  }

  require(lobbyId) {
    const lobby = this.get(lobbyId);
    if (!lobby) throw this.error(404, "lobby_not_found");
    return lobby;
  }

  authorize(lobbyId, token) {
    const lobby = this.require(lobbyId);
    if (!token) throw this.error(401, "credential_required");
    if (safeEqual(token, lobby.facilitator.tokenDigest))
      return { lobby, role: "facilitator", principal: lobby.facilitator };
    const member = lobby.members.get(digestKey(token));
    if (!member) throw this.error(401, "invalid_credential");
    return { lobby, role: "player", principal: member };
  }

  start(lobbyId, token) {
    const grant = this.authorize(lobbyId, token);
    if (grant.role !== "facilitator") throw this.error(403, "facilitator_required");
    const { lobby } = grant;
    if (lobby.state !== "waiting") throw this.error(409, "invalid_lobby_state");
    if (!this.#allPlayersReady(lobby) || !lobby.facilitator.connected)
      throw this.error(409, "players_not_ready", this.snapshot(lobby));
    lobby.state = "starting";
    this.#touch(lobby);
    return this.snapshot(lobby);
  }

  leave(lobbyId, token) {
    const grant = this.authorize(lobbyId, token);
    if (grant.role !== "player") throw this.error(403, "player_required");
    for (const socket of grant.principal.sockets)
      this.#closeSocket(socket, 1008, "member left lobby");
    lobbyId = grant.lobby.id;
    grant.lobby.members.delete(grant.principal.tokenKey);
    if (grant.principal.creator) grant.lobby.creatorMemberId = null;
    this.#touch(grant.lobby);
    return lobbyId;
  }

  remove(lobbyId, token, memberId) {
    const grant = this.authorize(lobbyId, token);
    if (grant.role !== "facilitator") throw this.error(403, "facilitator_required");
    if (grant.lobby.state !== "waiting") throw this.error(409, "invalid_lobby_state");
    const member = [...grant.lobby.members.values()].find((candidate) => candidate.id === memberId);
    if (!member) throw this.error(404, "member_not_found");
    if (member.creator) throw this.error(409, "creator_cannot_be_removed");
    for (const socket of member.sockets)
      this.#closeSocket(socket, 1008, "member removed from lobby");
    grant.lobby.members.delete(member.tokenKey);
    this.#touch(grant.lobby);
  }

  end(lobbyId, token) {
    const grant = this.authorize(lobbyId, token);
    if (grant.role !== "facilitator") throw this.error(403, "facilitator_required");
    grant.lobby.state = "ended";
    for (const member of grant.lobby.members.values())
      for (const socket of member.sockets) this.#closeSocket(socket, 1001, "lobby ended");
    for (const socket of grant.lobby.facilitator.sockets)
      this.#closeSocket(socket, 1001, "lobby ended");
    this.#touch(grant.lobby);
  }

  snapshot(lobbyOrId) {
    const lobby = typeof lobbyOrId === "string" ? this.require(lobbyOrId) : lobbyOrId;
    const players = [...lobby.members.values()].map((member) => ({
      id: member.id,
      displayName: displayName(member.boundName),
      connected: member.mainConnected,
      ready: member.mainConnected && member.groups.size > 0,
      creator: member.creator,
    }));
    return {
      lobbyId: lobby.id,
      state: lobby.state,
      creatorMemberId: lobby.creatorMemberId,
      players,
      playerCount: players.length,
      maxPlayers: MAX_PLAYERS,
      facilitatorConnected: lobby.facilitator.connected,
      expiresAt: new Date(lobby.expiresAt).toISOString(),
    };
  }

  connectionGrant(lobbyId, token, instance) {
    const grant = this.authorize(lobbyId, token);
    if (!instance || !/^[A-Za-z0-9_-]{8,128}$/.test(instance))
      throw this.error(401, "invalid_instance");
    return { ...grant, instance };
  }

  attachSocket(grant, socket) {
    const maximum = grant.role === "facilitator" ? 2 : 8;
    if (grant.principal.sockets.size >= maximum) return false;
    grant.principal.sockets.add(socket);
    grant.lobby.emptySince = null;
    this.#touch(grant.lobby);
    return true;
  }

  detachSocket(grant, socket) {
    grant?.principal?.sockets.delete(socket);
    if (grant?.lobby && this.#socketCount(grant.lobby) === 0)
      grant.lobby.emptySince = this.now();
    if (grant?.lobby) this.#touch(grant.lobby);
  }

  listHosts(grant, subject) {
    if (!grant?.lobby?.hostEntry) return [];
    return canonical(grant.lobby.hostEntry.subject) === canonical(subject)
      ? [grant.lobby.hostEntry]
      : [];
  }

  checkRate(kind, address, limit, windowMs) {
    const key = `${kind}\0${address}`;
    const now = this.now();
    let bucket = this.rateBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      this.rateBuckets.set(key, bucket);
    }
    bucket.count++;
    return bucket.count <= limit;
  }

  sweep() {
    const now = this.now();
    for (const [id, lobby] of this.lobbies) {
      const emptyExpired = lobby.emptySince && now - lobby.emptySince >= EMPTY_TTL_MS;
      if (lobby.state === "ended" || now >= lobby.expiresAt || emptyExpired) {
        for (const member of lobby.members.values())
          for (const socket of member.sockets) this.#closeSocket(socket, 1001, "lobby expired");
        for (const socket of lobby.facilitator.sockets)
          this.#closeSocket(socket, 1001, "lobby expired");
        this.lobbies.delete(id);
      }
    }
    for (const [key, bucket] of this.rateBuckets)
      if (now - bucket.startedAt >= 60 * 60 * 1000) this.rateBuckets.delete(key);
  }

  error(status, code, snapshot) {
    return Object.assign(new Error(code), { status, code, snapshot });
  }

  #newMember(token, creator) {
    return {
      id: opaque(8),
      tokenKey: digestKey(token),
      sockets: new Set(),
      boundName: null,
      instance: null,
      mainConnected: false,
      groups: new Set(),
      creator,
    };
  }

  #relayOptions(lobby) {
    const registry = this;
    const facilitatorSubjects = new Set([
      "forcechosegroup", "startgame", "playgame", "msetscenario",
      "mcompetition", "mbreakfast", "mlunch", "mdinner",
      "mstopallactivity", "mcalculatescore", "updategroupname",
      "mquitprogram", "activateai", "deactivateai", "groupnamesdeliver",
      "msyncwithhost",
    ]);
    return {
      maxPeerConnections: MAX_PLAYERS,
      authorizeConnection(connection) {
        const grant = connection.grant;
        if (!grant) return false;
        if (grant.role === "facilitator")
          return !connection.role && connection.mode === "host";
        return connection.mode !== "host" && ["", "peer-host", "connect"].includes(connection.role);
      },
      authorizeIdentity(connection, name) {
        const grant = connection.grant;
        const principal = grant.principal;
        if (!name || name.length > 128 || /[\0\r\n]/.test(name)) return false;
        if (grant.role === "facilitator" && canonical(name) !== "host") return false;
        if (grant.role === "player" && canonical(name) === "host") return false;
        if (
          grant.role === "player" && lobby.facilitator.boundName &&
          canonical(name) === canonical(lobby.facilitator.boundName)
        ) return false;
        if (
          grant.role === "facilitator" && [...lobby.members.values()].some(
            (member) => member.boundName && canonical(member.boundName) === canonical(name),
          )
        ) return false;
        const otherSockets = [...principal.sockets].filter((socket) => socket !== connection.ws);
        if (principal.boundName && canonical(principal.boundName) !== canonical(name)) {
          if (otherSockets.length > 0) return false;
          principal.boundName = null;
          if (grant.role === "player") {
            principal.groups.clear();
            principal.mainConnected = false;
          } else {
            principal.connected = false;
          }
        }
        if (principal.instance && principal.instance !== grant.instance && otherSockets.length > 0)
          return false;
        principal.boundName ??= name;
        principal.instance = grant.instance;
        return canonical(principal.boundName) === canonical(name);
      },
      authorizeMessage(client, message) {
        const grant = client.grant;
        if (grant.role === "player" && facilitatorSubjects.has(canonical(message.subject)))
          return false;
        if (grant.role === "facilitator" && canonical(message.subject) === "startgame")
          return lobby.state === "starting";
        return true;
      },
      onConnectionOpen(connection) {
        return registry.attachSocket(connection.grant, connection.ws);
      },
      onConnectionClose(connection) {
        registry.detachSocket(connection.grant, connection.ws);
      },
      onAnyClientLogon(client, connection) {
        client.grant = connection.grant;
        if (connection.grant.role === "facilitator") {
          lobby.facilitator.connected = true;
          lobby.hostEntry = { subject: client.movie, name: client.name, seen: registry.now() };
        } else if (!connection.role) {
          connection.grant.principal.mainConnected = true;
        }
        registry.#touch(lobby);
      },
      onAnyClientClose(client, connection) {
        const grant = connection.grant;
        if (grant.role === "facilitator") {
          lobby.facilitator.connected = false;
          if (lobby.hostEntry && canonical(lobby.hostEntry.name) === canonical(client.name))
            lobby.hostEntry = null;
          if (lobby.state === "starting" || lobby.state === "running") {
            lobby.state = "ended";
            for (const member of lobby.members.values())
              for (const socket of member.sockets)
                registry.#closeSocket(socket, 1001, "facilitator disconnected");
          }
        } else if (!connection.role) {
          grant.principal.mainConnected = false;
          grant.principal.groups.clear();
        }
        registry.#touch(lobby);
      },
      onGroupJoin(client, group) {
        if (client.grant?.role === "player") client.grant.principal.groups.add(group.key);
        registry.#touch(lobby);
      },
      onGroupLeave(client, group) {
        if (client.grant?.role === "player") client.grant.principal.groups.delete(group.key);
        registry.#touch(lobby);
      },
      onFacilitatorStart() {
        lobby.state = "running";
        registry.#touch(lobby);
      },
    };
  }

  #allPlayersReady(lobby) {
    return lobby.members.size > 0 && [...lobby.members.values()].every(
      (member) => member.boundName && member.mainConnected && member.groups.size > 0,
    );
  }

  #socketCount(lobby) {
    return lobby.facilitator.sockets.size +
      [...lobby.members.values()].reduce((sum, member) => sum + member.sockets.size, 0);
  }

  #closeSocket(socket, code, reason) {
    try { socket.close(code, reason); } catch {}
  }

  #touch(lobby) {
    lobby.updatedAt = this.now();
  }

  #expired(lobby) {
    return lobby.state === "ended" || this.now() >= lobby.expiresAt;
  }
}

export const lobbyLimits = Object.freeze({ maxPlayers: MAX_PLAYERS });
