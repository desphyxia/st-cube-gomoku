/**
 * Cube topology: the board is the *surface* of an N x N x N cube, so a
 * "straight line" is allowed to roll over an edge onto the next face.
 *
 * Coordinates
 * -----------
 * Every cell centre is stored on a doubled integer lattice so that all of the
 * geometry below is exact integer arithmetic (no floating point comparisons).
 * The cube spans [-N, N] on each axis; a cell centre has exactly one
 * coordinate equal to +/-N (its face) and the other two strictly inside.
 * One cell step is therefore 2 lattice units. World units = lattice * 0.5,
 * which makes a cell exactly 1 unit wide.
 */

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Face frames. `u` is the column axis, `v = n x u` is the row axis, which
 * guarantees u x v = n (an outward-facing, right-handed basis).
 */
export const FACES = [
  { key: '+x', n: [1, 0, 0], u: [0, 0, -1] },
  { key: '-x', n: [-1, 0, 0], u: [0, 0, 1] },
  { key: '+y', n: [0, 1, 0], u: [1, 0, 0] },
  { key: '-y', n: [0, -1, 0], u: [1, 0, 0] },
  { key: '+z', n: [0, 0, 1], u: [1, 0, 0] },
  { key: '-z', n: [0, 0, -1], u: [-1, 0, 0] },
].map((f, i) => ({
  ...f,
  index: i,
  v: cross(f.n, f.u),
  axis: f.n.findIndex((c) => c !== 0),
  sign: f.n.find((c) => c !== 0),
}));

export const MIN_SIZE = 2;
export const MAX_SIZE = 9;

const neg = (d) => [-d[0], -d[1], -d[2]];

