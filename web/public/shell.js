const query = new URLSearchParams(location.search);
const mode = ['client', 'host', 'tutorial'].includes(query.get('mode')) ? query.get('mode') : 'client';
const titles = {
  client: ['Gut Feel', 'Work together to keep George’s digestive system running. Start or join a lobby to play online.', 'Start multiplayer'],
  tutorial: ['Automaton training', 'Learn the controls and each stage of digestion in the original tutorial.', 'Start training'],
  host: ['Mission control', 'Create a lobby to keep original mission control ready while you play.', 'Start hosting'],
};

document.querySelector('#mode-title').textContent = titles[mode][0];
document.querySelector('#mode-description').textContent = titles[mode][1];
document.querySelector('#launch').textContent = titles[mode][2];
document.querySelector('#play-surface').hidden = mode !== 'tutorial';
for (const link of document.querySelectorAll('.site-header nav a')) link.removeAttribute('aria-current');
document.querySelector(mode === 'tutorial' ? '.site-header nav a[href="?mode=tutorial"]' : '.site-header nav a[href="/"]')?.setAttribute('aria-current', 'page');

let started = false;
let runtimePromise;
function loadGameRuntime() {
  if (window.DirPlayer) return Promise.resolve();
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'runtime/dirplayer-polyfill.js';
      script.setAttribute('data-manual-init', '');
      script.onload = () => {
        if (window.DirPlayer) resolve();
        else script.onerror();
      };
      script.onerror = () => {
        script.remove();
        runtimePromise = null;
        reject(new Error('The game player could not load. Please try again.'));
      };
      document.head.append(script);
    });
  }
  return runtimePromise;
}
let reportDownloadUrl = '';
const keyCode = key => ({ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, ' ': 32}[key] || key.toUpperCase().charCodeAt(0));
const status = text => { document.querySelector('#status').textContent = text; };
const gameControls = document.querySelector('#game-controls');
gameControls.hidden = true;
const controlInput = window.GutFeelControlInput.createKeyOwnership({
  keyDown: key => window.__vm?.key_down(key, keyCode(key)),
  keyUp: key => window.__vm?.key_up(key, keyCode(key)),
  visualState: (button, active) => {
    button.classList.toggle('is-held', active);
  },
});
const directionKeys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'];
const acquireControl = (owner, key, button) => {
  if (key.startsWith('Arrow')) {
    for (const direction of directionKeys) if (direction !== key) controlInput.releaseKey(direction);
  }
  return controlInput.acquire(owner, key, button);
};
const releaseAll = () => controlInput.releaseAll();

async function launchMovie({movieMode = mode, session = null, prefillName = ''} = {}) {
  if (started) return;
  started = true;
  if (session) window.gutfeelLobbySession = session;
  const launchButton = document.querySelector('#launch');
  if (launchButton) launchButton.disabled = true;
  status('Loading game player…');
  try {
    await loadGameRuntime();
  } catch (error) {
    started = false;
    if (launchButton) launchButton.disabled = false;
    status(error.message);
    window.dispatchEvent(new CustomEvent('gutfeel-error', {detail: {message: error.message}}));
    return;
  }
  if (reportDownloadUrl) {
    URL.revokeObjectURL(reportDownloadUrl);
    reportDownloadUrl = '';
  }
  document.querySelector('#downloads').replaceChildren();
  document.querySelector('#downloads').hidden = true;
  const game = document.createElement('embed');
  Object.assign(game, {src: `movies/${movieMode}/main.dir`, width: '100%', height: '100%', type: 'application/x-director'});
  game.setAttribute('_compactMovieMemory', '1');
  document.querySelector('#game').replaceChildren(game);
  gameControls.hidden = false;
  DirPlayer.init();
  status('Loading original game assets…');
  const bootstrapLobbyMovie = window.gutfeelLobbyBootstrap;
  if (!session || !bootstrapLobbyMovie) return;
  try {
    await bootstrapLobbyMovie({
      mode: movieMode === 'host' ? 'host' : 'client',
      session,
      prefillName,
      onStatus: message => status(message || ''),
    });
  } catch (error) {
    window.dispatchEvent(new CustomEvent('gutfeel-error', {detail: {message: error?.message || 'Unable to prepare this lobby session.'}}));
  }
}

