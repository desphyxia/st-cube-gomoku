/**
 * Measures the opponent: fitted weights against the hand-tuned baseline, the
 * difficulty ladder, and whether Hard's reply search pays for itself in each
 * mode.
 *
 *   node tools/evaluate.mjs [--games 40] [--size 5]
 */
import { Game, P1 } from '../src/js/game.js';
import { chooseMove } from '../src/js/ai.js';
import { BASELINE, LEARNED, SEARCH, weightsFor } from '../src/js/weights.js';

const MODES = ['classic', 'torque', 'encircle'];
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v]));
const GAMES = Number(args.games || 40);
const SIZE = Number(args.size || 5);

const seeded = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

function match(mode, a, b, games) {
  let aw = 0, bw = 0, drawn = 0;
  for (let i = 0; i < games; i++) {
    const rng = seeded(4242 + i * 131);
    const game = new Game(SIZE, { first: P1, mode });
    const aSeat = i % 2 === 0 ? P1 : 2;
    while (!game.over && game.moves.length < game.plyLimit) {
      const side = game.turn === aSeat ? a : b;
      const move = chooseMove(game, game.turn, side.level, rng, side.weights);
      if (!move || !game.apply(move)) break;
    }
    if (game.winner === aSeat) aw++;
    else if (game.winner === -1 || game.winner === 0) drawn++;
    else bw++;
  }
  return { aw, bw, drawn, rate: (aw + drawn * 0.5) / games };
}

const pct = (r) => `${(r * 100).toFixed(0)}%`;

console.log(`learned weights vs hand-tuned baseline (${GAMES} games, hard v hard)`);
for (const mode of MODES) {
  const r = match(mode, { level: 'hard', weights: weightsFor(mode) },
    { level: 'hard', weights: BASELINE[mode] }, GAMES);
  console.log(`  ${mode.padEnd(9)} learned ${r.aw}-${r.bw} baseline (${r.drawn} drawn)  score ${pct(r.rate)}`
    + `${LEARNED ? '' : '   [no learned weights present]'}`);
}

console.log(`\ndifficulty ladder with the weights in play (${GAMES} games)`);
for (const mode of MODES) {
  const row = [];
  for (const [x, y] of [['hard', 'medium'], ['medium', 'easy'], ['hard', 'easy']]) {
    const r = match(mode, { level: x, weights: weightsFor(mode) }, { level: y, weights: weightsFor(mode) }, GAMES);
    row.push(`${x[0]}>${y[0]} ${r.aw}-${r.bw}${r.drawn ? `/${r.drawn}d` : ''}`);
  }
  console.log(`  ${mode.padEnd(9)} ${row.join('   ')}`);
}

console.log(`\nhow deep should Hard search? (${GAMES} games vs the same Medium)`);
for (const mode of MODES) {
  const keep = { ...SEARCH[mode] };
  const row = [];
  for (const depth of [0, 1, 2, 3]) {
    SEARCH[mode] = { depth, width: 8 };
    const r = match(mode, { level: 'hard', weights: weightsFor(mode) },
      { level: 'medium', weights: weightsFor(mode) }, GAMES);
    row.push(`d${depth} ${pct(r.rate)}`);
  }
  SEARCH[mode] = keep;
  console.log(`  ${mode.padEnd(9)} ${row.join('   ')}`);
}
