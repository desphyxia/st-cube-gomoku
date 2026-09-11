/**
 * Application controller: owns the rules object, the three.js view and the
 * Steam transport, and keeps the three of them in agreement.
 */
import { MIN_SIZE, MAX_SIZE } from './cube.js';
import { Game, P1, P2 } from './game.js';
import { CubeView } from './view.js';
import { Net } from './net.js';
import { THEMES, DEFAULT_THEME, themeById, applyThemeToDocument } from './themes.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, difficultyById, chooseMove } from './ai.js';
import { MODES, RANDOM_MODE, DEFAULT_MODE, modeById, resolveMode } from './modes.js';

const $ = (id) => document.getElementById(id);

const state = {
  screen: 'title',
  mode: null,        // 'online' | 'hotseat' | 'ai'
  difficulty: DEFAULT_DIFFICULTY,
  modeChoice: DEFAULT_MODE,   // menu selection, may be 'random'
  rules: DEFAULT_MODE,        // the mode actually in play
  isHost: false,
  seat: P1,          // which player I am in an online game
  size: 5,
  me: 'You',
  them: 'Opponent',
  game: null,
  connected: false,
  rematchPending: false,
};

const view = new CubeView($('stage'));
const net = new Net();

// ------------------------------------------------------------------ storage

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch { /* storage disabled; preferences just will not persist */ }
  },
};

// -------------------------------------------------------------------- themes

function setTheme(id) {
  const theme = themeById(id);
  applyThemeToDocument(theme);
  view.setTheme(theme);
  store.set('cube5.theme', theme.id);
  for (const btn of $('theme-buttons').children) {
    btn.classList.toggle('on', btn.dataset.theme === theme.id);
  }
}

function buildThemeButtons() {
  const host = $('theme-buttons');
  host.innerHTML = '';
  for (const theme of THEMES) {
    const btn = document.createElement('button');
    btn.textContent = theme.name;
    btn.title = theme.tagline;
    btn.dataset.theme = theme.id;
    btn.addEventListener('click', () => setTheme(theme.id));
    host.appendChild(btn);
  }
}

// -------------------------------------------------------------- game modes

function setModeChoice(id) {
  const choice = id === RANDOM_MODE.id ? RANDOM_MODE : modeById(id);
  state.modeChoice = choice.id;
  $('mode-note').textContent = choice.blurb;
  for (const btn of $('mode-buttons').children) {
    btn.classList.toggle('on', btn.dataset.mode === choice.id);
  }
  store.set('cube5.modeChoice', choice.id);
  if (choice === RANDOM_MODE) {
    $('help-mode').textContent = `${choice.name} — ${choice.blurb}`;
    $('help-mode-rules').innerHTML = '';
  } else {
    showModeRules(choice.id);
  }
}

function buildModeButtons() {
  const host = $('mode-buttons');
  host.innerHTML = '';
  for (const choice of [...MODES, RANDOM_MODE]) {
    const btn = document.createElement('button');
    btn.textContent = choice.name;
    btn.title = choice.blurb;
    btn.dataset.mode = choice.id;
    btn.addEventListener('click', () => setModeChoice(choice.id));
    host.appendChild(btn);
  }
}

