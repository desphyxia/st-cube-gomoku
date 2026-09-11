import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, P1, P2, EMPTY, TWISTS_PER_PLAYER } from '../src/js/game.js';
import { CubeTopology } from '../src/js/cube.js';
import { MODES, RANDOM_MODE, resolveMode, modeById } from '../src/js/modes.js';

/** Cells along a line from `id`, so tests can lay out rings and runs. */
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

const place = (game, cells, player) => { for (const id of cells) game.cells[id] = player; };

// ------------------------------------------------------------------- modes

test('a mode is always resolved to a concrete one', () => {
  for (const mode of MODES) assert.equal(resolveMode(mode.id), mode.id);
  assert.equal(resolveMode('nonsense'), MODES[0].id);
  const seen = new Set();
  let s = 12345;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 300; i++) seen.add(resolveMode(RANDOM_MODE.id, rng));
  assert.deepEqual([...seen].sort(), MODES.map((m) => m.id).sort(), 'random must reach every mode');
});

test('every mode carries rules text for the help card', () => {
  for (const mode of MODES) {
    assert.ok(mode.name && mode.blurb, `${mode.id} needs a name and blurb`);
    assert.ok(mode.rules.length >= 2, `${mode.id} needs rules`);
  }
});

// ------------------------------------------------------------------ torque

test('twisting is only possible in torque, and only twice', () => {
  for (const mode of ['classic', 'encircle']) {
    const game = new Game(5, { mode });
    assert.equal(game.canTwist(), false);
    assert.equal(game.twist(0, 0, 1), false, `${mode} must refuse a twist`);
  }

  const game = new Game(5, { mode: 'torque' });
  for (let i = 0; i < TWISTS_PER_PLAYER; i++) {
    assert.ok(game.twist(0, 0, 1), 'P1 twist');
    assert.ok(game.twist(1, 1, -1), 'P2 twist');
  }
  assert.equal(game.twists[P1], 0);
  assert.equal(game.twists[P2], 0);
  assert.equal(game.canTwist(), false);
  assert.equal(game.twist(2, 2, 1), false, 'no twists left');
});

test('a twist carries the stones with the tiles', () => {
  const topo = new CubeTopology(5);
  const game = new Game(5, { mode: 'torque' });
  const marked = [topo.id(4, 0, 0), topo.id(4, 1, 2), topo.id(0, 3, 3)];
  place(game, marked, P1);
  const before = game.stoneCount(P1);

  const perm = topo.twistPermutation(2, 4, 1);
  assert.ok(game.twist(2, 4, 1));
  assert.equal(game.stoneCount(P1), before, 'no stone may be lost in a twist');
  for (const id of marked) assert.equal(game.cells[perm[id]], P1, 'stone did not travel with its tile');
  assert.equal(game.turn, P2, 'a twist costs the turn');
  assert.equal(game.twists[P1], TWISTS_PER_PLAYER - 1);
});

test('four quarter turns leave the board exactly as it was', () => {
  const topo = new CubeTopology(4);
  const game = new Game(4, { mode: 'torque' });
  place(game, [topo.id(4, 0, 0), topo.id(2, 1, 1), topo.id(5, 3, 2)], P1);
  place(game, [topo.id(0, 2, 2), topo.id(1, 0, 3)], P2);
  const before = Int8Array.from(game.cells);
  for (let i = 0; i < 4; i++) {
    game.twists[game.turn] = 1;      // top the allowance back up
    assert.ok(game.twist(1, 0, 1));
  }
  assert.deepEqual([...game.cells], [...before]);
});

test('a twist that completes five wins for whoever owns it', () => {
  const topo = new CubeTopology(5);
  const game = new Game(5, { mode: 'torque' });
  // Lay a winning run out in the position it will occupy *after* the twist,
  // then pull it back through the inverse permutation.
  const target = lineCells(topo, topo.id(4, 2, 0), 0, 5);
  const forward = topo.twistPermutation(0, 0, 1);
  const source = target.map((id) => {
    const from = [...forward.keys()].find((k) => forward[k] === id);
    return from;
  });
  place(game, source, P1);
  assert.equal(game.findAnyLine(P1), null, 'the line must not exist before the twist');
  assert.ok(game.twist(0, 0, 1));
  assert.equal(game.winner, P1);
  assert.equal(game.winningLine.length, 5);
});

