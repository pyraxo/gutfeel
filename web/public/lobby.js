(() => {
  const page = new URL(location.href);
  const mode = ['client', 'host'].includes(page.searchParams.get('mode')) ? page.searchParams.get('mode') : 'client';
  if (page.searchParams.get('mode') === 'tutorial') return;

  const storage = {
    player: 'gutfeel.lobby.player.v1',
    host: 'gutfeel.lobby.host.v1',
  };
  const $ = selector => document.querySelector(selector);
  const lobby = $('#lobby');
  const createForm = $('#lobby-create');
  const joinForm = $('#lobby-join');
  const sessionPanel = $('#lobby-session');
  const errorNode = $('#lobby-error');
  const hostFrame = $('#host-agent-frame');
  const invitedLobby = page.searchParams.get('lobby');
  let playerSession = readSession(storage.player);
  let hostSession = readSession(storage.host);
  let snapshot = null;
  let hostAgentReady = false;
  let poll = 0;
  let runtimePromise = null;
  let submitting = false;
  let lastLobbyState = '';
  let lastRoster = '';
  const compactView = window.matchMedia('(max-width: 1100px), (any-pointer: coarse)');
  const sessionAnchor = document.createComment('Lobby session home');
  sessionPanel.before(sessionAnchor);
  const errorAnchor = document.createComment('Lobby error home');
  errorNode.before(errorAnchor);
  const navigation = [...document.querySelectorAll('nav a, header a[href="/"]')].map(link => ({link, href: link.getAttribute('href')}));

  function lobbyRuntime() {
    runtimePromise ||= import('./lobby-runtime.js');
    return runtimePromise;
  }

  function readSession(key) {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || 'null');
      return validSession(value) ? value : null;
    } catch { return null; }
  }

  function validSession(value) {
    return value && typeof value.lobbyId === 'string' && typeof value.credential === 'string'
      && typeof value.instance === 'string' && (value.role === 'player' || value.role === 'facilitator');
  }

  function writeSession(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  function makeInstance() {
    return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function validateName(value, required) {
    const name = value.trim();
    if (!name && !required) return '';
    if (!/^[A-Za-z0-9 _-]{1,10}$/.test(name)) throw new Error('Use 1–10 letters, numbers, spaces, hyphens, or underscores.');
    if (/^(host|system)$/i.test(name)) throw new Error('That name is reserved. Choose another name.');
    return name;
  }

  function inviteUrl(lobbyId) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('lobby', lobbyId);
    return url.href;
  }

  function rememberInvite(lobbyId) {
    // A copied address must remain a useful invite even if clipboard access is
    // unavailable. The URL contains only the public lobby locator.
    const url = new URL(location.href);
    url.searchParams.set('lobby', lobbyId);
    history.replaceState(null, '', url);
  }

  function setLobbyPanelOpen(open) {
    const panel = $('#game-lobby-panel');
    const toggle = $('#game-lobby-toggle');
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      window.dispatchEvent(new CustomEvent('gutfeel:release-controls'));
      $('#copy-code')?.focus({preventScroll: true});
    } else if (panel.contains(document.activeElement)) {
      toggle.focus({preventScroll: true});
    }
    constrainLobbyPanel();
  }

  function constrainLobbyPanel() {
    const panel = $('#game-lobby-panel');
    const game = $('#game');
    const surface = $('#play-surface');
    if (!panel || !game || !surface) return;
    const stage = game.getBoundingClientRect();
    const outer = surface.getBoundingClientRect();
    if (!stage.height) return;
    panel.style.top = `${stage.top - outer.top + 8}px`;
    panel.style.maxHeight = `${Math.max(100, stage.height - 16)}px`;
  }

  function positionSession() {
    const active = Boolean(playerSession || hostSession);
    const surface = $('#play-surface');
    const panel = $('#game-lobby-panel');
    const toggle = $('#game-lobby-toggle');
    if (!panel || !toggle) return;
    const overlay = active && (compactView.matches || document.fullscreenElement === surface || surface.classList.contains('expanded'));
    toggle.hidden = !overlay;
    if (overlay) {
      if (sessionPanel.parentElement !== panel) panel.append(sessionPanel);
      if (errorNode.parentElement !== panel) panel.append(errorNode);
    } else {
      if (sessionPanel.previousSibling !== sessionAnchor) sessionAnchor.after(sessionPanel);
      if (errorNode.previousSibling !== errorAnchor) errorAnchor.after(errorNode);
      setLobbyPanelOpen(false);
    }
    lobby.classList.toggle('session-in-game', overlay);
    document.body.classList.toggle('has-lobby', active);
    constrainLobbyPanel();
  }

  function protectActiveNavigation(active) {
    for (const {link, href} of navigation) {
      const target = new URL(href, location.href);
      const helpPage = target.pathname.endsWith('/about.html') || target.pathname.endsWith('/technical.html') || target.searchParams.get('mode') === 'tutorial';
      if (active && helpPage) {
        link.target = '_blank';
        link.rel = 'noopener';
        link.setAttribute('aria-description', 'Opens in another tab so your game stays connected.');
      } else {
        link.removeAttribute('target');
        link.removeAttribute('rel');
        link.removeAttribute('aria-description');
      }
      if (!helpPage && (target.pathname === '/' || target.pathname.endsWith('/index.html'))) {
        link.href = active ? '#play-surface' : href;
      }
    }
  }

  function lobbyIdFromInput(value) {
    const candidate = value.trim();
    if (!candidate) throw new Error('Enter a lobby code or invite link.');
    try {
      const url = new URL(candidate);
      const fromUrl = url.searchParams.get('lobby');
      if (fromUrl) return fromUrl;
    } catch { /* A plain lobby id is valid. */ }
    return candidate;
  }

  async function request(path, {method = 'GET', credential, body} = {}) {
    const headers = {Accept: 'application/json'};
    if (credential) headers.Authorization = `Bearer ${credential}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    const json = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return json;
    const statusText = {
      401: 'This browser session is no longer valid. Join the lobby again.',
      403: 'Only the facilitator can do that.',
      404: 'That lobby is unavailable or has expired.',
      409: 'That lobby is full or has already started.',
      429: 'Please wait a moment before trying again.',
    }[response.status];
    const errorText = {
      creator_cannot_be_removed: 'The creator remains in this lobby. End the lobby to remove everyone.',
      member_not_found: 'That player has already left this lobby.',
      invalid_lobby_state: 'Players can only be removed while the lobby is waiting.',
    }[json?.error];
    throw new Error(json?.message || errorText || statusText || 'The lobby service could not complete that request.');
  }

  function showError(error) {
    errorNode.hidden = false;
    errorNode.textContent = error instanceof Error ? error.message : String(error);
    if (errorNode.parentElement?.id === 'game-lobby-panel') setLobbyPanelOpen(true);
  }

  function clearError() {
    errorNode.hidden = true;
    errorNode.textContent = '';
  }

  function sessionForRuntime() {
    return playerSession && {
      lobbyId: playerSession.lobbyId,
      credential: playerSession.credential,
      instance: playerSession.instance,
      role: 'player',
    };
  }

  function render() {
    lobby.hidden = false;
    const active = playerSession || hostSession;
    lobby.classList.toggle('is-active', Boolean(active));
    createForm.hidden = Boolean(active);
    joinForm.hidden = Boolean(active);
    sessionPanel.hidden = !active;
    $('#play-surface').hidden = !active;
    positionSession();
    protectActiveNavigation(Boolean(active));
    const lobbyState = {active: Boolean(active), phase: snapshot?.state || 'waiting', owner: Boolean(hostSession)};
    const stateKey = JSON.stringify(lobbyState);
    if (stateKey !== lastLobbyState) {
      lastLobbyState = stateKey;
      window.dispatchEvent(new CustomEvent('gutfeel:lobby-state', {detail: lobbyState}));
    }
    if (!active) return;
    const current = playerSession || hostSession;
    $('#lobby-code').textContent = current.lobbyId;
    const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
    const playerCount = Number.isInteger(snapshot?.playerCount) ? snapshot.playerCount : players.length;
    const maximum = Number(snapshot?.maxPlayers || 5);
    const connectedCount = players.filter(player => player.connected).length;
    $('#lobby-roster').textContent = `${playerCount} of ${maximum} slots · ${connectedCount} connected`;
    const rosterKey = JSON.stringify([players, Boolean(hostSession), snapshot?.state]);
    if (rosterKey !== lastRoster) $('#lobby-players').replaceChildren(...players.map(player => {
      const item = document.createElement('li');
      item.dataset.ready = String(Boolean(player.ready));
      const name = document.createElement('span');
      name.textContent = player.displayName || 'Connecting player';
      item.append(name);
      const canRemove = Boolean(hostSession?.credential)
        && snapshot?.state === 'waiting'
        && !player.creator
        && (!player.connected || !player.ready);
      if (canRemove) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'roster-remove';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${player.displayName || 'pending player'}`);
        remove.onclick = () => removePlayer(player.id);
        item.append(remove);
      }
      return item;
    }));
    lastRoster = rosterKey;
    const phase = snapshot?.state || 'waiting';
    const everyoneReady = players.length > 0 && players.every(player => player.connected && player.ready);
    $('#lobby-state').textContent = {
      waiting: snapshot?.facilitatorConnected ? (everyoneReady ? 'Everyone is ready. The host can start the game.' : 'Waiting for everyone to finish connecting…') : 'Waiting for mission control to connect…',
      starting: 'Starting the game…',
      running: 'Game in progress.',
      ended: 'This lobby has ended.',
    }[phase] || 'Checking lobby status…';
    const owner = Boolean(hostSession?.credential);
    $('#open-mission-control').hidden = !owner;
    $('#end-lobby').hidden = !owner;
    $('#leave-lobby').hidden = owner;
    $('#switch-lobby').hidden = !(invitedLobby && invitedLobby !== current.lobbyId && !owner);
    $('#start-lobby').hidden = !(owner && phase === 'waiting' && snapshot?.facilitatorConnected && everyoneReady);
    $('#leave-lobby').textContent = phase === 'ended' ? 'Return to lobby' : 'Leave lobby';
  }

  function postHostInit() {
    if (!hostAgentReady || !hostSession || hostFrame.contentWindow == null) return;
    hostFrame.contentWindow.postMessage({
      type: 'gutfeel:lobby-host-init',
      lobbyId: hostSession.lobbyId,
      credential: hostSession.credential,
      instance: hostSession.instance,
      prefillName: hostSession.prefillName || '',
      scenario: hostSession.scenario || 'normal',
    }, location.origin);
    postHostCaptureVisibility($('#mission-control').classList.contains('is-open'));
  }

  function postHostCaptureVisibility(visible) {
    if (!hostAgentReady || !hostSession || hostFrame.contentWindow == null) return;
    hostFrame.contentWindow.postMessage({
      type: 'gutfeel:lobby-host-visibility',
      lobbyId: hostSession.lobbyId,
      visible: Boolean(visible),
    }, location.origin);
  }

  function openMissionControl(open) {
    if (open) setLobbyPanelOpen(false);
    $('#mission-control').classList.toggle('is-open', open);
    $('#mission-control').setAttribute('aria-hidden', String(!open));
    postHostCaptureVisibility(open);
  }

  function ensureHostFrame() {
    if (hostFrame.src.endsWith('/host-agent.html')) return;
    hostFrame.src = 'host-agent.html';
  }

  async function refresh() {
    const current = playerSession || hostSession;
    if (!current) return;
    try {
      snapshot = await request(`/api/lobbies/${encodeURIComponent(current.lobbyId)}`, {credential: current.credential});
      render();
      if (snapshot?.state === 'ended') window.clearInterval(poll);
    } catch (error) {
      showError(error);
      if (/unavailable|expired|no longer valid/i.test(String(error))) {
        window.clearInterval(poll);
        window.setTimeout(() => discardSessionAndReload(), 800);
      }
    }
  }

  function startPolling() {
    window.clearInterval(poll);
    refresh();
    poll = window.setInterval(refresh, 4000);
  }

  async function launchClient() {
    const session = sessionForRuntime();
    if (!session) return;
    const runtime = await lobbyRuntime();
    window.gutfeelLobbyBootstrap = runtime.bootstrapLobbyMovie;
    window.gutfeelLobbySession = session;
    await window.gutfeelLaunchMovie?.({movieMode: 'client', session, prefillName: playerSession.prefillName || ''});
  }

  async function createLobby(event) {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    createForm.querySelector('button[type="submit"]').disabled = true;
    clearError();
    try {
      const name = validateName($('#creator-name').value, true);
      const scenario = $('#scenario').value === 'competition' ? 'competition' : 'normal';
      const created = await request('/api/lobbies', {method: 'POST', body: {}});
      if (!created?.lobbyId || !created.facilitatorToken || !created.creatorPlayerToken) throw new Error('The lobby service returned an incomplete session.');
      playerSession = {lobbyId: created.lobbyId, credential: created.creatorPlayerToken, instance: makeInstance(), role: 'player', memberId: created.memberId, prefillName: name, scenario, owner: true};
      hostSession = {lobbyId: created.lobbyId, credential: created.facilitatorToken, instance: makeInstance(), role: 'facilitator', prefillName: name, scenario};
      writeSession(storage.player, playerSession);
      writeSession(storage.host, hostSession);
      rememberInvite(created.lobbyId);
      snapshot = created.snapshot || {lobbyId: created.lobbyId, state: 'waiting', players: [], playerCount: 1, maxPlayers: 5, facilitatorConnected: false};
      render();
      ensureHostFrame();
      postHostInit();
      startPolling();
      await launchClient();
    } catch (error) { showError(error); }
    finally { submitting = false; createForm.querySelector('button[type="submit"]').disabled = false; }
  }

  async function joinLobby(event) {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    joinForm.querySelector('button[type="submit"]').disabled = true;
    clearError();
    try {
      const lobbyId = lobbyIdFromInput($('#join-code').value);
      const name = validateName($('#player-name').value, true);
      const joined = await request(`/api/lobbies/${encodeURIComponent(lobbyId)}/join`, {method: 'POST', body: {}});
      if (!joined?.playerToken) throw new Error('The lobby service returned an incomplete player session.');
      playerSession = {lobbyId: joined.lobbyId || lobbyId, credential: joined.playerToken, instance: makeInstance(), role: 'player', memberId: joined.memberId, prefillName: name, owner: false};
      hostSession = null;
      writeSession(storage.player, playerSession);
      sessionStorage.removeItem(storage.host);
      rememberInvite(playerSession.lobbyId);
      snapshot = joined.snapshot || {lobbyId: playerSession.lobbyId, state: 'waiting', players: [], playerCount: 1, maxPlayers: 5, facilitatorConnected: false};
      render();
      startPolling();
      await launchClient();
    } catch (error) { showError(error); }
    finally { submitting = false; joinForm.querySelector('button[type="submit"]').disabled = false; }
  }

  function discardSessionAndReload(destination = '?mode=client') {
    sessionStorage.removeItem(storage.player);
    sessionStorage.removeItem(storage.host);
    window.gutfeelLobbySession = null;
    window.clearInterval(poll);
    location.assign(destination);
  }

  async function leaveLobby(destination = '?mode=client') {
    const current = playerSession || hostSession;
    if (current && snapshot?.state !== 'ended') {
      try { await request(`/api/lobbies/${encodeURIComponent(current.lobbyId)}/leave`, {method: 'POST', credential: current.credential}); } catch { /* Local teardown still releases the native session. */ }
    }
    discardSessionAndReload(destination);
  }

  async function endLobby() {
    if (!hostSession || !confirm('End this lobby for every player?')) return;
    clearError();
    try {
      await request(`/api/lobbies/${encodeURIComponent(hostSession.lobbyId)}/end`, {method: 'POST', credential: hostSession.credential});
      snapshot = {...(snapshot || {}), state: 'ended'};
      render();
      openMissionControl(false);
      window.setTimeout(() => discardSessionAndReload(), 900);
    } catch (error) { showError(error); }
  }

  async function startLobby() {
    if (!hostSession) return;
    clearError();
    try {
      snapshot = await request(`/api/lobbies/${encodeURIComponent(hostSession.lobbyId)}/start`, {method: 'POST', credential: hostSession.credential});
      hostFrame.contentWindow?.postMessage({type: 'gutfeel:lobby-host-start', lobbyId: hostSession.lobbyId, scenario: hostSession.scenario || 'normal'}, location.origin);
      render();
    } catch (error) { showError(error); }
  }

  async function removePlayer(memberId) {
    if (!hostSession || !memberId) return;
    clearError();
    try {
      await request(`/api/lobbies/${encodeURIComponent(hostSession.lobbyId)}/remove`, {
        method: 'POST',
        credential: hostSession.credential,
        body: {memberId},
      });
      await refresh();
    } catch (error) { showError(error); }
  }

  createForm.addEventListener('submit', createLobby);
  joinForm.addEventListener('submit', joinLobby);
  async function copyLobby(kind) {
    const current = playerSession || hostSession;
    if (!current) return;
    const value = kind === 'code' ? current.lobbyId : inviteUrl(current.lobbyId);
    const button = $(kind === 'code' ? '#copy-code' : '#copy-invite');
    const label = kind === 'code' ? 'Copy code' : 'Copy link';
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = label; }, 1600);
    } catch {
      $('#share-label').textContent = kind === 'code' ? 'Select and copy this lobby code' : 'Select and copy this invite link';
      $('#share-value').value = value;
      $('#share-fallback').hidden = false;
      $('#share-value').focus({preventScroll: true});
      $('#share-value').select();
      $('#share-fallback').scrollIntoView({block: 'nearest'});
    }
  }
  $('#copy-invite').onclick = () => copyLobby('link');
  $('#copy-code').onclick = () => copyLobby('code');
  $('#share-close').onclick = () => { $('#share-fallback').hidden = true; };
  $('#game-lobby-toggle').onclick = () => setLobbyPanelOpen($('#game-lobby-panel').hidden);
  $('#game-lobby-close')?.addEventListener('click', () => setLobbyPanelOpen(false));
  compactView.addEventListener('change', positionSession);
  document.addEventListener('fullscreenchange', positionSession);
  new MutationObserver(positionSession).observe($('#play-surface'), {attributes: true, attributeFilter: ['class']});
  const panelBounds = new ResizeObserver(constrainLobbyPanel);
  panelBounds.observe($('#game'));
  panelBounds.observe($('#game-toolbar'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setLobbyPanelOpen(false);
  });
  $('#open-mission-control').onclick = () => openMissionControl(true);
  $('#close-mission-control').onclick = () => openMissionControl(false);
  $('#start-lobby').onclick = startLobby;
  $('#leave-lobby').onclick = () => leaveLobby();
  $('#switch-lobby').onclick = () => leaveLobby(`?lobby=${encodeURIComponent(invitedLobby)}`);
  $('#end-lobby').onclick = endLobby;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== hostFrame.contentWindow) return;
    const message = event.data || {};
    if (message.type === 'gutfeel:lobby-host-agent-loaded') {
      hostAgentReady = true;
      postHostInit();
      postHostCaptureVisibility($('#mission-control').classList.contains('is-open'));
    }
    if (message.type === 'gutfeel:lobby-host-ready' && message.lobbyId === hostSession?.lobbyId) {
      hostAgentReady = true;
      postHostInit();
      postHostCaptureVisibility($('#mission-control').classList.contains('is-open'));
    }
    if (message.type === 'gutfeel:lobby-host-error' && message.lobbyId === hostSession?.lobbyId) showError(new Error(message.message || 'Mission control could not start.'));
  });
  hostFrame.addEventListener('load', () => {
    postHostInit();
    postHostCaptureVisibility($('#mission-control').classList.contains('is-open'));
  });

  if (invitedLobby) $('#join-code').value = invitedLobby;
  render();
  if (playerSession || hostSession) {
    if (!invitedLobby) rememberInvite((playerSession || hostSession).lobbyId);
    startPolling();
    if (hostSession) ensureHostFrame();
    postHostInit();
    if (playerSession) launchClient();
    if (invitedLobby && invitedLobby !== (playerSession || hostSession).lobbyId) {
      showError(new Error(hostSession
        ? 'You are facilitating another lobby. End it before joining this invite.'
        : 'You are already in another lobby. Leave it before joining this invite.'));
    }
  }
})();