/** Fill the help card with the rules of whichever mode is in play. */
function showModeRules(id) {
  const mode = modeById(id);
  $('help-mode').textContent = `${mode.name} — ${mode.blurb}`;
  const list = $('help-mode-rules');
  list.innerHTML = '';
  for (const rule of mode.rules) {
    const li = document.createElement('li');
    li.textContent = rule;
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------- difficulty

function setDifficulty(id) {
  const level = difficultyById(id);
  state.difficulty = level.id;
  $('difficulty-note').textContent = level.blurb;
  for (const btn of $('difficulty-buttons').children) {
    btn.classList.toggle('on', btn.dataset.level === level.id);
  }
  store.set('cube5.difficulty', level.id);
}

function buildDifficultyButtons() {
  const host = $('difficulty-buttons');
  host.innerHTML = '';
  for (const level of DIFFICULTIES) {
    const btn = document.createElement('button');
    btn.textContent = level.name;
    btn.title = level.blurb;
    btn.dataset.level = level.id;
    btn.addEventListener('click', () => setDifficulty(level.id));
    host.appendChild(btn);
  }
}

// ------------------------------------------------------------ the computer

let aiTimer = null;
let aiToken = 0;

function cancelAi() {
  clearTimeout(aiTimer);
  aiTimer = null;
  aiToken++;
}

/**
 * Hand the turn to the computer if it is its move. The pause is deliberate:
 * the search itself takes a few milliseconds and an instant reply reads as a
 * glitch rather than a move.
 */
function maybeAiMove() {
  if (state.mode !== 'ai') return;
  const game = state.game;
  if (!game || game.over || game.turn === state.seat) return;

  const token = ++aiToken;
  const level = state.difficulty;
  const line = $('turn-line');
  line.textContent = `${state.them} is thinking…`;
  line.classList.remove('active');
  view.setInteractive(false);

  aiTimer = setTimeout(() => {
    if (token !== aiToken || state.mode !== 'ai' || state.game !== game || game.over) return;
    const move = chooseMove(game, game.turn, level);
    if (move) commitMove(move, { remote: true });
    else syncHud();
  }, 340 + Math.random() * 280);
}

// ------------------------------------------------------------- twist panel

const twistDraft = { axis: 0, layer: 0, dir: 1 };

function segment(host, items, get, set) {
  host.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      set(item.value);
      paintTwistPanel();
      view.setHighlight({ axis: twistDraft.axis, layer: twistDraft.layer });
    });
    btn.dataset.value = String(item.value);
    host.appendChild(btn);
  }
  host.dataset.get = '';
  host._get = get;
}

function paintTwistPanel() {
  for (const host of [$('twist-axis'), $('twist-layer'), $('twist-dir')]) {
    const current = String(host._get());
    for (const btn of host.children) btn.classList.toggle('on', btn.dataset.value === current);
  }
}

function buildTwistPanel() {
  segment($('twist-axis'), [
    { label: 'X', value: 0 }, { label: 'Y', value: 1 }, { label: 'Z', value: 2 },
  ], () => twistDraft.axis, (v) => { twistDraft.axis = v; });
  const layers = [];
  for (let i = 0; i < state.size; i++) layers.push({ label: String(i + 1), value: i });
  segment($('twist-layer'), layers, () => twistDraft.layer, (v) => { twistDraft.layer = v; });
  segment($('twist-dir'), [
    { label: '\u21bb', value: 1 }, { label: '\u21ba', value: -1 },
  ], () => twistDraft.dir, (v) => { twistDraft.dir = v; });
  if (twistDraft.layer >= state.size) twistDraft.layer = 0;
  paintTwistPanel();
}

function openTwistPanel() {
  const g = state.game;
  if (!g || g.over || !g.canTwist(g.turn)) return;
  buildTwistPanel();
  $('twist-panel').classList.remove('hidden');
  view.setHighlight({ axis: twistDraft.axis, layer: twistDraft.layer });
}

function closeTwistPanel() {
  $('twist-panel').classList.add('hidden');
  view.setHighlight(null);
}

// -------------------------------------------------------------------- screens

function show(screen) {
  state.screen = screen;
  $('screen-title').classList.toggle('hidden', screen !== 'title');
  $('screen-browse').classList.toggle('hidden', screen !== 'browse');
  $('screen-wait').classList.toggle('hidden', screen !== 'wait');
  $('hud').classList.toggle('hidden', screen !== 'game');
  if (screen !== 'game') closeTwistPanel();
  if (screen !== 'game') $('result').classList.add('hidden');
  view.autoRotate = screen !== 'game';
  view.setInteractive(false);
  view.setShowcase(screen !== 'game');
  view.setPanelBias(screen !== 'game');
  if (screen === 'title') showcase();
}

let toastTimer = null;
function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ------------------------------------------------------------------ showcase

/** A decorative, unplayable board behind the menus. */
function showcase() {
  const demo = new Game(state.size);
  let seed = 1337 + state.size * 17;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let id = 0; id < demo.cells.length; id++) {
    const r = rand();
    if (r < 0.13) demo.cells[id] = P1;
    else if (r < 0.26) demo.cells[id] = P2;
  }
  state.game = null;
  view.setGame(demo);
}

