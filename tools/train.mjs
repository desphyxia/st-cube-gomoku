/**
 * Fits the opponent's positional weights by self-play.
 *
 * Cross-entropy method: sample a population of weight sets around a running
 * mean, play each against the incumbent over a shared set of seeds, keep the
 * best handful, and move the mean toward them. Ratio-scale parameters are
 * sampled in log space so a candidate can be twice or half the incumbent
 * rather than plus-or-minus a fixed amount.
 *
 * Every candidate in a generation plays the *same* seeds, so two candidates
 * are compared on the same games rather than on luck.
 *
 *   node tools/train.mjs [--modes classic,torque,encircle] [--gens 24]
 *                        [--pop 16] [--games 24] [--size 5] [--level medium]
 *
 * Writes the fitted weights into src/js/weights.js.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { Game, P1, P2 } from '../src/js/game.js';
import { chooseMove } from '../src/js/ai.js';
import { BASELINE, TUNABLE, LEARNED } from '../src/js/weights.js';

const FIELDS = Object.keys(TUNABLE);
/** Parameters that are ratios rather than offsets; sampled in log space. */
const LOG_SCALE = new Set(['w1', 'w2', 'w3', 'w4', 'sweep', 'fence', 'replyCap']);

const seeded = (s0) => {
  let s = s0 >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};

/** One game between two weight sets. Returns 1, 0 or 0.5 from A's view. */
function duel(mode, size, level, wa, wb, seed, aFirst) {
  const rng = seeded(seed);
  const game = new Game(size, { first: P1, mode });
  const aSeat = aFirst ? P1 : P2;
  while (!game.over && game.moves.length < game.plyLimit) {
    const weights = game.turn === aSeat ? wa : wb;
    const move = chooseMove(game, game.turn, level, rng, weights);
    if (!move || !game.apply(move)) break;
  }
  if (game.winner === aSeat) return 1;
  if (game.winner === -1 || game.winner === 0) return 0.5;
  return 0;
}

// ------------------------------------------------------------------ worker

if (!isMainThread) {
  parentPort.on('message', (task) => {
    if (task === 'stop') { parentPort.close(); return; }
    const { mode, size, level, candidates, incumbent, seeds } = task;
    const scores = candidates.map((w) => {
      let total = 0;
      for (const seed of seeds) {
        total += duel(mode, size, level, w, incumbent, seed, true);
        total += duel(mode, size, level, w, incumbent, seed + 1, false);
      }
      return total / (seeds.length * 2);
    });
    parentPort.postMessage(scores);
  });
}

// -------------------------------------------------------------------- main

function encode(w) {
  return FIELDS.map((f) => (LOG_SCALE.has(f) ? Math.log(Math.max(w[f], 1e-6)) : w[f]));
}

