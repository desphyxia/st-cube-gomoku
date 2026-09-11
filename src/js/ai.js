/**
 * Threat-based computer opponent.
 *
 * Every candidate cell is judged by sliding a five-window along each of the
 * four line axes through it and counting the windows that are still *live* —
 * free of opponent stones and of the walls where a diagonal dies at a cube
 * corner. A window holding four of my stones is one move from a win; holding
 * two of them it is a distant promise. Counting live windows rather than
 * matching literal patterns means gapped shapes (`oo.oo`) and lines that roll
 * over a face edge are handled without a special case.
 *
 * The same cell is then scored for the opponent, because a cell that is
 * valuable to them is worth denying. What separates the difficulties is how
 * much of that signal each one is allowed to act on.
 */
import { EMPTY, P1, P2, WIN_LENGTH } from './game.js';
import { neg } from './cube.js';

const WALL = -1;
const REACH = WIN_LENGTH - 1;
const SPAN = REACH * 2 + 1;

/** Worth of a live five-window already holding k of my stones. */
const WEIGHT = [0, 2, 26, 340, 7000, 1000000];

export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', blurb: 'Sees threats but often looks away.' },
  { id: 'medium', name: 'Medium', blurb: 'Always takes a win and blocks yours.' },
  { id: 'hard', name: 'Hard', blurb: 'Hunts forks and checks your reply.' },
];

export const DEFAULT_DIFFICULTY = 'medium';

export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
}

const other = (player) => (player === P1 ? P2 : P1);

// ------------------------------------------------------------------ scoring

/**
 * The run of cells centred on `id` along one axis, `REACH` each way.
 * Cells past a cube corner, and cells a short ring has already visited, read
 * as WALL so no window can count through them.
 */
function lineWindow(game, id, axis, player) {
  const topo = game.topo;
  const cells = new Array(SPAN).fill(WALL);
  cells[REACH] = player;
  const origin = topo.lattice(id);
  const seen = new Set([id]);

  for (const forward of [true, false]) {
    let p = origin;
    let d = forward ? axis : neg(axis);
    for (let i = 1; i <= REACH; i++) {
      const next = topo.step(p, d);
      if (!next) break;
      const nid = topo.fromLattice(next.p);
      if (seen.has(nid)) break;          // a short ring has closed on itself
      seen.add(nid);
      cells[forward ? REACH + i : REACH - i] = game.cells[nid];
      p = next.p;
      d = next.d;
    }
  }
  return cells;
}

/** counts[k] = live five-windows through the centre holding k of my stones. */
function windowCounts(line, player, opp) {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let s = 0; s <= REACH; s++) {
    let mine = 0;
    let live = true;
    for (let i = s; i < s + WIN_LENGTH; i++) {
      const v = line[i];
      if (v === opp || v === WALL) { live = false; break; }
      if (v === player) mine++;
    }
    if (live) counts[mine]++;
  }
  return counts;
}

/**
 * What placing `player` on `id` would be worth.
 *   win    - completes five
 *   fours  - ways to complete five next move; two or more cannot all be
 *            blocked, so that is a won position
 *   threes - axes carrying a three with room to grow both ways
 */
export function evaluateCell(game, id, player) {
  const opp = other(player);
  const { f } = game.topo.decode(id);
  let score = 0;
  let win = false;
  let fours = 0;
  let threes = 0;

  for (const axis of game.topo.lineDirections(f)) {
    const counts = windowCounts(lineWindow(game, id, axis, player), player, opp);
    for (let k = 1; k <= WIN_LENGTH; k++) score += counts[k] * WEIGHT[k];
    if (counts[WIN_LENGTH] > 0) win = true;
    fours += counts[4];
    if (counts[3] >= 2) threes++;
  }
  return { score, win, fours, threes };
}

// --------------------------------------------------------------- candidates

