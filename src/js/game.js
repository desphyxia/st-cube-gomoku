/**
 * Game rules. Pure logic, no rendering and no networking, so both peers can
 * run it independently and stay in lockstep from the move list alone.
 *
 * Three modes share the five-in-a-row core. Torque lets a turn be spent
 * twisting a layer instead of placing. Encirclement reads the player's stones
 * as a fence: on a closed surface a loop cuts the board in two, and the
 * smaller side is inside it.
 */
import { topologyFor, neg } from './cube.js';
import { DEFAULT_MODE, modeById } from './modes.js';

export const EMPTY = 0;
export const P1 = 1;
export const P2 = 2;
export const WIN_LENGTH = 5;
export const TWISTS_PER_PLAYER = 2;

export const other = (player) => (player === P1 ? P2 : P1);

export class Game {
  constructor(size, { first = P1, winLength = WIN_LENGTH, mode = DEFAULT_MODE } = {}) {
    this.topo = topologyFor(size);
    this.size = size;
    this.mode = modeById(mode).id;
    this.winLength = winLength;
    this.cells = new Int8Array(this.topo.cellCount);
    this.empty = this.topo.cellCount;
    this.turn = first;
    this.first = first;
    this.moves = [];
    this.winner = 0;       // 0 = undecided, P1/P2 = winner, -1 = draw
    this.winningLine = null;
    this.lastMove = -1;
    this.lastTwist = null;
    this.lastSweep = null;
    this.twists = { [P1]: TWISTS_PER_PLAYER, [P2]: TWISTS_PER_PLAYER };
    this.swept = { [P1]: 0, [P2]: 0 };
    this.plyLimit = this.topo.cellCount * 6;
  }

  get over() {
    return this.winner !== 0;
  }

  legal(id) {
    return !this.over && id >= 0 && id < this.cells.length && this.cells[id] === EMPTY;
  }

  canTwist(player = this.turn) {
    return !this.over && this.mode === 'torque' && this.twists[player] > 0;
  }

  /** Apply a move record: { t: 'place', id } or { t: 'twist', axis, layer, dir }. */
  apply(move) {
    if (!move) return false;
    return move.t === 'twist' ? this.twist(move.axis, move.layer, move.dir) : this.play(move.id);
  }

  /** Place a stone for the player to move. Returns false if the move is illegal. */
  play(id) {
    if (!this.legal(id)) return false;
    const player = this.turn;
    this.cells[id] = player;
    this.empty--;
    this.moves.push({ t: 'place', id, player });
    this.lastMove = id;
    this.lastTwist = null;
    this.lastSweep = null;

    const line = this.findLine(id, player);
    if (line) {
      this.winner = player;
      this.winningLine = line;
      return true;
    }

    if (this.mode === 'encircle') {
      const swept = this.sweep(player);
      if (swept.length) {
        this.lastSweep = swept;
        this.swept[player] += swept.length;
        if (this.stoneCount(other(player)) === 0) {
          this.winner = player;      // swept clean off the cube
          return true;
        }
      }
    }

    // Sweeps free tiles again, so a full board is not guaranteed to arrive.
    if (this.empty === 0 || this.moves.length >= this.plyLimit) this.winner = -1;
    else this.turn = other(player);
    return true;
  }

  /**
   * Spend the turn twisting a layer a quarter turn. Stones travel with the
   * tiles, so a twist can finish a line — for either player.
   */
  twist(axis, layer, dir = 1) {
    const player = this.turn;
    if (!this.canTwist(player)) return false;
    let perm;
    try {
      perm = this.topo.twistPermutation(axis, layer, dir);
    } catch {
      return false;                  // out-of-range axis or layer
    }

    const next = new Int8Array(this.cells.length);
    for (let id = 0; id < this.cells.length; id++) next[perm[id]] = this.cells[id];
    this.cells = next;

    this.twists[player]--;
    this.moves.push({ t: 'twist', axis, layer, dir, player });
    this.lastMove = -1;
    this.lastSweep = null;
    this.lastTwist = { axis, layer, dir, player };

    // The board moved under both players, so look for either one's five.
    const mine = this.findAnyLine(player);
    const theirs = this.findAnyLine(other(player));
    if (mine && theirs) {
      this.winner = other(player);   // handing them a five costs you the game
      this.winningLine = theirs;
    } else if (mine) {
      this.winner = player;
      this.winningLine = mine;
    } else if (theirs) {
      this.winner = other(player);
      this.winningLine = theirs;
    } else {
      this.turn = other(player);
    }
    return true;
  }

  resign(player) {
    if (this.over) return;
    this.winner = other(player);
  }

  stoneCount(player) {
    let n = 0;
    for (let id = 0; id < this.cells.length; id++) if (this.cells[id] === player) n++;
    return n;
  }

  /**
   * Encirclement. The player's stones are a fence; everything else splits
   * into edge-connected regions. On a closed surface a loop leaves two
   * regions and the smaller is inside it, so every region smaller than the
   * largest is enclosed and enemy stones there are swept off.
   *
   * Regions of equal largest size are all outside: a fence around the equator
   * divides the cube evenly and encloses nothing, which is the honest answer
   * to a genuinely symmetric position.
   *
   * Returns the swept cell ids.
   */
  sweep(player) {
    const swept = this.enclosed(player);
    for (const id of swept) {
      this.cells[id] = EMPTY;
      this.empty++;
    }
    return swept;
  }

  /** What a sweep would take, without taking it. */
  enclosed(player) {
    const enemy = other(player);
    const n = this.cells.length;
    const nbrs = this.topo.orthogonal;
    const seen = new Int8Array(n);
    const regions = [];

    for (let start = 0; start < n; start++) {
      if (seen[start] || this.cells[start] === player) continue;
      const region = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const cur = stack.pop();
        region.push(cur);
        for (let k = 0; k < 4; k++) {
          const nb = nbrs[cur * 4 + k];
          if (seen[nb] || this.cells[nb] === player) continue;
          seen[nb] = 1;
          stack.push(nb);
        }
      }
      regions.push(region);
    }
    if (regions.length < 2) return [];

    let largest = 0;
    for (const region of regions) if (region.length > largest) largest = region.length;

    const doomed = [];
    for (const region of regions) {
      if (region.length >= largest) continue;
      for (const id of region) if (this.cells[id] === enemy) doomed.push(id);
    }
    return doomed;
  }

  /** What placing on `id` would sweep, leaving the board untouched. */
  wouldSweep(id, player) {
    if (this.cells[id] !== EMPTY) return [];
    this.cells[id] = player;
    const doomed = this.enclosed(player);
    this.cells[id] = EMPTY;
    return doomed;
  }

  /** Any five-in-a-row `player` holds, or null. Used after a twist. */
  findAnyLine(player) {
    for (let id = 0; id < this.cells.length; id++) {
      if (this.cells[id] !== player) continue;
      const line = this.findLine(id, player);
      if (line) return line;
    }
    return null;
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