function decode(vec) {
  const out = {};
  FIELDS.forEach((f, i) => {
    const [lo, hi] = TUNABLE[f];
    const raw = LOG_SCALE.has(f) ? Math.exp(vec[i]) : vec[i];
    out[f] = Math.min(hi, Math.max(lo, raw));
  });
  return out;
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

class Pool {
  constructor(n) {
    const here = fileURLToPath(import.meta.url);
    this.workers = Array.from({ length: n }, () => new Worker(here, { workerData: {} }));
  }

  run(tasks) {
    return Promise.all(tasks.map((task, i) => new Promise((resolve, reject) => {
      const worker = this.workers[i % this.workers.length];
      const onMessage = (msg) => { worker.off('error', onError); resolve(msg); };
      const onError = (err) => { worker.off('message', onMessage); reject(err); };
      worker.once('message', onMessage);
      worker.once('error', onError);
      worker.postMessage(task);
    })));
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

async function train(mode, opts, pool) {
  const { gens, pop, games, size, level } = opts;
  const rng = seeded(0xC0FFEE ^ mode.length * 7919);
  let mean = encode((LEARNED && LEARNED[mode]) || BASELINE[mode]);
  let std = FIELDS.map((f) => (LOG_SCALE.has(f) ? 0.55 : 0.25));
  let incumbent = (LEARNED && LEARNED[mode]) || BASELINE[mode];
  let best = { weights: incumbent, score: 0.5 };

  const workers = pool.workers.length;
  process.stdout.write(`\n${mode}: ${gens} generations, pop ${pop}, ${games * 2} games each\n`);

  for (let gen = 0; gen < gens; gen++) {
    const candidates = [];
    for (let i = 0; i < pop; i++) {
      candidates.push(decode(mean.map((m, k) => m + std[k] * gauss(rng))));
    }
    // Common random numbers: every candidate faces the same games.
    const seeds = Array.from({ length: games }, () => Math.floor(rng() * 1e9) * 2);

    const chunks = [];
    const per = Math.ceil(candidates.length / workers);
    for (let i = 0; i < candidates.length; i += per) {
      chunks.push({ mode, size, level, candidates: candidates.slice(i, i + per), incumbent, seeds });
    }
    const t0 = Date.now();
    const scores = (await pool.run(chunks)).flat();
    const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
    const eliteCount = Math.max(3, Math.round(pop * 0.3));
    const elite = order.slice(0, eliteCount).map(([, i]) => encode(candidates[i]));

    mean = mean.map((_, k) => elite.reduce((a, e) => a + e[k], 0) / elite.length);
    std = mean.map((m, k) => {
      const v = elite.reduce((a, e) => a + (e[k] - m) ** 2, 0) / elite.length;
      return Math.max(Math.sqrt(v), LOG_SCALE.has(FIELDS[k]) ? 0.08 : 0.03);
    });

    const top = order[0][0];
    if (top > best.score) best = { weights: candidates[order[0][1]], score: top };
    // Promote once the sampled mean is clearly beating the incumbent.
    if (top >= 0.62) incumbent = candidates[order[0][1]];
    process.stdout.write(`  gen ${String(gen + 1).padStart(2)}  best ${(top * 100).toFixed(1)}%  `
      + `mean-of-elite ${(order.slice(0, eliteCount).reduce((a, [s]) => a + s, 0) / eliteCount * 100).toFixed(1)}%  `
      + `${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }
  return decode(mean);
}

/**
 * Only keep what measures better. The search distribution's mean can drift
 * somewhere worse than both the incumbent and the best candidate seen, so the
 * fitted weights are played against the hand-tuned baseline before being
 * written, and the baseline is kept if they lose.
 */
async function adopt(mode, fitted, opts, pool) {
  const games = Math.max(24, opts.games * 2);
  const seeds = Array.from({ length: games }, (_, i) => 9000 + i * 37);
  const [scores] = await pool.run([{
    mode, size: opts.size, level: opts.verify || 'hard',
    candidates: [fitted], incumbent: BASELINE[mode], seeds,
  }]);
  const score = scores[0];
  const verdict = score > 0.55 ? 'adopted' : 'rejected, keeping the baseline';
  process.stdout.write(`  ${mode}: fitted scores ${(score * 100).toFixed(1)}% against the baseline - ${verdict}\n`);
  return score > 0.55 ? fitted : { ...BASELINE[mode] };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v]));
  const opts = {
    gens: Number(args.gens || 22),
    pop: Number(args.pop || 16),
    games: Number(args.games || 20),
    size: Number(args.size || 5),
    level: args.level || 'medium',
    verify: args.verify || 'hard',
  };
  const modes = (args.modes || 'classic,torque,encircle').split(',');
  const pool = new Pool(Math.max(1, Math.min(cpus().length, 4)));

  // Keep weights for modes this run did not touch: training one mode must not
  // silently drop the others back to the baseline.
  const learned = { ...(LEARNED || {}) };
  for (const mode of modes) {
    const fitted = await train(mode, opts, pool);
    learned[mode] = await adopt(mode, fitted, opts, pool);
  }
  await pool.close();

  const file = new URL('../src/js/weights.js', import.meta.url);
  const src = readFileSync(file, 'utf8');
  const body = Object.entries(learned)
    .map(([mode, w]) => `  ${mode}: { ${FIELDS.map((f) => `${f}: ${Number(w[f].toPrecision(5))}`).join(', ')} },`)
    .join('\n');
  // Replace strictly between the markers: a looser pattern once ate the
  // function underneath it.
  const begin = src.indexOf('/* LEARNED-BEGIN');
  const endTag = '/* LEARNED-END */';
  const end = src.indexOf(endTag);
  if (begin < 0 || end < 0) throw new Error('weights.js is missing its LEARNED markers');
  const header = '/* LEARNED-BEGIN \u2014 generated by tools/train.mjs, do not edit by hand */';
  const block = `${header}\nexport const LEARNED = {\n${body}\n};\n`;
  writeFileSync(file, src.slice(0, begin) + block + src.slice(end));
  process.stdout.write(`\nwrote ${modes.length} weight sets to src/js/weights.js\n`);
}

if (isMainThread) main();