window.gutfeelLaunchMovie = launchMovie;
document.querySelector('#launch').onclick = () => launchMovie({session: window.gutfeelLobbySession || null});

let momentaryOwner = 0;
const handledPointerGestures = new WeakSet();
for (const button of document.querySelectorAll('[data-key]')) {
  const key = button.dataset.key;
  button.removeAttribute('aria-pressed');
  button.addEventListener('click', event => {
    // Pointer gestures already produced key-down/up. Consume their click even
    // when a browser delivers it late; a timeout could re-press a released key.
    const pointerClick = event.detail > 0 || event.pointerType || event.sourceCapabilities?.firesTouchEvents;
    if (pointerClick && handledPointerGestures.has(button)) {
      handledPointerGestures.delete(button);
      event.preventDefault();
      return;
    }
    handledPointerGestures.delete(button);
    if (!started || !window.__vm) return;
    // Keyboard/assistive activation or a click-only event is a short tap, never
    // a latched control. All continuous holds come from a live pointer.
    const owner = `click:${++momentaryOwner}`;
    acquireControl(owner, key, button);
    setTimeout(() => controlInput.release(owner), 140);
  });

  button.addEventListener('pointerdown', event => {
    if (!started || !window.__vm || (event.button != null && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    handledPointerGestures.add(button);
    try { button.setPointerCapture(event.pointerId); } catch {}
    acquireControl(`pointer:${event.pointerId}`, key, button);
  });
  const releasePointer = event => {
    event.preventDefault();
    controlInput.release(`pointer:${event.pointerId}`);
    try {
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    } catch {}
  };
  button.addEventListener('pointerup', releasePointer);
  button.addEventListener('pointercancel', releasePointer);
  button.addEventListener('lostpointercapture', releasePointer);
  button.addEventListener('pointerleave', event => {
    // If capture is unavailable, leaving the button must not strand a key.
    if (!button.hasPointerCapture?.(event.pointerId)) releasePointer(event);
  });
  button.addEventListener('contextmenu', event => event.preventDefault());
}
// Capture normally sends release back to the button. These handlers also cover
// browsers that release a pointer elsewhere after capture failed.
window.addEventListener('pointerup', event => controlInput.release(`pointer:${event.pointerId}`));
window.addEventListener('pointercancel', event => controlInput.release(`pointer:${event.pointerId}`));

document.querySelector('#stop').onclick = releaseAll;
document.querySelector('#stop').addEventListener('pointerdown', event => {
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  releaseAll();
});
document.querySelector('#stop').addEventListener('contextmenu', event => event.preventDefault());
const controlsMore = document.querySelector('#controls-more');
controlsMore.onclick = () => {
  releaseAll();
  const expanded = controlsMore.getAttribute('aria-expanded') !== 'true';
  controlsMore.setAttribute('aria-expanded', String(expanded));
  controlsMore.textContent = expanded ? 'Fewer controls' : 'More controls';
  controlsMore.setAttribute('aria-label', expanded ? 'Fewer controls' : 'More controls');
  document.querySelector('#game-controls').classList.toggle('controls-expanded', expanded);
};
document.querySelector('#restart').onclick = () => { releaseAll(); location.reload(); };
window.addEventListener('blur', releaseAll);
window.addEventListener('pagehide', releaseAll);
window.addEventListener('orientationchange', releaseAll);
screen.orientation?.addEventListener?.('change', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
window.addEventListener('gutfeel:release-controls', releaseAll);
window.addEventListener('gutfeel:lobby-state', event => {
  if (!event.detail?.active) releaseAll();
});

document.querySelector('#audio').onclick = async () => {
  const audio = window.getAudioContext?.();
  if (!audio) return status('Start a game to enable sound.');
  if (audio.state === 'running') await audio.suspend(); else await audio.resume();
  const on = audio.state === 'running';
  document.querySelector('#audio').textContent = on ? 'Mute sound' : 'Sound on';
  document.querySelector('#audio').setAttribute('aria-pressed', String(on));
};

let fullscreenAttempt = 0;
let nativeFullscreenActive = false;
const surface = document.querySelector('#play-surface');
const exitFullscreen = () => {
  fullscreenAttempt++;
  releaseAll();
  surface.classList.remove('expanded');
  document.body.classList.remove('game-expanded');
  document.querySelector('#fullscreen').textContent = 'Full screen';
  document.querySelector('#fullscreen').setAttribute('aria-pressed', 'false');
  if (document.fullscreenElement === surface) document.exitFullscreen().catch(() => {});
};
document.querySelector('#fullscreen').onclick = async () => {
  if (surface.classList.contains('expanded') || document.fullscreenElement === surface) {
    exitFullscreen();
    return;
  }
  releaseAll();
  const attempt = ++fullscreenAttempt;
  surface.classList.add('expanded');
  document.body.classList.add('game-expanded');
  document.querySelector('#fullscreen').textContent = 'Exit full screen';
  document.querySelector('#fullscreen').setAttribute('aria-pressed', 'true');
  try {
    await surface.requestFullscreen?.();
    if (attempt !== fullscreenAttempt && document.fullscreenElement === surface) await document.exitFullscreen();
  } catch { /* Expanded view remains useful when native fullscreen is unavailable. */ }
};
document.querySelector('#exit-fullscreen').onclick = exitFullscreen;
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === surface) nativeFullscreenActive = true;
  else if (nativeFullscreenActive) { nativeFullscreenActive = false; exitFullscreen(); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && surface.classList.contains('expanded')) exitFullscreen(); });