// ---------------------------------------------------------------- board size

function setSize(n) {
  state.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
  $('size-value').textContent = state.size;
  $('size-note').textContent = `${state.size}×${state.size} per face · ${6 * state.size * state.size} tiles`;
  $('size-down').disabled = state.size <= MIN_SIZE;
  $('size-up').disabled = state.size >= MAX_SIZE;
  store.set('cube5.size', state.size);
  if (state.screen === 'title') showcase();
}

// ----------------------------------------------------------------- game flow

function startGame({ size, first, mode, seat, isHost, rules }) {
  cancelAi();
  state.mode = mode;
  state.seat = seat;
  state.isHost = isHost;
  state.size = size;
  state.rematchPending = false;
  state.rules = rules || resolveMode(state.modeChoice);
  state.game = new Game(size, { first, mode: state.rules });
  $('mode-chip').textContent = modeById(state.rules).name;
  showModeRules(state.rules);
  if (mode === 'ai') state.them = `Computer · ${difficultyById(state.difficulty).name}`;
  view.setGame(state.game);
  $('result').classList.add('hidden');
  show('game');
  syncHud();
  maybeAiMove();
}

function syncHud() {
  const g = state.game;
  if (!g) return;

  const leftSeat = state.mode === 'hotseat' ? P1 : state.seat;
  $('dot-me').style.color = leftSeat === P1 ? 'var(--p1)' : 'var(--p2)';
  $('dot-them').style.color = leftSeat === P1 ? 'var(--p2)' : 'var(--p1)';

  if (state.mode === 'hotseat') {
    $('name-me').textContent = 'Player 1';
    $('name-them').textContent = 'Player 2';
  } else {
    $('name-me').textContent = state.me;
    $('name-them').textContent = state.them;
  }

  const myTurn = state.mode === 'hotseat' || g.turn === state.seat;
  const line = $('turn-line');
  if (g.over) {
    line.textContent = g.winner === -1 ? 'Draw' : 'Game over';
    line.classList.remove('active');
  } else {
    line.textContent = state.mode === 'hotseat'
      ? `${g.turn === P1 ? 'Player 1' : 'Player 2'} to move`
      : (myTurn ? 'Your turn' : `Waiting for ${state.them}`);
    line.classList.toggle('active', myTurn);
  }

  $('btn-resign').disabled = g.over;

  const seat = state.mode === 'hotseat' ? g.turn : state.seat;
  const twistBtn = $('btn-twist');
  twistBtn.classList.toggle('hidden', g.mode !== 'torque');
  twistBtn.textContent = `Twist a layer (${g.twists[seat]})`;
  twistBtn.disabled = g.over || !myTurn || g.twists[seat] <= 0;
  if (twistBtn.disabled) closeTwistPanel();

  view.setInteractive(!g.over && myTurn && !view.busy, (id) => g.legal(id));
}

/** Apply a move that has already been validated, from either side. */
function commitMove(move, { remote }) {
  const g = state.game;
  if (!g || !move) return false;

  if (move.t === 'twist') {
    const mover = g.turn;
    if (!g.twist(move.axis, move.layer, move.dir)) return false;
    closeTwistPanel();
    view.setInteractive(false);
    toast(`${mover === state.seat || state.mode === 'hotseat' ? 'Layer twisted' : `${state.them} twisted a layer`}`);
    // Everything else waits for the quarter turn to finish playing out.
    view.startTwist(move, () => {
      view.refresh();
      syncHud();
      if (g.over) announceResult();
      else maybeAiMove();
    });
    return true;
  }

  if (!g.play(move.id)) return false;
  view.popCell(move.id);
  view.refresh();
  if (g.lastSweep && g.lastSweep.length) {
    view.flashCells(g.lastSweep);
    toast(`Swept ${g.lastSweep.length} stone${g.lastSweep.length === 1 ? '' : 's'} off the cube`);
  }
  if (remote && view.cellVisibility(move.id) < 0.3) view.focusCell(move.id);
  syncHud();
  if (g.over) announceResult();
  else maybeAiMove();
  return true;
}

