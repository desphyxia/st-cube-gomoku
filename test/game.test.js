import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, P1, P2 } from '../src/js/game.js';
import { CubeTopology } from '../src/js/cube.js';

/** Play out an alternating sequence where `mine` are P1 cells and the rest fillers. */
function playAlternating(game, mine, fillers) {
  for (let i = 0; i < mine.length; i++) {
    assert.ok(game.play(mine[i]), `P1 move ${i} rejected`);
    if (game.over) return;
    assert.ok(game.play(fillers[i]), `P2 move ${i} rejected`);
    assert.ok(!game.over, 'filler moves must not decide the game');
  }
}

/** Cells along a line, walking from `id` in direction `d`. */
function lineCells(topo, id, d, count) {
  const out = [id];
  let p = topo.lattice(id);
  let dir = d;
  for (let i = 1; i < count; i++) {
    const next = topo.step(p, dir);
    if (!next) throw new Error('line ran off the board');
    out.push(topo.fromLattice(next.p));
    p = next.p;
    dir = next.d;
  }
  return out;
}

/** Throwaway opponent moves, scattered one per face so they never line up. */
function fillersAvoiding(topo, used, count) {
  const out = [];
  const n = topo.size;
  for (let k = 0; out.length < count; k++) {
    if (k > topo.cellCount) throw new Error('ran out of filler cells');
    const f = k % 6;
    const band = Math.floor(k / 6);
    const id = topo.id(f, band % n, (band * 2 + f) % n);
    if (!used.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

test('five wrapping across faces wins', () => {
  const topo = new CubeTopology(3);
  // start near an edge of +z so the run rolls onto +x partway through
  const start = topo.id(4, 1, 2);
  const cells = lineCells(topo, start, topo.lineDirections(4)[0], 5);
  const faces = new Set(cells.map((id) => topo.decode(id).f));
  assert.ok(faces.size > 1, 'this run must genuinely cross a face boundary');

  const game = new Game(3);
  playAlternating(game, cells, fillersAvoiding(topo, new Set(cells), 5));
  assert.equal(game.winner, P1);
  assert.equal(game.winningLine.length, 5);
  assert.deepEqual(new Set(game.winningLine), new Set(cells));
});

test('four in a row is not a win', () => {
  const topo = new CubeTopology(4);
  const cells = lineCells(topo, topo.id(0, 1, 1), topo.lineDirections(0)[1], 4);
  const game = new Game(4);
  playAlternating(game, cells, fillersAvoiding(topo, new Set(cells), 4));
  assert.equal(game.winner, 0);
  assert.equal(game.turn, P1, 'four rounds played, back to P1');
});

test('a diagonal that rolls over an edge still wins', () => {
  const topo = new CubeTopology(5);
  const diag = topo.lineDirections(4)[2];
  const cells = lineCells(topo, topo.id(4, 1, 2), diag, 5);
  assert.ok(new Set(cells.map((id) => topo.decode(id).f)).size > 1);
  const game = new Game(5);
  playAlternating(game, cells, fillersAvoiding(topo, new Set(cells), 5));
  assert.equal(game.winner, P1);
});

test('a 2-cube is won by five around an eight-cell ring', () => {
  const topo = new CubeTopology(2);
  const ring = lineCells(topo, topo.id(4, 0, 0), topo.lineDirections(4)[0], 8);
  assert.equal(new Set(ring).size, 8);
  const game = new Game(2);
  playAlternating(game, ring.slice(0, 5), fillersAvoiding(topo, new Set(ring), 5));
  assert.equal(game.winner, P1);
});

test('illegal moves are rejected and turns alternate', () => {
  const game = new Game(3);
  assert.ok(game.play(0));
  assert.equal(game.play(0), false, 'cannot play an occupied cell');
  assert.equal(game.turn, P2);
  assert.ok(game.play(1));
  assert.equal(game.turn, P1);
  assert.equal(game.play(-1), false);
  assert.equal(game.play(9999), false);
});

test('resignation hands the win to the other player', () => {
  const game = new Game(3);
  game.play(0);
  game.resign(P2);
  assert.equal(game.winner, P1);
  assert.equal(game.play(5), false, 'no moves after the game ends');
});
