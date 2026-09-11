import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, P1, P2 } from '../src/js/game.js';
import { CubeTopology } from '../src/js/cube.js';
import { chooseMove, evaluateCell, DIFFICULTIES } from '../src/js/ai.js';
import { MODES } from '../src/js/modes.js';

const LEVELS = DIFFICULTIES.map((d) => d.id);

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Cells along a line from `id`, so tests can lay out real threats. */
function lineCells(topo, id, axisIndex, count) {
  const out = [id];
  let p = topo.lattice(id);
  let d = topo.lineDirections(topo.decode(id).f)[axisIndex];
  for (let i = 1; i < count; i++) {
    const next = topo.step(p, d);
    if (!next) throw new Error('line ran off the board');
    out.push(topo.fromLattice(next.p));
    p = next.p;
    d = next.d;
  }
  return out;
}

/** Put stones on the board directly, bypassing turn order. */
function place(game, cells, player) {
  for (const id of cells) game.cells[id] = player;
}

test('every level takes an immediate win', () => {
  // A run of four has a completion cell at *either* end, so assert on the
  // outcome rather than on one particular cell.
  for (const level of LEVELS) {
    const topo = new CubeTopology(5);
    const run = lineCells(topo, topo.id(4, 2, 0), 0, 5);
    const game = new Game(5);
    place(game, run.slice(0, 4), P1);
    place(game, lineCells(topo, topo.id(1, 0, 0), 0, 3), P2);
    game.turn = P1;
    const move = chooseMove(game, P1, level, seeded(5));
    assert.ok(game.apply(move), `${level} returned an illegal move`);
    assert.equal(game.winner, P1, `${level} missed a win`);
  }
});

test('medium and hard block an immediate loss', () => {
  // Six cells: our own stone caps one end of their four, so there is exactly
  // one cell that stops five. An open four has no answer and proves nothing.
  for (const level of ['medium', 'hard']) {
    const topo = new CubeTopology(5);
    const run = lineCells(topo, topo.id(4, 2, 0), 0, 6);
    const game = new Game(5);
    place(game, run.slice(1, 5), P2);
    place(game, [run[0], topo.id(1, 1, 1)], P1);
    game.turn = P1;
    assert.equal(chooseMove(game, P1, level, seeded(9)).id, run[5], `${level} let the win through`);
  }
});

test('a win beats a block when both are available', () => {
  const topo = new CubeTopology(5);
  const mine = lineCells(topo, topo.id(4, 1, 0), 0, 5);
  const theirs = lineCells(topo, topo.id(1, 3, 0), 0, 5);
  const game = new Game(5);
  place(game, mine.slice(0, 4), P1);
  place(game, theirs.slice(0, 4), P2);
  game.turn = P1;
  for (const level of LEVELS) {
    const probe = new Game(5);
    probe.cells.set(game.cells);
    probe.turn = P1;
    const move = chooseMove(probe, P1, level, seeded(3));
    assert.ok(probe.apply(move), `${level} returned an illegal move`);
    assert.equal(probe.winner, P1, `${level} blocked instead of winning`);
  }
});

test('evaluateCell reads threats along a wrapping line', () => {
  const topo = new CubeTopology(5);
  const run = lineCells(topo, topo.id(4, 2, 3), 0, 5);
  assert.ok(new Set(run.map((id) => topo.decode(id).f)).size > 1, 'this run must cross a face');
  const game = new Game(5);
  place(game, run.slice(0, 4), P1);

  const completing = evaluateCell(game, run[4], P1);
  assert.equal(completing.win, true, 'completing a wrapped five must read as a win');

  const idle = evaluateCell(game, topo.id(3, 2, 2), P1);
  assert.equal(idle.win, false);
  assert.ok(completing.score > idle.score * 100, 'a win must dominate an idle cell');
});