test('handing the opponent a five by twisting loses the game', () => {
  const topo = new CubeTopology(5);
  const game = new Game(5, { mode: 'torque' });
  const target = lineCells(topo, topo.id(4, 2, 0), 0, 5);
  const forward = topo.twistPermutation(0, 0, 1);
  const source = target.map((id) => [...forward.keys()].find((k) => forward[k] === id));
  place(game, source, P2);           // the line belongs to the player NOT twisting
  assert.equal(game.turn, P1);
  assert.ok(game.twist(0, 0, 1));
  assert.equal(game.winner, P2, 'P1 twisted P2 into a win');
});

// ------------------------------------------------------------ encirclement

test('closing a loop sweeps the stones inside it', () => {
  const topo = new CubeTopology(5);
  const victim = topo.id(4, 2, 2);
  const fence = [0, 1, 2, 3].map((k) => topo.orthogonal[victim * 4 + k]);

  const game = new Game(5, { mode: 'encircle' });
  place(game, fence.slice(0, 3), P1);
  game.cells[victim] = P2;
  game.empty = game.topo.cellCount - 4;
  game.turn = P1;

  assert.ok(game.play(fence[3]), 'closing stone rejected');
  assert.equal(game.cells[victim], EMPTY, 'the enclosed stone should be swept');
  assert.deepEqual(game.lastSweep, [victim]);
  assert.equal(game.swept[P1], 1);
  assert.equal(game.empty, game.topo.cellCount - 4, 'the swept tile is free again');
});

test('the same position sweeps nothing in the other modes', () => {
  const topo = new CubeTopology(5);
  const victim = topo.id(4, 2, 2);
  const fence = [0, 1, 2, 3].map((k) => topo.orthogonal[victim * 4 + k]);
  for (const mode of ['classic', 'torque']) {
    const game = new Game(5, { mode });
    place(game, fence.slice(0, 3), P1);
    game.cells[victim] = P2;
    game.turn = P1;
    assert.ok(game.play(fence[3]));
    assert.equal(game.cells[victim], P2, `${mode} must not sweep`);
    assert.equal(game.lastSweep, null);
  }
});

test('splitting the cube exactly in half sweeps nothing', () => {
  const topo = new CubeTopology(5);
  // The middle ring of a 5-cube leaves 65 cells on each side: a dead heat.
  const ring = lineCells(topo, topo.id(4, 2, 2), 0, 20);
  assert.equal(new Set(ring).size, 20, 'the equator ring should be 4N cells');

  const game = new Game(5, { mode: 'encircle' });
  place(game, ring.slice(0, 19), P1);
  const victim = topo.id(2, 2, 2);   // a stone stranded on one side
  game.cells[victim] = P2;
  game.turn = P1;
  game.winLength = 99;               // ignore the five-in-a-row the ring contains

  assert.ok(game.play(ring[19]));
  assert.equal(game.cells[victim], P2, 'an even split encloses neither side');
  assert.equal(game.lastSweep, null);
});

test('sweeping the last enemy stone off the cube wins', () => {
  const topo = new CubeTopology(5);
  const victim = topo.id(4, 2, 2);
  const fence = [0, 1, 2, 3].map((k) => topo.orthogonal[victim * 4 + k]);
  const game = new Game(5, { mode: 'encircle' });
  place(game, fence.slice(0, 3), P1);
  game.cells[victim] = P2;
  game.turn = P1;
  assert.ok(game.play(fence[3]));
  assert.equal(game.winner, P1, 'no enemy stones left on the board');
});

test('five in a row still wins in every mode', () => {
  const topo = new CubeTopology(5);
  const run = lineCells(topo, topo.id(4, 1, 1), 0, 5);
  for (const mode of MODES.map((m) => m.id)) {
    const game = new Game(5, { mode });
    place(game, run.slice(0, 4), P1);
    game.turn = P1;
    assert.ok(game.play(run[4]));
    assert.equal(game.winner, P1, `${mode} lost five-in-a-row`);
    assert.equal(modeById(mode).id, mode);
  }
});
