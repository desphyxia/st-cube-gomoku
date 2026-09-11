/**
 * The computer opponent.
 *
 * Three layers, deliberately separated:
 *
 *   Tactics    forced play - take a win, stop theirs, refuse a twist that
 *              hands the game away. Correct by construction, never learned,
 *              never tuned.
 *   Position   everything else, scored by the weights in weights.js. Those
 *              are fitted by self-play rather than picked by hand.
 *   Handicap   difficulty is one policy degraded, not three policies. Hard is
 *              the strong play; Medium loses the reply search and plays
 *              loosely; Easy also misses blocks and wanders. Ordering is
 *              structural, so adding a mode cannot invert it.
 *
 * Scoring slides a five-window along each of the four line axes through a cell
 * and counts the windows still *live* - free of opponent stones and of the
 * walls where a diagonal dies at a cube corner. Counting live windows rather
 * than matching literal patterns handles gapped shapes and lines that roll
 * over a face edge without a special case.
 */
import { EMPTY, P1, P2, WIN_LENGTH, other } from './game.js';
import { weightsFor, SEARCH } from './weights.js';

const REACH = WIN_LENGTH - 1;
const SPAN = REACH * 2 + 1;
const WIN_SCORE = 1e6;

export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', blurb: 'Sees threats but often looks away.' },
  { id: 'medium', name: 'Medium', blurb: 'Always takes a win and blocks yours.' },
  { id: 'hard', name: 'Hard', blurb: 'Hunts forks and checks your reply.' },
];

export const DEFAULT_DIFFICULTY = 'medium';

export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
}

/**
 * Difficulty is subtraction. Every level runs the same policy; these say how
 * much of it each one is allowed to keep.
 */
const HANDICAP = {
  hard: { blockMiss: 0, noise: 0, topK: 1, radius: 2, reply: true, tactics: 'full', twists: true },
  medium: { blockMiss: 0, noise: 0.06, topK: 4, radius: 2, reply: false, tactics: 'full', twists: true },
  easy: { blockMiss: 0.45, noise: 0.4, topK: 7, radius: 1, reply: false, tactics: 'basic', twists: false },
};

// ------------------------------------------------------------------ scoring

/**
 * What placing `player` on `id` would be worth.
 *   win    - completes five
 *   fours  - ways to complete five next move; two or more cannot all be
 *            blocked, so that is a won position
 *   threes - axes carrying a three with room to grow both ways
 */
export function evaluateCell(game, id, player, weights = weightsFor(game.mode)) {
  const opp = other(player);
  const windows = game.topo.lineWindows;
  const cells = game.cells;
  const w = [0, weights.w1, weights.w2, weights.w3, weights.w4, WIN_SCORE];

  let score = 0;
  let win = false;
  let fours = 0;
  let threes = 0;

  for (let a = 0; a < 4; a++) {
    const base = (id * 4 + a) * SPAN;
    let three = 0;
    for (let s = 0; s <= REACH; s++) {
      let mine = 1;                       // the cell itself, once placed
      let live = true;
      for (let i = s; i < s + WIN_LENGTH; i++) {
        if (i === REACH) continue;        // centre, already counted
        const cell = windows[base + i];
        if (cell < 0) { live = false; break; }
        const v = cells[cell];
        if (v === opp) { live = false; break; }
        if (v === player) mine++;
      }
      if (!live) continue;
      score += w[mine];
      if (mine === WIN_LENGTH) win = true;
      else if (mine === 4) fours++;
      else if (mine === 3) three++;
    }
    if (three >= 2) threes++;
  }
  return { score, win, fours, threes };
}

/**
 * To close a loop a stone has to join two parts of the fence, so it needs at
 * least two friendly neighbours. Cheap way to skip the region scan on almost
 * every candidate.
 */
function couldClose(game, id, player) {
  const nbrs = game.topo.neighbours;
  let friends = 0;
  for (let k = 0; k < 8; k++) {
    const nb = nbrs[id * 8 + k];
    if (nb >= 0 && game.cells[nb] === player && ++friends >= 2) return true;
  }
  return false;
}

/** How much a cell builds toward a fence: our stones meeting theirs. */
function fenceValue(game, id, player, opp) {
  const nbrs = game.topo.neighbours;
  let contact = 0;
  let support = 0;
  for (let k = 0; k < 8; k++) {
    const nb = nbrs[id * 8 + k];
    if (nb < 0) continue;
    if (game.cells[nb] === opp) contact++;
    else if (game.cells[nb] === player) support++;
  }
  return contact * support;
}

// --------------------------------------------------------------- candidates