let last = '';
const debug = query.has('debug');
document.querySelector('#diagnostics').hidden = !debug;
setInterval(() => {
  try {
    if (!started || !window.__vm) return;
    const audio = window.getAudioContext?.();
    if (audio) {
      const on = audio.state === 'running';
      document.querySelector('#audio').textContent = on ? 'Mute sound' : 'Sound on';
      document.querySelector('#audio').setAttribute('aria-pressed', String(on));
    }
    const state = window.__vm.mcp_get_execution_state();
    if (state === last) return;
    last = state;
    const parsed = JSON.parse(state);
    if (parsed.movie_loaded && parsed.is_playing) status('');
    if (debug) document.querySelector('#diagnostics pre').textContent = `${state}\n${window.__vm.mcp_get_console_output(8)}`;
  } catch (error) { console.warn(error); }
}, 1000);

window.addEventListener('gutfeel-error', event => {
  releaseAll();
  status(`Game stopped: ${event.detail.message}`);
});
window.addEventListener('dirplayer:fileDownload', event => {
  const detail = event.detail || {};
  if (!(detail.blob instanceof Blob)) return;
  if (reportDownloadUrl) URL.revokeObjectURL(reportDownloadUrl);
  reportDownloadUrl = URL.createObjectURL(detail.blob);
  const filename = String(detail.filename || 'Report.zip').split(/[\\/]/).pop() || 'Report.zip';
  const downloadLink = document.createElement('a');
  downloadLink.href = reportDownloadUrl;
  downloadLink.download = filename;
  downloadLink.textContent = `Download ${filename}`;
  const openLink = document.createElement('a');
  openLink.href = `/report.html?src=${encodeURIComponent(reportDownloadUrl)}&name=${encodeURIComponent(filename)}`;
  openLink.target = '_blank';
  openLink.rel = 'noopener';
  openLink.textContent = 'Open report';
  const downloads = document.querySelector('#downloads');
  downloads.replaceChildren(document.createTextNode('Report ready.'), downloadLink, openLink);
  downloads.hidden = false;
});
window.addEventListener('beforeunload', () => { if (reportDownloadUrl) URL.revokeObjectURL(reportDownloadUrl); });
