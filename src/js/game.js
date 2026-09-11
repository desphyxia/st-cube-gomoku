/**
 * Game rules. Pure logic, no rendering and no networking, so both peers can
 * run it independently and stay in lockstep from the move list alone.
 */
import { CubeTopology, neg } from './cube.js';

export const EMPTY = 0;
export const P1 = 1;
export const P2 = 2;
export const WIN_LENGTH = 5;

export class Game {
  constructor(size, { first = P1, winLength = WIN_LENGTH } = {}) {
    this.topo = new CubeTopology(size);
    this.size = size;
    this.winLength = winLength;
    this.cells = new Int8Array(this.topo.cellCount);
    this.turn = first;
    this.first = first;
    this.moves = [];
    this.winner = 0;       // 0 = undecided, P1/P2 = winner, -1 = draw
    this.winningLine = null;
    this.lastMove = -1;
  }

  get over() {
    return this.winner !== 0;
  }

  legal(id) {
    return !this.over && id >= 0 && id < this.cells.length && this.cells[id] === EMPTY;
  }

  /** Place a stone for the player to move. Returns false if the move is illegal. */
  play(id) {
    if (!this.legal(id)) return false;
    const player = this.turn;
    this.cells[id] = player;
    this.moves.push(id);
    this.lastMove = id;

    const line = this.findLine(id, player);
    if (line) {
      this.winner = player;
      this.winningLine = line;
    } else if (this.moves.length === this.cells.length) {
      this.winner = -1;
    } else {
      this.turn = player === P1 ? P2 : P1;
    }
    return true;
  }

  resign(player) {
    if (this.over) return;
    this.winner = player === P1 ? P2 : P1;
  }

  /**
   * Longest run through `id` for `player`, or null if it is shorter than the
   * win length. Walks out along each of the four line axes of the cell's face,
   * letting `step` carry the direction around edges.
   */
  findLine(id, player) {
    if (this.cells[id] !== player) return null;
    const topo = this.topo;
    const { f } = topo.decode(id);
    const origin = topo.lattice(id);

    for (const axis of topo.lineDirections(f)) {
      const before = [];
      const after = [];
      const seen = new Set([id]);

      for (const forward of [true, false]) {
        const bucket = forward ? after : before;
        let p = origin;
        let d = forward ? axis : neg(axis);
        while (bucket.length < this.winLength - 1) {
          const next = topo.step(p, d);
          if (!next) break; // ran into a cube corner
          const nid = topo.fromLattice(next.p);
          if (this.cells[nid] !== player || seen.has(nid)) break;
          seen.add(nid);
          bucket.push(nid);
          p = next.p;
          d = next.d;
        }
      }

      const run = [...before.reverse(), id, ...after];
      if (run.length >= this.winLength) return run;
    }
    return null;
  }
}
