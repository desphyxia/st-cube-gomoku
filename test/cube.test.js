import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeTopology, FACES, neg } from '../src/js/cube.js';

const sizes = [2, 3, 4, 5, 8, 9];

test('cell ids and lattice points round-trip', () => {
  for (const n of sizes) {
    const topo = new CubeTopology(n);
    assert.equal(topo.cellCount, 6 * n * n);
    const seen = new Set();
    for (let id = 0; id < topo.cellCount; id++) {
      const p = topo.lattice(id);
      assert.equal(topo.fromLattice(p), id, `round-trip failed for id ${id} on ${n}-cube`);
      seen.add(p.join(','));
    }
    assert.equal(seen.size, topo.cellCount, 'every cell has a distinct centre');
  }
});

test('every step lands on a real neighbouring cell', () => {
  for (const n of sizes) {
    const topo = new CubeTopology(n);
    for (let id = 0; id < topo.cellCount; id++) {
      const { f } = topo.decode(id);
      for (const d of topo.allDirections(f)) {
        const next = topo.stepCell(id, d);
        if (!next) continue;
        assert.notEqual(next.id, id);
        assert.ok(next.id >= 0 && next.id < topo.cellCount);
        // the direction stays tangent to the face it landed on
        const face = FACES[topo.decode(next.id).f];
        const dot = next.d[0] * face.n[0] + next.d[1] * face.n[1] + next.d[2] * face.n[2];
        assert.equal(Math.abs(dot), 0, 'direction must stay tangent to the surface');
      }
    }
  }
});

test('stepping is reversible', () => {
  for (const n of sizes) {
    const topo = new CubeTopology(n);
    for (let id = 0; id < topo.cellCount; id++) {
      const { f } = topo.decode(id);
      for (const d of topo.allDirections(f)) {
        const fwd = topo.step(topo.lattice(id), d);
        if (!fwd) continue;
        const back = topo.step(fwd.p, neg(fwd.d));
        assert.ok(back, 'a step that went somewhere must be walkable back');
        assert.deepEqual(back.p, topo.lattice(id));
        assert.deepEqual(back.d, neg(d));
      }
    }
  }
});

test('orthogonal lines close into a ring of 4N cells', () => {
  for (const n of sizes) {
    const topo = new CubeTopology(n);
    for (let id = 0; id < topo.cellCount; id++) {
      const { f } = topo.decode(id);
      for (const d of topo.lineDirections(f).slice(0, 2)) {
        let p = topo.lattice(id);
        let dir = d;
        const visited = new Set();
        for (let i = 0; i < 4 * n; i++) {
          visited.add(topo.fromLattice(p));
          const next = topo.step(p, dir);
          assert.ok(next, 'orthogonal lines never hit a cube corner');
          p = next.p;
          dir = next.d;
        }
        assert.equal(visited.size, 4 * n, 'ring visits 4N distinct cells');
        assert.deepEqual(p, topo.lattice(id), 'ring returns to its start');
        assert.deepEqual(dir, d, 'ring returns with its original heading');
      }
    }
  }
});

test('diagonals stop at the eight cube corners', () => {
  const topo = new CubeTopology(4);
  let blocked = 0;
  for (let id = 0; id < topo.cellCount; id++) {
    const { f } = topo.decode(id);
    for (const d of topo.allDirections(f)) {
      if (!topo.stepCell(id, d)) blocked++;
    }
  }
  // 8 corners x 3 cells meeting there x 1 outward diagonal each
  assert.equal(blocked, 24);
});