/** A move made by whoever is sitting at this screen. */
function submitMove(move) {
  const g = state.game;
  if (!g || g.over || view.busy) return;
  const mover = g.turn;
  if (state.mode !== 'hotseat' && mover !== state.seat) return;
  const n = g.moves.length;
  if (!commitMove(move, { remote: false })) return;
  if (state.mode === 'online') net.send('move', { move, n });
}

function announceResult() {
  const g = state.game;
  const overlay = $('result');
  const title = $('result-title');
  const body = $('result-body');

  if (g.winner === -1) {
    title.textContent = 'Draw';
    body.textContent = 'Every tile is claimed and nobody reached five.';
  } else if (state.mode === 'hotseat') {
    title.textContent = `${g.winner === P1 ? 'Player 1' : 'Player 2'} wins`;
    body.textContent = describeLine(g);
  } else if (g.winner === state.seat) {
    title.textContent = 'You won';
    body.textContent = describeLine(g);
  } else {
    title.textContent = 'You lost';
    body.textContent = describeLine(g);
  }

  $('btn-rematch').textContent = 'Rematch';
  $('btn-rematch').disabled = false;
  overlay.classList.remove('hidden');
  // Swing the camera onto the winning line and shove the board clear of the
  // card, so the player can actually see how it ended.
  view.setPanelBias(true);
  if (g.winningLine) view.focusCell(g.winningLine[Math.floor(g.winningLine.length / 2)], 0.75, 1.16);
}

function describeLine(g) {
  if (!g.winningLine) {
    if (g.mode === 'encircle' && g.winner > 0 && g.swept[g.winner] > 0) {
      return `Swept the last stone off the cube — ${g.swept[g.winner]} in all.`;
    }
    return 'The game was resigned.';
  }
  const faces = new Set(g.winningLine.map((id) => g.topo.decode(id).f)).size;
  const run = g.winningLine.length;
  return faces > 1
    ? `${run} in a row, wrapping across ${faces} faces.`
    : `${run} in a row on a single face.`;
}

function leaveGame() {
  cancelAi();
  if (state.mode === 'online') {
    net.send('bye');
    net.leave();
  }
  state.mode = null;
  state.connected = false;
  state.game = null;
  state.them = 'Opponent';
  show('title');
}

// -------------------------------------------------------------- online setup

function hostFirstPlayer() {
  return Math.random() < 0.5 ? P1 : P2;
}

async function doHost() {
  try {
    const { lobbyId } = await net.host(state.size);
    $('wait-lobby').textContent = lobbyId;
    state.isHost = true;
    show('wait');
  } catch (err) {
    toast(`Could not create a lobby: ${err.message}`, 4000);
  }
}

async function doBrowse() {
  show('browse');
  await refreshLobbies();
}

async function refreshLobbies() {
  const list = $('lobby-list');
  list.innerHTML = '<p class="hint">Searching…</p>';
  try {
    const lobbies = await net.list();
    if (!lobbies.length) {
      list.innerHTML = '<p class="hint">No open Cube⁵ lobbies found.</p>';
      return;
    }
    list.innerHTML = '';
    for (const lobby of lobbies) {
      const row = document.createElement('div');
      row.className = 'lobby';
      const who = document.createElement('div');
      who.innerHTML = `<div class="who"></div><div class="meta">${lobby.size}×${lobby.size} cube</div>`;
      who.querySelector('.who').textContent = lobby.host;
      const join = document.createElement('button');
      join.textContent = 'Join';
      join.addEventListener('click', () => doJoin(lobby.id));
      row.append(who, join);
      list.appendChild(row);
    }
  } catch (err) {
    list.innerHTML = '<p class="hint"></p>';
    list.querySelector('.hint').textContent = `Lobby search failed: ${err.message}`;
  }
}

async function doJoin(id) {
  try {
    const info = await net.join(id);
    state.isHost = false;
    state.them = info.host;
    state.size = info.size;
    toast(`Joined ${info.host}'s cube — waiting for the first move…`);
    net.send('hello', { name: state.me });
    show('wait');
    $('wait-lobby').textContent = String(id);
  } catch (err) {
    toast(`Could not join: ${err.message}`, 4000);
  }
}

// ---------------------------------------------------------- protocol handling