/** Empty cells within `radius` steps of a stone — where play actually is. */
function candidates(game, radius) {
  const topo = game.topo;
  const out = new Set();
  let occupied = false;

  for (let id = 0; id < game.cells.length; id++) {
    if (game.cells[id] === EMPTY) continue;
    occupied = true;
    const { f } = topo.decode(id);
    for (const dir of topo.allDirections(f)) {
      let p = topo.lattice(id);
      let d = dir;
      for (let r = 0; r < radius; r++) {
        const next = topo.step(p, d);
        if (!next) break;
        const nid = topo.fromLattice(next.p);
        if (game.cells[nid] === EMPTY) out.add(nid);
        p = next.p;
        d = next.d;
      }
    }
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
function rank(game, player, defence, radius) {
  const opp = other(player);
  const cells = candidates(game, radius);
  if (!cells) return null;
  const ranked = cells.map((id) => {
    const mine = evaluateCell(game, id, player);
    const theirs = evaluateCell(game, id, opp);
    return { id, mine, theirs, value: mine.score + defence * theirs.score };
  });
  ranked.sort((a, b) => b.value - a.value);
  return ranked;
}

// ------------------------------------------------------------------- choice

const pickFrom = (list, rng) => list[Math.floor(rng() * list.length)].id;

/**
 * Hard only: play out each of the leading moves and see what the best reply
 * is worth, so a move that hands back a bigger threat than it creates is
 * discounted. `game.cells` is mutated and restored in place.
 */
function lookahead(game, player, ranked, width, rng) {
  const opp = other(player);
  let best = null;
  for (const move of ranked.slice(0, width)) {
    game.cells[move.id] = player;
    const replies = rank(game, opp, 0.9, 2);
    game.cells[move.id] = EMPTY;
    const reply = replies && replies.length ? replies[0] : null;
    // A reply that wins outright makes this move unplayable unless forced.
    const penalty = reply ? (reply.mine.win ? 5000000 : reply.value * 0.9) : 0;
    const value = move.value - penalty + rng() * 8;
    if (!best || value > best.value) best = { id: move.id, value };
  }
  return best ? best.id : ranked[0].id;
}

/**
 * The move `player` should make. `difficulty` is an id from DIFFICULTIES;
 * `rng` is injectable so games can be replayed in tests.
 */
export function chooseMove(game, player, difficulty = DEFAULT_DIFFICULTY, rng = Math.random) {
  if (game.over) return -1;
  const level = difficultyById(difficulty).id;
  const opp = other(player);

  const radius = level === 'easy' ? 1 : 2;
  const defence = level === 'easy' ? 0.55 : level === 'medium' ? 0.85 : 1;
  const ranked = rank(game, player, defence, radius);
  if (!ranked) return openingMove(game, rng);
  if (ranked.length === 1) return ranked[0].id;

  // 1. Take a win, always. Nothing outranks it.
  const winning = ranked.filter((m) => m.mine.win);
  if (winning.length) return pickFrom(winning, rng);

  // 2. Block theirs. Easy only notices about half the time.
  const losing = ranked.filter((m) => m.theirs.win);
  if (losing.length && (level !== 'easy' || rng() < 0.55)) return pickFrom(losing, rng);

  if (level === 'easy') {
    // Wander: a third of the time anywhere nearby, otherwise loosely among
    // the better-looking moves.
    if (rng() < 0.32) return pickFrom(ranked, rng);
    return pickFrom(ranked.slice(0, Math.min(6, ranked.length)), rng);
  }

  // 3. Two ways to make five cannot both be blocked - make one, or stop one.
  const forcing = ranked.filter((m) => m.mine.fours >= 2);
  if (forcing.length) return pickFrom(forcing, rng);
  const blocking = ranked.filter((m) => m.theirs.fours >= 2);
  if (blocking.length) return pickFrom(blocking, rng);

  if (level === 'medium') {
    // Near-best, with enough slack that it does not play the same game twice.
    const cut = ranked[0].value * 0.92;
    const close = ranked.filter((m) => m.value >= cut);
    return pickFrom(close.slice(0, 4), rng);
  }

  // 4. Hard: forks first, then verify the leaders against the best reply.
  const forks = ranked.filter((m) => m.mine.threes >= 2 || m.mine.fours >= 1 && m.mine.threes >= 1);
  if (forks.length && forks[0].value >= ranked[0].value * 0.9) return forks[0].id;
  const counterForks = ranked.filter((m) => m.theirs.threes >= 2);
  if (counterForks.length && !ranked[0].mine.fours) return counterForks[0].id;

  return lookahead(game, player, ranked, 8, rng);
}