/** Empty cells within `radius` steps of a stone - where play actually is. */
function candidates(game, radius) {
  const nbrs = game.topo.neighbours;
  const out = new Set();
  let frontier = [];
  let occupied = false;

  for (let id = 0; id < game.cells.length; id++) {
    if (game.cells[id] !== EMPTY) { occupied = true; frontier.push(id); }
  }
  for (let r = 0; r < radius; r++) {
    const next = [];
    for (const id of frontier) {
      for (let k = 0; k < 8; k++) {
        const nb = nbrs[id * 8 + k];
        if (nb < 0) continue;
        if (game.cells[nb] === EMPTY && !out.has(nb)) { out.add(nb); next.push(nb); }
      }
    }
    frontier = next;
  }

  if (!occupied) return null;              // opening move; handled separately
  if (out.size === 0) {                    // stones everywhere, take what is left
    for (let id = 0; id < game.cells.length; id++) {
      if (game.cells[id] === EMPTY) out.add(id);
    }
  }
  return [...out];
}

/**
 * Opening move: the middle of a face. Cells beside a cube corner are worth
 * less, because diagonals through them die at the corner.
 */
function openingMove(game, rng) {
  const n = game.size;
  const mid = (n - 1) / 2;
  const face = Math.floor(rng() * 6);
  const r = Math.round(mid - 0.5 + rng());
  const c = Math.round(mid - 0.5 + rng());
  return game.topo.id(face, Math.min(n - 1, Math.max(0, r)), Math.min(n - 1, Math.max(0, c)));
}

/** Every candidate scored for both sides, best first. */
function rank(game, player, radius, W) {
  const opp = other(player);
  const cells = candidates(game, radius);
  if (!cells) return null;
  const sweeping = game.mode === 'encircle';
  const enemyStones = sweeping ? game.stoneCount(opp) : 0;

  const ranked = cells.map((id) => {
    const mine = evaluateCell(game, id, player, W);
    const theirs = evaluateCell(game, id, opp, W);
    let value = mine.score + W.defence * theirs.score;
    let sweeps = 0;
    let sweepWin = false;
    if (sweeping) {
      if (couldClose(game, id, player)) {
        sweeps = game.wouldSweep(id, player).length;
        value += sweeps * W.sweep;
        sweepWin = enemyStones > 0 && sweeps >= enemyStones;
      }
      if (W.deny > 0 && couldClose(game, id, opp)) {
        value += W.deny * W.defence * game.wouldSweep(id, opp).length * W.sweep;
      }
      if (W.fence > 0) value += fenceValue(game, id, player, opp) * W.fence;
    }
    return { id, mine, theirs, sweeps, sweepWin, value, own: mine.score + sweeps * W.sweep };
  });
  ranked.sort((a, b) => b.value - a.value);
  return ranked;
}

// -------------------------------------------------------------------- torque

/** The board as it would be after a twist, without disturbing the real one. */
function twistedCells(game, move) {
  const perm = game.topo.twistPermutation(move.axis, move.layer, move.dir);
  const next = new Int8Array(game.cells.length);
  for (let id = 0; id < game.cells.length; id++) next[perm[id]] = game.cells[id];
  return next;
}

function withCells(game, cells, fn) {
  const saved = game.cells;
  game.cells = cells;
  try {
    return fn();
  } finally {
    game.cells = saved;
  }
}

/** Twists worth thinking about: only layers that actually hold stones. */
function twistOptions(game) {
  const out = [];
  for (let axis = 0; axis < 3; axis++) {
    for (let layer = 0; layer < game.size; layer++) {
      const cells = game.topo.twistLayer(axis, layer);
      if (!cells.some((id) => game.cells[id] !== EMPTY)) continue;
      out.push({ t: 'twist', axis, layer, dir: 1 });
      out.push({ t: 'twist', axis, layer, dir: -1 });
    }
  }
  return out;
}

/** Who would be holding five after this twist. */
function twistOutcome(game, player, move) {
  const cells = twistedCells(game, move);
  const lines = withCells(game, cells, () => ({
    mine: !!game.findAnyLine(player),
    theirs: !!game.findAnyLine(other(player)),
  }));
  return { ...lines, cells };
}

/** Could `player` win outright with a twist right now? */
function twistWinAvailable(game, player) {
  if (game.twists[player] <= 0) return false;
  for (const move of twistOptions(game)) {
    const outcome = twistOutcome(game, player, move);
    if (outcome.mine && !outcome.theirs) return true;
  }
  return false;
}

/**
 * What to do with a twist, if anything. Twists are scarce and a careless one
 * loses on the spot, so the bar is high: finish our own line, or break up a
 * threat no stone can answer.
 */
