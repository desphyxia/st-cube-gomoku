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
}

export { neg };