net.on('event', (ev) => {
  if (ev.type === 'peer-joined') {
    state.connected = true;
    net.send('hello', { name: state.me });
    if (state.isHost) {
      const first = hostFirstPlayer();
      const rules = resolveMode(state.modeChoice);
      net.send('start', { size: state.size, first, rules });
      startGame({ size: state.size, first, rules, mode: 'online', seat: P1, isHost: true });
      toast('Opponent connected');
    }
  } else if (ev.type === 'peer-lost') {
    state.connected = false;
    if (state.screen === 'game' && state.game && !state.game.over) {
      toast(`Opponent disconnected — ${ev.reason}`, 5000);
      $('result-title').textContent = 'Opponent left';
      $('result-body').textContent = ev.reason;
      $('btn-rematch').disabled = true;
      $('result').classList.remove('hidden');
      view.setInteractive(false);
    } else if (state.screen === 'wait') {
      toast(ev.reason, 4000);
    }
  } else if (ev.type === 'invited-join') {
    state.isHost = false;
    net.send('hello', { name: state.me });
    show('wait');
    $('wait-lobby').textContent = ev.lobbyId;
    toast('Joining game from Steam invite…');
  } else if (ev.type === 'error') {
    toast(ev.reason, 4000);
  }
});

net.on('message', (msg) => {
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'hello':
      state.connected = true;
      if (msg.name) state.them = msg.name;
      syncHud();
      break;

    case 'start':
      // Only the host issues `start`; the guest always plays second seat.
      if (state.isHost) break;
      startGame({ size: msg.size, first: msg.first, rules: msg.rules, mode: 'online', seat: P2, isHost: false });
      toast(`${modeById(msg.rules).name} — ${msg.first === P2 ? 'you move first' : `${state.them} moves first`}`);
      break;

    case 'move': {
      const g = state.game;
      if (!g || g.over) break;
      if (g.turn === state.seat) break;             // not their turn to move
      if (typeof msg.n === 'number' && msg.n !== g.moves.length) {
        toast('Move out of sequence — ignoring', 3000);
        break;
      }
      if (!commitMove(msg.move, { remote: true })) toast('Opponent sent an illegal move', 3000);
      break;
    }

    case 'resign': {
      const g = state.game;
      if (!g || g.over) break;
      g.resign(state.seat === P1 ? P2 : P1);
      view.refresh();
      syncHud();
      announceResult();
      $('result-title').textContent = 'You won';
      $('result-body').textContent = `${state.them} resigned.`;
      break;
    }

    case 'rematch':
      if (state.isHost) {
        const first = state.game ? (state.game.first === P1 ? P2 : P1) : P1;
        const rules = resolveMode(state.modeChoice);
        net.send('start', { size: state.size, first, rules });
        startGame({ size: state.size, first, rules, mode: 'online', seat: P1, isHost: true });
        toast(`Rematch — ${modeById(rules).name}, the first move swaps`);
      } else {
        toast(`${state.them} wants a rematch`);
      }
      break;

    case 'bye':
      state.connected = false;
      toast(`${state.them} left the game`, 4000);
      if (state.screen === 'game') {
        $('result-title').textContent = 'Opponent left';
        $('result-body').textContent = 'They closed the game.';
        $('btn-rematch').disabled = true;
        $('result').classList.remove('hidden');
      }
      break;

    default:
      break;
  }
});

// ------------------------------------------------------------------- wiring

view.onPick((id) => submitMove({ t: 'place', id }));

$('btn-twist').addEventListener('click', () => {
  if ($('twist-panel').classList.contains('hidden')) openTwistPanel();
  else closeTwistPanel();
});
$('twist-cancel').addEventListener('click', closeTwistPanel);
$('twist-go').addEventListener('click', () => {
  submitMove({ t: 'twist', axis: twistDraft.axis, layer: twistDraft.layer, dir: twistDraft.dir });
});

$('btn-ai').addEventListener('click', () => {
  startGame({ size: state.size, first: P1, mode: 'ai', seat: P1, isHost: true });
});
$('btn-host').addEventListener('click', doHost);
$('btn-browse').addEventListener('click', doBrowse);
$('btn-local').addEventListener('click', () => {
  startGame({ size: state.size, first: P1, mode: 'hotseat', seat: P1, isHost: true });
});
$('btn-quit').addEventListener('click', () => net.quit());