test('moves are always legal, on every board size', () => {
  for (const size of [2, 3, 5, 9]) {
    for (const level of LEVELS) {
      const game = new Game(size);
      const rng = seeded(size * 31 + level.length);
      for (let i = 0; i < 12 && !game.over; i++) {
        const move = chooseMove(game, game.turn, level, rng);
        assert.equal(move.t, 'place', 'classic has no other kind of move');
        assert.ok(move.id >= 0 && move.id < game.cells.length, `${level} returned ${move.id} on size ${size}`);
        assert.equal(game.cells[move.id], 0, `${level} played an occupied cell on size ${size}`);
        game.apply(move);
      }
    }
  }
});

test('self-play runs to a decision without an illegal move', () => {
  const game = new Game(3);
  const rng = seeded(77);
  let moves = 0;
  while (!game.over) {
    const move = chooseMove(game, game.turn, moves % 2 ? 'hard' : 'medium', rng);
    assert.ok(game.apply(move), `illegal move at ply ${moves}`);
    moves++;
    assert.ok(moves <= game.cells.length, 'self-play failed to terminate');
  }
  assert.ok(game.winner !== 0, 'the game must end in a win or a draw');
});

test('the difficulties are ordered by strength, in every mode', () => {
  // Aggregated across modes: a per-mode sample small enough to run in a test
  // suite is noisy, and the property worth asserting is the ordering itself,
  // not a particular margin. tools/evaluate.mjs measures the margins.
  const run = (mode, levels, seed) => {
    const rng = seeded(seed);
    const game = new Game(5, { first: P1, mode });
    while (!game.over && game.moves.length < game.plyLimit) {
      const move = chooseMove(game, game.turn, levels[game.turn === P1 ? 0 : 1], rng);
      if (!move || !game.apply(move)) break;
    }
    return game.winner;
  };

  for (const [strong, weak] of [['hard', 'medium'], ['medium', 'easy'], ['hard', 'easy']]) {
    let wins = 0;
    let losses = 0;
    for (const mode of MODES.map((m) => m.id)) {
      for (let i = 0; i < 8; i++) {
        const strongSeat = i % 2 === 0 ? P1 : P2;
        const levels = i % 2 === 0 ? [strong, weak] : [weak, strong];
        const winner = run(mode, levels, 400 + i * 17);
        if (winner === strongSeat) wins++;
        else if (winner !== -1 && winner !== 0) losses++;
      }
    }
    assert.ok(wins > losses, `${strong} went ${wins}-${losses} against ${weak} across all modes`);
  }
});

test('the difficulty ladder survives in every mode', () => {
  const run = (mode, levels, seed) => {
    const rng = seeded(seed);
    const game = new Game(5, { first: P1, mode });
    while (!game.over && game.moves.length < game.plyLimit) {
      game.apply(chooseMove(game, game.turn, levels[game.turn === P1 ? 0 : 1], rng));
    }
    return game.winner;
  };
  for (const mode of ['classic', 'torque', 'encircle']) {
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const strongSeat = i % 2 === 0 ? P1 : P2;
      const levels = i % 2 === 0 ? ['hard', 'easy'] : ['easy', 'hard'];
      if (run(mode, levels, 700 + i * 29) === strongSeat) wins++;
    }
    assert.ok(wins >= 5, `hard won only ${wins}/6 against easy in ${mode}`);
  }
});

test('the computer never twists the opponent into a win', () => {
  for (let i = 0; i < 40; i++) {
    const rng = seeded(3000 + i);
    const game = new Game(5, { first: P1, mode: 'torque' });
    while (!game.over && game.moves.length < game.plyLimit) {
      const mover = game.turn;
      const move = chooseMove(game, mover, ['easy', 'medium', 'hard'][i % 3], rng);
      game.apply(move);
      if (game.over && move.t === 'twist') {
        assert.notEqual(game.winner, mover === P1 ? P2 : P1,
          `a twist handed the game away at ply ${game.moves.length}`);
      }
    }
  }
});