export class CubeTopology {
  constructor(size) {
    if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
      throw new RangeError(`board size must be an integer in [${MIN_SIZE}, ${MAX_SIZE}]`);
    }
    this.size = size;
    this.cellCount = 6 * size * size;
  }

  /** (face, row, col) -> cell id */
  id(f, r, c) {
    return (f * this.size + r) * this.size + c;
  }

  /** cell id -> { f, r, c } */
  decode(id) {
    const n = this.size;
    return { f: Math.floor(id / (n * n)), r: Math.floor(id / n) % n, c: id % n };
  }

  /** cell id -> doubled-integer lattice centre */
  lattice(id) {
    const n = this.size;
    const { f, r, c } = this.decode(id);
    const face = FACES[f];
    const du = 2 * c + 1 - n;
    const dv = 2 * r + 1 - n;
    return [
      face.n[0] * n + face.u[0] * du + face.v[0] * dv,
      face.n[1] * n + face.u[1] * du + face.v[1] * dv,
      face.n[2] * n + face.u[2] * du + face.v[2] * dv,
    ];
  }

  /** doubled-integer lattice centre -> cell id */
  fromLattice(p) {
    const n = this.size;
    const axis = this.normalAxis(p);
    const sign = Math.sign(p[axis]);
    const face = FACES.find((f) => f.axis === axis && f.sign === sign);
    const du = p[0] * face.u[0] + p[1] * face.u[1] + p[2] * face.u[2];
    const dv = p[0] * face.v[0] + p[1] * face.v[1] + p[2] * face.v[2];
    return this.id(face.index, (dv + n - 1) / 2, (du + n - 1) / 2);
  }

  /** Index of the axis a surface point is pinned to. */
  normalAxis(p) {
    const n = this.size;
    for (let i = 0; i < 3; i++) if (Math.abs(p[i]) === n) return i;
    throw new Error(`point ${p} is not on the surface of a ${n}-cube`);
  }

  /** The four line axes of a face: right, down, and the two diagonals. */
  lineDirections(faceIndex) {
    const { u, v } = FACES[faceIndex];
    return [
      u,
      v,
      [u[0] + v[0], u[1] + v[1], u[2] + v[2]],
      [u[0] - v[0], u[1] - v[1], u[2] - v[2]],
    ];
  }

  /** All eight neighbour directions of a face. */
  allDirections(faceIndex) {
    const four = this.lineDirections(faceIndex);
    return [...four, ...four.map(neg)];
  }

  /**
   * Walk one cell from lattice point `p` heading in `d`.
   *
   * Inside a face this is just p + 2d. Crossing an edge folds the overshoot
   * onto the neighbouring face by rotating 90 degrees about the shared edge,
   * which carries the direction vector along with it, so a line keeps going
   * "straight" as it rolls around the cube.
   *
   * Returns null at the eight cube corners: three faces meet there with only
   * 270 degrees of surface, so a diagonal has no well-defined continuation
   * and the line simply ends.
   */
  step(p, d) {
    const n = this.size;
    const q = [p[0] + 2 * d[0], p[1] + 2 * d[1], p[2] + 2 * d[2]];
    const a = this.normalAxis(p);

    let b = -1;
    let crossings = 0;
    for (let i = 0; i < 3; i++) {
      if (i !== a && Math.abs(q[i]) > n) {
        crossings++;
        b = i;
      }
    }
    if (crossings === 0) return { p: q, d };
    if (crossings > 1) return null; // cube corner

    const c = 3 - a - b;
    const s = Math.sign(p[a]);
    const t = Math.sign(q[b]);
    const k = s * t;

    // Rotate by 90 degrees about the shared edge (which runs along axis c).
    const ea = s * n;
    const eb = t * n;
    const rel = [q[0], q[1], q[2]];
    rel[a] -= ea;
    rel[b] -= eb;

    const out = [0, 0, 0];
    out[a] = ea - k * rel[b];
    out[b] = eb + k * rel[a];
    out[c] = rel[c];

    const nd = [0, 0, 0];
    nd[a] = -k * d[b];
    nd[b] = k * d[a];
    nd[c] = d[c];

    return { p: out, d: nd };
  }

  /** Convenience: step from a cell id, returning { id, d } or null. */
  stepCell(id, d) {
    const next = this.step(this.lattice(id), d);
    return next && { id: this.fromLattice(next.p), d: next.d, p: next.p };
  }

  /**
   * The four edge-sharing neighbours of every cell, as a flat lookup table
   * (cell id * 4 + k). Orthogonal steps never die at a cube corner, so every
   * cell has exactly four. Built once and reused: region fills walk this
   * constantly.
   */
  get orthogonal() {
    if (this._orthogonal) return this._orthogonal;
    const table = new Int32Array(this.cellCount * 4);
    for (let id = 0; id < this.cellCount; id++) {
      const { f } = this.decode(id);
      const [u, v] = this.lineDirections(f);
      const dirs = [u, neg(u), v, neg(v)];
      for (let k = 0; k < 4; k++) {
        const next = this.stepCell(id, dirs[k]);
        if (!next) throw new Error('an orthogonal step should never be blocked');
        table[id * 4 + k] = next.id;
      }
    }
    this._orthogonal = table;
    return table;
  }

  /**
   * All eight neighbours of every cell as a flat table (cell id * 8 + k),
   * with -1 where a diagonal dies at a cube corner. The opponent walks this
   * constantly, so it is worth building once.
   */
  get neighbours() {
    if (this._neighbours) return this._neighbours;
    const table = new Int32Array(this.cellCount * 8).fill(-1);
    for (let id = 0; id < this.cellCount; id++) {
      const { f } = this.decode(id);
      const dirs = this.allDirections(f);
      for (let k = 0; k < 8; k++) {
        const next = this.stepCell(id, dirs[k]);
        table[id * 8 + k] = next ? next.id : -1;
      }
    }
    this._neighbours = table;
    return table;
  }

  /**
   * Where every cell goes when one layer is twisted a quarter turn, as a
   * permutation of cell ids. Layer `k` along `axis` is the slab of the cube
   * between two cutting planes; the outermost layers carry their end cap
   * along, which is exactly how a twisty puzzle behaves.
   *
   * On the doubled lattice the twist is an exact integer rotation about the
   * axis, so a cell centre always lands on another cell centre.
   */
  twistPermutation(axis, layer, dir = 1) {
    const n = this.size;
    if (!Number.isInteger(axis) || axis < 0 || axis > 2) throw new RangeError('axis must be 0, 1 or 2');
    if (!Number.isInteger(layer) || layer < 0 || layer >= n) throw new RangeError(`layer must be in [0, ${n - 1}]`);

    const key = `${axis}:${layer}:${dir > 0 ? 1 : -1}`;
    if (!this._twists) this._twists = new Map();
    const cached = this._twists.get(key);
    if (cached) return cached;

    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    const slab = 2 * layer + 1 - n;
    const perm = new Int32Array(this.cellCount);

    for (let id = 0; id < this.cellCount; id++) {
      const p = this.lattice(id);
      const a = p[axis];
      const inLayer = a === slab
        || (layer === 0 && a === -n)
        || (layer === n - 1 && a === n);
      if (!inLayer) {
        perm[id] = id;
        continue;
      }
      const q = [p[0], p[1], p[2]];
      if (dir > 0) {
        q[b] = -p[c];
        q[c] = p[b];
      } else {
        q[b] = p[c];
        q[c] = -p[b];
      }
      perm[id] = this.fromLattice(q);
    }
    this._twists.set(key, perm);
    return perm;
  }

  /** Cells belonging to one twist layer, for animation and for the AI. */
  twistLayer(axis, layer) {
    const n = this.size;
    const slab = 2 * layer + 1 - n;
    const out = [];
    for (let id = 0; id < this.cellCount; id++) {
      const a = this.lattice(id)[axis];
      if (a === slab || (layer === 0 && a === -n) || (layer === n - 1 && a === n)) out.push(id);
    }
    return out;
  }
}

export { neg };
