const nativeFetch = window.fetch.bind(window);
const pageMode = new URLSearchParams(location.search).get('mode');

function currentLobbySession() {
  const session = window.gutfeelLobbySession;
  if (!session || typeof session.lobbyId !== 'string' || typeof session.credential !== 'string' || typeof session.instance !== 'string') return null;
  return session;
}

function appendLobbyToDirectoryRequest(input) {
  const raw = typeof input === 'string' ? input : input?.url;
  if (!raw) return input;
  const url = new URL(raw, location.href);
  if (url.hostname !== 'www.cool-science.net' && url.hostname !== 'cool-science.net') return input;
  if (url.pathname.toLowerCase().endsWith('/gomu.dcr')) return new URL('/movies/client/goMU.dcr', location.href).href;
  if (!url.pathname.startsWith('/MUI/')) return input;
  const session = currentLobbySession();
  const local = new URL(`/legacy${url.pathname}${url.search}`, location.href);
  if (session) {
    local.searchParams.set('lobby', session.lobbyId);
    local.searchParams.set('credential', session.credential);
    local.searchParams.set('instance', session.instance);
  }
  return local.href;
}

window.fetch = (input, init) => nativeFetch(appendLobbyToDirectoryRequest(input), init);

function resolveGutFeelSocket(host, port, metadata = {}) {
  const query = new URLSearchParams({
    host,
    port: String(port),
    ...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)])),
  });
  if (metadata.kind === 'peer-host') query.set('role', 'peer-host');
  else if (metadata.peerHostUser) { query.set('role', 'connect'); query.set('hostUser', metadata.peerHostUser); }
  const session = currentLobbySession();
  if (session?.role === 'facilitator' || (!session && pageMode === 'host')) query.set('mode', 'host');
  if (session) {
    query.set('lobby', session.lobbyId);
    query.set('credential', session.credential);
    query.set('instance', session.instance);
  }
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/multiuser?${query}`;
}

window.dirplayerResolveSocketUrl = resolveGutFeelSocket;
window.gutfeelBeforeMovie = async movieUrl => {
  window.dirplayerResolveSocketUrl = resolveGutFeelSocket;
  window.__vm.set_break_on_error(false);
  const configUrl = new URL('DSConfig.amd', movieUrl).href;
  const response = await nativeFetch(configUrl);
  if (!response.ok) throw new Error('Unable to load original game configuration.');
  const config = await response.text();
  if (!window.__vm.preload_ini_file) throw new Error('The game runtime needs its configuration adapter.');
  window.__vm.preload_ini_file(configUrl, config);
};
