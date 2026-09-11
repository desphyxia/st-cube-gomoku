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
import { EMPTY, P1, P2, WIN_LENGTH, other } from './game.js';
import { neg } from './cube.js';

const WALL = -1;
const REACH = WIN_LENGTH - 1;
const SPAN = REACH * 2 + 1;

/** Worth of a live five-window already holding k of my stones. */
const WEIGHT = [0, 2, 26, 340, 7000, 1000000];

/** Worth of sweeping one enemy stone off the board, in Encirclement. */
const SWEEP = 1500;


export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', blurb: 'Sees threats but often looks away.' },
  { id: 'medium', name: 'Medium', blurb: 'Always takes a win and blocks yours.' },
  { id: 'hard', name: 'Hard', blurb: 'Hunts forks and checks your reply.' },
];

export const DEFAULT_DIFFICULTY = 'medium';

export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
}

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

/** Every candidate scored for both sides, best first. */
function rank(game, player, defence, radius) {
  const opp = other(player);
  const cells = candidates(game, radius);
  if (!cells) return null;
  const sweeping = game.mode === 'encircle';
  const enemyStones = sweeping ? game.stoneCount(opp) : 0;

  const ranked = cells.map((id) => {
    const mine = evaluateCell(game, id, player);
    const theirs = evaluateCell(game, id, opp);
    let value = mine.score + defence * theirs.score;
    let sweeps = 0;
    let sweepWin = false;
    if (sweeping) {
      if (couldClose(game, id, player)) {
        sweeps = game.wouldSweep(id, player).length;
        value += sweeps * SWEEP;
        // Taking the last enemy stone off the cube ends it. Flagged rather
        // than scored, so one rare possibility cannot swamp every comparison.
        sweepWin = enemyStones > 0 && sweeps >= enemyStones;
      }
      // A cell that would close *their* loop is worth taking away. Without
      // this the opponent only ever builds fences, never fears one.
      if (couldClose(game, id, opp)) {
        value += defence * game.wouldSweep(id, opp).length * SWEEP;
      }
    }
    return { id, mine, theirs, sweeps, sweepWin, value };
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

/**
 * Twists worth thinking about: only layers that actually hold stones, since
 * rotating bare tiles changes nothing.
 */
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

/** Could `player` win outright with a twist right now? */
function twistWinAvailable(game, player) {
  if (!game.canTwist(player) && game.twists[player] <= 0) return false;
  for (const move of twistOptions(game)) {
    const outcome = twistOutcome(game, player, move);
    if (outcome.mine && !outcome.theirs) return true;
  }
  return false;
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

// ------------------------------------------------------------------- choice

const pickFrom = (list, rng) => list[Math.floor(rng() * list.length)].id;
const place = (id) => ({ t: 'place', id });

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
    // Everything else is capped: an uncapped penalty turns the search
    // paranoid, answering the opponent's plans instead of having one.
    const penalty = !reply ? 0
      : (reply.mine.win || reply.sweepWin) ? 5000000
        : Math.min(reply.value, 40000) * 0.9;
    const value = move.value - penalty + rng() * 8;
    if (!best || value > best.value) best = { id: move.id, value };
  }
  return place(best ? best.id : ranked[0].id);
}

/**
 * What to do with a twist, if anything. Twists are scarce and a careless one
 * loses on the spot, so the bar is high: finish our own line, or break up a
 * threat that no single stone can answer.
 */
function twistPlan(game, player, ranked, level, rng) {
  const opp = other(player);
  const options = twistOptions(game);
  if (!options.length) return null;

  const safe = [];
  for (const move of options) {
    const outcome = twistOutcome(game, player, move);
    // Finishing our five wins immediately - unless it finishes theirs too,
    // which by the rules hands them the game.
    if (outcome.mine && !outcome.theirs && level !== 'easy') return { move, urgency: 'win' };
    if (!outcome.mine && !outcome.theirs) safe.push({ move, cells: outcome.cells });
  }
  if (!safe.length) return null;

  // Two kinds of trouble a stone cannot answer: two separate cells that each
  // complete five, or an opponent holding a twist that wins on the spot.
  // Against the second there is no block at all - the only reply is to shake
  // their alignment apart before they use it.
  const theirTwistWin = game.twists[opp] > 0 && twistWinAvailable(game, opp);
  const doomed = theirTwistWin || ranked.filter((m) => m.theirs.win).length >= 2;
  if (doomed && level !== 'easy') {
    let best = null;
    const checked = safe.slice(0, theirTwistWin ? 8 : 14);
    for (const option of checked) {
      const { theirs, mine, stillLost } = withCells(game, option.cells, () => ({
        theirs: rank(game, opp, 0, 2),
        mine: rank(game, player, 0, 2),
        // Scrambling is only worth it if their winning twist goes with it.
        stillLost: theirTwistWin && twistWinAvailable(game, opp),
      }));
      // Judge the twist by the position it leaves us, not just by what it
      // takes from them - a twist wrecks our own shape as readily as theirs.
      const value = (mine && mine.length ? mine[0].value : 0)
        - (theirs && theirs.length ? theirs[0].value : 0)
        - (stillLost ? 2000000 : 0);
      if (!best || value > best.value) best = { move: option.move, value };
    }
    if (best) return { move: best.move, urgency: 'escape' };
  }

  return { move: safe[Math.floor(rng() * safe.length)].move, urgency: 'idle' };
}

/**
 * The move `player` should make, as { t: 'place', id } or
 * { t: 'twist', axis, layer, dir }. `difficulty` is an id from DIFFICULTIES;
 * `rng` is injectable so games can be replayed in tests.
 */
export function chooseMove(game, player, difficulty = DEFAULT_DIFFICULTY, rng = Math.random) {
  if (game.over) return null;
  const level = difficultyById(difficulty).id;

  const radius = level === 'easy' ? 1 : 2;
  const defence = level === 'easy' ? 0.55 : level === 'medium' ? 0.85 : 1;
  const ranked = rank(game, player, defence, radius);
  if (!ranked) return place(openingMove(game, rng));

  // 1. Take a win. Nothing outranks it - five in a row, or sweeping their
  //    last stone off the cube.
  const winning = ranked.filter((m) => m.mine.win || m.sweepWin);
  if (winning.length) return place(pickFrom(winning, rng));

  const twist = game.canTwist(player) ? twistPlan(game, player, ranked, level, rng) : null;
  if (twist && twist.urgency === 'win') return twist.move;

  if (ranked.length === 1) return place(ranked[0].id);

  // 2. Block theirs, or twist if a block cannot save us.
  const losing = ranked.filter((m) => m.theirs.win || m.theirs.sweepWin);
  if (twist && twist.urgency === 'escape') return twist.move;
  if (losing.length && (level !== 'easy' || rng() < 0.55)) return place(pickFrom(losing, rng));

  if (level === 'easy') {
    // Wander: a third of the time anywhere nearby, otherwise loosely among
    // the better-looking moves. Occasionally squander a twist.
    if (twist && rng() < 0.08) return twist.move;
    if (rng() < 0.32) return place(pickFrom(ranked, rng));
    return place(pickFrom(ranked.slice(0, Math.min(6, ranked.length)), rng));
  }

  // 3. Two ways to make five cannot both be blocked - make one, or stop one.
  const forcing = ranked.filter((m) => m.mine.fours >= 2);
  if (forcing.length) return place(pickFrom(forcing, rng));
  const blocking = ranked.filter((m) => m.theirs.fours >= 2);
  if (blocking.length) return place(pickFrom(blocking, rng));

  // Sweeping stones off the board is concrete and permanent: take a real one
  // ahead of any question of shape.
  const harvest = ranked.filter((m) => m.sweeps >= 2);
  if (harvest.length) return place(harvest[0].id);

  if (level === 'medium' || game.mode !== 'classic') {
    // Near-best. Medium keeps some slack so it does not play the same game
    // twice; Hard takes the best of them outright.
    const cut = ranked[0].value * 0.92;
    const close = ranked.filter((m) => m.value >= cut);
    if (level === 'medium') return place(pickFrom(close.slice(0, 4), rng));
    return place(close[0].id);
  }

  // 4. Hard: forks first, then verify the leaders against the best reply.
  const forks = ranked.filter((m) => m.mine.threes >= 2 || m.mine.fours >= 1 && m.mine.threes >= 1);
  if (forks.length && forks[0].value >= ranked[0].value * 0.9) return place(forks[0].id);
  const counterForks = ranked.filter((m) => m.theirs.threes >= 2);
  // Answer their fork, but not at any price: in a dense middlegame there is
  // almost always one to answer, and taken blindly this branch swallows every
  // move that was worth more.
  if (counterForks.length && !ranked[0].mine.fours
      && counterForks[0].value >= ranked[0].value * 0.8) {
    return place(counterForks[0].id);
  }

  return lookahead(game, player, ranked, 8, rng);
}