$('size-down').addEventListener('click', () => setSize(state.size - 1));
$('size-up').addEventListener('click', () => setSize(state.size + 1));

$('btn-refresh').addEventListener('click', refreshLobbies);
$('btn-browse-back').addEventListener('click', () => show('title'));
$('btn-join-id').addEventListener('click', () => {
  const id = $('lobby-id').value.trim();
  if (id) doJoin(id);
});
$('lobby-id').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') $('btn-join-id').click();
});

$('btn-invite').addEventListener('click', async () => {
  const ok = await net.invite();
  if (!ok) toast('The Steam overlay is not available', 3500);
});
$('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('wait-lobby').textContent);
    toast('Lobby ID copied');
  } catch {
    toast('Could not reach the clipboard', 3000);
  }
});
$('btn-cancel-host').addEventListener('click', () => {
  net.leave();
  show('title');
});

$('btn-view').addEventListener('click', () => view.resetView());
$('btn-last').addEventListener('click', () => {
  if (state.game && state.game.lastMove >= 0) view.focusCell(state.game.lastMove);
});
$('btn-resign').addEventListener('click', () => {
  const g = state.game;
  if (!g || g.over) return;
  const me = state.mode === 'hotseat' ? g.turn : state.seat;
  g.resign(me);
  if (state.mode === 'online') net.send('resign');
  view.refresh();
  syncHud();
  announceResult();
  $('result-title').textContent = state.mode === 'hotseat'
    ? `${g.winner === P1 ? 'Player 1' : 'Player 2'} wins`
    : 'You resigned';
  $('result-body').textContent = 'Resigned.';
});
$('btn-leave').addEventListener('click', leaveGame);
$('btn-result-leave').addEventListener('click', leaveGame);

$('btn-rematch').addEventListener('click', () => {
  if (state.mode === 'ai') {
    // Whoever moved first last time moves second now.
    const first = state.game.first === P1 ? P2 : P1;
    startGame({ size: state.size, first, mode: 'ai', seat: P1, isHost: true });
    return;
  }
  if (state.mode === 'hotseat') {
    const first = state.game.first === P1 ? P2 : P1;
    startGame({ size: state.size, first, mode: 'hotseat', seat: P1, isHost: true });
    return;
  }
  if (state.isHost) {
    const first = state.game.first === P1 ? P2 : P1;
    const rules = resolveMode(state.modeChoice);
    net.send('start', { size: state.size, first, rules });
    startGame({ size: state.size, first, rules, mode: 'online', seat: P1, isHost: true });
  } else {
    net.send('rematch');
    $('btn-rematch').disabled = true;
    toast('Rematch requested…');
  }
});

$('btn-help').addEventListener('click', () => $('help').classList.remove('hidden'));
$('btn-help-close').addEventListener('click', () => $('help').classList.add('hidden'));

window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if (ev.key === 'Escape') {
    $('help').classList.add('hidden');
  } else if (ev.key === 'r' && state.screen === 'game') {
    view.resetView();
  } else if (ev.key === 'l' && state.game && state.game.lastMove >= 0) {
    view.focusCell(state.game.lastMove);
  }
});

// -------------------------------------------------------------------- boot

async function boot() {
  buildThemeButtons();
  buildDifficultyButtons();
  buildModeButtons();
  setTheme(store.get('cube5.theme', DEFAULT_THEME));
  setDifficulty(store.get('cube5.difficulty', DEFAULT_DIFFICULTY));
  setModeChoice(store.get('cube5.modeChoice', DEFAULT_MODE));
  setSize(Number(store.get('cube5.size', 5)) || 5);
  show('title');

  const status = await net.refreshStatus();
  const line = $('steam-line');
  if (status.ok) {
    state.me = status.name || 'You';
    line.textContent = `Steam: signed in as ${state.me} (App ID ${status.appId})`;
    line.classList.remove('bad');
  } else {
    line.textContent = `Steam unavailable — ${status.error}. Online play is disabled; the computer opponent and two players on one screen still work.`;
    line.classList.add('bad');
    $('btn-host').disabled = true;
    $('btn-browse').disabled = true;
  }
}

boot();