function twistPlan(game, player, ranked, W, rng) {
  const opp = other(player);
  const options = twistOptions(game);
  if (!options.length) return null;

  const safe = [];
  for (const move of options) {
    const outcome = twistOutcome(game, player, move);
    if (outcome.mine && !outcome.theirs) return { move, urgency: 'win' };
    if (!outcome.mine && !outcome.theirs) safe.push({ move, cells: outcome.cells });
  }
  if (!safe.length) return null;

  // Two kinds of trouble a stone cannot answer: two separate cells that each
  // complete five, or an opponent holding a twist that wins on the spot.
  const theirTwistWin = game.twists[opp] > 0 && twistWinAvailable(game, opp);
  const doomed = theirTwistWin || ranked.filter((m) => m.theirs.win).length >= 2;
  if (!doomed) return { move: safe[Math.floor(rng() * safe.length)].move, urgency: 'idle' };

  let best = null;
  for (const option of safe.slice(0, theirTwistWin ? 8 : 14)) {
    const { theirs, mine, stillLost } = withCells(game, option.cells, () => ({
      theirs: rank(game, opp, 2, W),
      mine: rank(game, player, 2, W),
      stillLost: theirTwistWin && twistWinAvailable(game, opp),
    }));
    // Judge the twist by the position it leaves us, not only by what it takes
    // from them - a twist wrecks our own shape as readily as theirs.
    const value = (mine && mine.length ? mine[0].value : 0)
      - (theirs && theirs.length ? theirs[0].value : 0)
      - (stillLost ? 2e6 : 0);
    if (!best || value > best.value) best = { move: option.move, value };
  }
  return best ? { move: best.move, urgency: 'escape' } : null;
}

// -------------------------------------------------------------------- choice

const place = (id) => ({ t: 'place', id });
const pick = (list, rng) => place(list[Math.floor(rng() * list.length)].id);

/**
 * Hard's search. Negamax with alpha-beta over placements, ordered by the
 * static score so the cut-offs bite early. Stones are written into the board
 * and taken out again; sweeps are not replayed inside the search, so in
 * Encirclement the leaf value is an approximation of the position rather than
 * the position itself.
 *
 * This replaces an earlier hand-rolled "subtract the best reply" penalty,
 * which measured worse than no search at all in all three modes.
 */
function negamax(game, player, depth, alpha, beta, W, width) {
  const ranked = rank(game, player, 2, W);
  if (!ranked || !ranked.length) return 0;
  if (ranked[0].mine.win || ranked[0].sweepWin) return WIN_SCORE * (depth + 1);
  if (depth === 0) {
    const theirs = rank(game, other(player), 2, W);
    return ranked[0].own - (theirs && theirs.length ? theirs[0].own : 0);
  }
  let best = -Infinity;
  for (const move of ranked.slice(0, width)) {
    game.cells[move.id] = player;
    const value = -negamax(game, other(player), depth - 1, -beta, -alpha, W, width);
    game.cells[move.id] = EMPTY;
    if (value > best) best = value;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return best;
}

function searchMove(game, player, ranked, W, depth, width) {
  const opp = other(player);
  let best = null;
  for (const move of ranked.slice(0, width)) {
    game.cells[move.id] = player;
    const value = -negamax(game, opp, depth - 1, -Infinity, Infinity, W, width);
    game.cells[move.id] = EMPTY;
    if (!best || value > best.value) best = { id: move.id, value };
  }
  return place(best ? best.id : ranked[0].id);
}

/**
 * The move `player` should make, as { t: 'place', id } or
 * { t: 'twist', axis, layer, dir }. `rng` is injectable so games replay, and
 * `weights` so the trainer can pit two weight sets against each other.
 */
export function chooseMove(game, player, difficulty = DEFAULT_DIFFICULTY, rng = Math.random, weights) {
  if (game.over) return null;
  const level = difficultyById(difficulty).id;
  const H = HANDICAP[level];
  const W = weights || weightsFor(game.mode);
  const opp = other(player);

  const ranked = rank(game, player, H.radius, W);
  if (!ranked) return place(openingMove(game, rng));

  // --- tactics: forced, never learned ------------------------------------
  const winning = ranked.filter((m) => m.mine.win || m.sweepWin);
  if (winning.length) return pick(winning, rng);

  const canTwist = H.twists && game.canTwist(player);
  const twist = canTwist ? twistPlan(game, player, ranked, W, rng) : null;
  if (twist && twist.urgency === 'win') return twist.move;
  if (twist && twist.urgency === 'escape') return twist.move;

  if (ranked.length === 1) return place(ranked[0].id);

  const losing = ranked.filter((m) => m.theirs.win || m.theirs.sweepWin);
  if (losing.length && rng() >= H.blockMiss) return pick(losing, rng);

  if (H.tactics === 'full') {
    const forcing = ranked.filter((m) => m.mine.fours >= 2);
    if (forcing.length) return pick(forcing, rng);
    const blocking = ranked.filter((m) => m.theirs.fours >= 2);
    if (blocking.length) return pick(blocking, rng);
    const harvest = ranked.filter((m) => m.sweeps >= 2);
    if (harvest.length) return place(harvest[0].id);
  }

  // --- position: learned --------------------------------------------------
  if (H.reply && SEARCH[game.mode].depth > 0) {
    const { depth, width } = SEARCH[game.mode];
    return searchMove(game, player, ranked, W, depth, width);
  }

  const scored = H.noise > 0
    ? ranked.map((m) => ({ id: m.id, value: m.value * (1 + H.noise * (rng() * 2 - 1)) }))
      .sort((a, b) => b.value - a.value)
    : ranked;
  const cut = scored[0].value * 0.92;
  const close = scored.filter((m) => m.value >= cut).slice(0, H.topK);
  return pick(close.length ? close : scored.slice(0, 1), rng);
}
