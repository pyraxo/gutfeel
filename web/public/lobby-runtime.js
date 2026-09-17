// Fixed setup actions for the preserved Director movies. This module never
// accepts Lingo source from a URL, API response, or postMessage payload.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let bootstrap;
let hostReady = false;
let matchStarted = false;

function state() {
  try { return JSON.parse(window.__vm?.mcp_get_execution_state() || '{}'); }
  catch { return {}; }
}

async function lingo(source) {
  const reply = JSON.parse(await window.__vm.mcp_eval_lingo(source));
  if (!reply.success) throw new Error('The original game could not complete lobby setup.');
  if (reply.result_type === 'string') {
    try { return JSON.parse(reply.result_value); } catch { return reply.result_value; }
  }
  if (reply.result_type === 'int' || reply.result_type === 'float') return Number(reply.result_value);
  return reply.result_value;
}

async function until(check, label, signal, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Lobby setup cancelled.', 'AbortError');
    if (window.__gutfeelSetupFailure) throw new Error(window.__gutfeelSetupFailure);
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`Timed out ${label}. Return to the lobby and retry.`);
}

function playerName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9 _-]{1,10}$/.test(name) || /^(host|system)$/i.test(name)) {
    throw new Error('Use 1–10 letters, numbers, spaces, underscores or hyphens for your player name.');
  }
  return name;
}

async function nativeClick(x, y) {
  const view = state();
  const scale = Math.min(view.stage_width / 800, view.stage_height / 600);
  const px = (view.stage_width - 800 * scale) / 2 + x * scale;
  const py = (view.stage_height - 600 * scale) / 2 + y * scale;
  window.__vm.mouse_down(px, py);
  try { await delay(100); } finally { window.__vm.mouse_up(px, py); }
}

async function setupHost(prefillName, signal, onStatus) {
  onStatus('Preparing mission control…');
  await until(() => state().current_frame === 4, 'loading mission control', signal);
  // Keep the authored server identity. The authenticated lobby replaces the
  // retired ipconfig/getIP registration loop (which precedes native MUS logon).
  await lingo('member("username_text").text = "host"');
  await lingo(`member("Teacherusername_text").text = "${playerName(prefillName || 'Creator')}"`);
  const createFrame = await lingo('marker("createGroup")');
  await lingo('go("createGroup")');
  await until(() => state().current_frame === createFrame, 'loading the original team setup', signal);
  // Invoke the original Create button, including gTeamScore initialization.
  const waitingFrame = await lingo('marker("waiting")');
  await nativeClick(405, 480);
  await until(async () => {
    if (state().current_frame !== waitingFrame) return false;
    return (await lingo('string(gMuobj.pHostNm)')) === 'host';
  }, 'connecting mission control', signal);
  hostReady = true;
  onStatus('Mission control ready.');
}

async function setupClient(prefillName, session, signal, onStatus) {
  const name = playerName(prefillName);
  onStatus('Waiting for mission control…');
  await until(async () => {
    const response = await fetch(`/api/lobbies/${encodeURIComponent(session.lobbyId)}`, {
      headers: {Authorization: `Bearer ${session.credential}`}, cache: 'no-store', signal
    });
    if (!response.ok) throw new Error('This lobby is no longer available.');
    const lobby = await response.json();
    if (lobby.state === 'ended') throw new Error('This lobby has ended.');
    return lobby.facilitatorConnected;
  }, 'waiting for the lobby creator', signal);
  onStatus('Connecting your original game…');
  await until(() => state().current_frame === 3, 'loading the game', signal);
  // Browser fullscreen and authenticated lobby discovery replace the original
  // Flash desktop prompt and retired public IP directory. "localhost" remains
  // only a legacy address label; bridge.js routes every socket to this origin.
  await lingo('member("IPAddress_fromServer").text = "localhost"');
  await lingo('go("LOGINSTART")');
  const loginFrame = await lingo('marker("LOGINSTART")');
  await until(() => state().current_frame === loginFrame, 'finding this lobby’s host', signal);
  await lingo(`member("username_text").text = "${name}"`);
  // Original Login.mouseUp's validated transition, followed by its Main OBJ.
  await lingo('go("wait")');
  const joinFrame = await lingo('marker("joinGroup")');
  await until(() => state().current_frame === joinFrame, 'receiving the team list', signal);
  // Each internet lobby is one original five-player team. Other lobbies have
  // independent relays, so every game can retain the authored Group1 name.
  await lingo('gMuObj.JoinGroup("Group1")');
  await until(async () => (await lingo('gProperty.members.count')) >= 1,
    'joining your team', signal);
  onStatus('Ready. Waiting for the lobby creator to start.');
}

export function bootstrapLobbyMovie({mode, session, prefillName, onStatus = () => {}, signal} = {}) {
  if (bootstrap) return bootstrap;
  if (!session?.lobbyId || !session?.credential || !session?.instance ||
      !['client', 'host'].includes(mode)) return Promise.reject(new Error('A lobby session is required.'));
  window.__gutfeelSetupFailure = '';
  window.addEventListener('gutfeel-error', event => {
    window.__gutfeelSetupFailure = String(event.detail?.message || 'The original game stopped.');
  }, {once: true});
  bootstrap = (async () => {
    await until(() => state().movie_loaded && window.__vm?.mcp_eval_lingo,
      'loading the original runtime', signal);
    if (mode === 'host') await setupHost(prefillName, signal, onStatus);
    else await setupClient(prefillName, session, signal, onStatus);
  })();
  return bootstrap;
}

export async function startLobbyMatch({scenario = 'normal'} = {}) {
  if (!hostReady) throw new Error('Mission control is not ready yet.');
  if (matchStarted) return;
  if (!['normal', 'competition'].includes(scenario)) throw new Error('Choose a supported scenario.');
  const competition = scenario === 'competition';
  // Use the original Start button so its native bytecode preserves scenario
  // rosters and score/report bookkeeping before sending startGame.
  await lingo(`gCurrentScene = #${competition ? 'Competition' : 'normal'}`);
  const scenarioFrame = await lingo('marker("scenarios")');
  await lingo('go("scenarios")');
  await until(() => state().current_frame === scenarioFrame, 'preparing the scenario');
  await nativeClick(660, 156);
  const session = window.gutfeelLobbySession;
  await until(async () => {
    const response = await fetch(`/api/lobbies/${encodeURIComponent(session.lobbyId)}`, {
      headers: {Authorization: `Bearer ${session.credential}`}, cache: 'no-store'
    });
    if (!response.ok) throw new Error('This lobby is no longer available.');
    return (await response.json()).state === 'running';
  }, 'starting the original game', undefined, 20000);
  matchStarted = true;
}
