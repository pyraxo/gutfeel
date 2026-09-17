import {bootstrapLobbyMovie, startLobbyMatch} from './lobby-runtime.js';

// The facilitator is kept mounted off-screen while the drawer is closed. This
// cap affects only framebuffer readback; the Director VM and its networking
// continue at their authored cadence.
window.__dirplayerFlashCaptureMaxFps = 1;

let session;
let initialized = false;
let busy = false;
const status = document.querySelector('#host-status');
const notify = (type, detail = {}) => parent.postMessage({type, lobbyId: session?.lobbyId, ...detail}, location.origin);
const showError = error => {
  status.textContent = error.message || 'Mission control could not start.';
  notify('gutfeel:lobby-host-error', {message: status.textContent});
};

window.addEventListener('message', async event => {
  if (parent === window || event.source !== parent || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'gutfeel:lobby-host-visibility' && session &&
      message.lobbyId === session.lobbyId && typeof message.visible === 'boolean') {
    window.__dirplayerFlashCaptureMaxFps = message.visible ? 0 : 1;
    return;
  }
  if (message.type === 'gutfeel:lobby-host-init' && !initialized) {
    if (typeof message.lobbyId !== 'string' || typeof message.credential !== 'string' ||
        typeof message.instance !== 'string') return;
    initialized = true;
    session = {lobbyId: message.lobbyId, credential: message.credential, instance: message.instance, role: 'facilitator'};
    window.gutfeelLobbySession = session;
    try {
      const response = await fetch(`/api/lobbies/${encodeURIComponent(session.lobbyId)}`, {
        headers: {Authorization: `Bearer ${session.credential}`}, cache: 'no-store'
      });
      if (!response.ok) throw new Error('This lobby session has expired.');
      const movie = document.createElement('embed');
      Object.assign(movie, {src: '/movies/host/main.dir', width: '800', height: '600', type: 'application/x-director'});
      movie.setAttribute('_compactMovieMemory', '1');
      document.querySelector('#host-game').replaceChildren(movie);
      DirPlayer.init();
      await bootstrapLobbyMovie({mode: 'host', session, prefillName: message.prefillName || 'Creator',
        onStatus: text => { status.textContent = text; }});
      status.textContent = '';
      notify('gutfeel:lobby-host-ready');
    } catch (error) { showError(error); }
  } else if (message.type === 'gutfeel:lobby-host-start' && session &&
             message.lobbyId === session.lobbyId && !busy) {
    busy = true;
    try {
      const response = await fetch(`/api/lobbies/${encodeURIComponent(session.lobbyId)}`, {
        headers: {Authorization: `Bearer ${session.credential}`}, cache: 'no-store'
      });
      if (!response.ok || (await response.json()).state !== 'starting') {
        throw new Error('The lobby is not ready to start.');
      }
      await startLobbyMatch({scenario: message.scenario});
      notify('gutfeel:lobby-host-started');
    } catch (error) { showError(error); }
    finally { busy = false; }
  }
});

// The player's foreground movie owns music. Keep this original facilitator
// movie silent, including after its AudioContext is created asynchronously.
setInterval(() => {
  const audio = window.getAudioContext?.();
  if (audio?.state === 'running') audio.suspend().catch(() => {});
}, 500);
if (parent !== window) parent.postMessage({type: 'gutfeel:lobby-host-agent-loaded'}, location.origin);
