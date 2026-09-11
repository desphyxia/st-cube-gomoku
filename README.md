# Cube⁵

Five-in-a-row played on the **surface of a cube**. A row does not stop at the
edge of a face — it rolls over onto the next one and keeps going straight, so
the threat that beats you is usually on the face you are not looking at.

A three.js remake of an Android/iOS game from 2012, with three game modes,
Steam peer-to-peer multiplayer, a computer opponent at three difficulties,
configurable board sizes, and three switchable visual themes.

![themes](docs/themes.png)

## Modes

Picked before a game starts. **Roll the dice** chooses one at random every
game, rematches included, so the mode is re-rolled each time.

| | |
|---|---|
| **Classic** | Five in a row, rolling over every edge. |
| **Torque** | Five in a row still wins, but a turn can be spent twisting one layer of the cube a quarter turn instead of placing. Stones travel with the tiles. Two twists each for the whole game. A twist that leaves five in a row wins it for whoever owns it — and leaving five for *both* hands the game to the player who did not twist. |
| **Encirclement** | Five in a row still wins, and your stones also cut the surface. Close a loop and the smaller side is inside it; every enemy stone in there is swept off, freeing the tile. Sweep their last stone off the cube and you win outright. Split the cube exactly in half and neither side is inside, so nothing is swept. |

A twist is an exact 90° integer rotation of the affected cells on the same
doubled lattice the rest of the geometry uses, so a cell centre always lands on
another cell centre. The outermost layers carry their end cap along, exactly as
a twisty puzzle does; `npm test` checks the permutation is a bijection, has
order four, is the inverse of the opposite turn, and never moves a cell out of
its layer.

Encirclement costs scale sub-linearly, because the cube's curvature is
concentrated in its eight corners: four stones sweep a single stone, seven
sweep a four-cell pocket, ten sweep a twelve-cell pocket, and twenty take a
whole face. Regions are edge-connected and the fence blocks diagonally, which
is the pairing that makes a closed loop actually separate the surface.

## Rules

- The board is all six faces of an N×N×N cube: `6N²` tiles.
- Players alternate claiming empty tiles. **Five in a row wins.**
- Rows wrap across face edges. A straight row circles the whole cube in `4N`
  tiles, so on a small cube every win has to travel around it — there is no
  five-in-a-row on a single 2×2 or 4×4 face.
- Diagonals wrap over edges too, but they **stop at the cube's eight corners**,
  where three faces meet with only 270° of surface and a diagonal has no
  well-defined continuation.
- Board sizes run from 2 to 9 per face (24 to 486 tiles).

## Running it

```sh
npm install
npm start        # Electron
npm test         # rules and topology tests, no display needed
```

For online play, Steam must be running and signed in. The app initialises
Steamworks with **App ID 480** (Spacewar, Valve's public test app), so anyone
with a Steam account can host and join without an app of their own.

### A caveat about App ID 480

Every Steamworks test build in the world shares App ID 480, so the public lobby
list is noisy and the in-app browser filters it down to lobbies tagged as
Cube⁵ — which can leave it empty even when a friend is hosting. Two reliable
paths:

- **Paste the lobby ID.** The host's waiting screen shows it; *Join a game →*
  paste → *Join*.
- **Steam invite.** *Invite via Steam* opens the overlay's invite dialog, and
  accepting from the friends list drops the guest straight into the game.

`steam_appid.txt` in the repo root is what tells the Steam client which app is
running during development. Ship a real App ID by changing `APP_ID` in
`electron/main.cjs` and that file.

Without Steam the menu says so and online play is disabled; **Play the
computer** and **two players, one screen** still work, and are the quickest way
to try the game.

## The computer opponent

Three layers, deliberately separated, because the first version mixed them and
the difficulty ordering kept inverting whenever a mode was added.

**Tactics** are forced play — take a win, stop theirs, refuse a twist that hands
the game away. Correct by construction. Never learned, never tuned.

**Position** is everything else. A five-window slides along each of the four
line axes through a cell and the windows still *live* are counted — free of
opponent stones and of the walls where a diagonal dies at a cube corner.
Counting live windows rather than matching literal patterns handles gapped
shapes and lines that roll over a face edge without a special case. The weights
that turn those counts into a score are **fitted by self-play**, not chosen by
hand; they live in `src/js/weights.js` as data.

**Handicap** is how difficulty works: one policy, degraded. Hard plays it
straight; Medium drops the search and picks loosely among near-best moves;
Easy also misses roughly half of your winning moves, wanders, and looks one
step less far. Ordering is structural, so adding a fourth mode cannot invert
it the way adding the third did.

### Fitting the weights

```sh
npm run train       # cross-entropy self-play, rewrites src/js/weights.js
npm run evaluate    # learned vs baseline, the ladder, and search depth
```

`tools/train.mjs` samples a population of weight sets around a running mean,
plays each against the incumbent over a *shared* set of seeds so candidates are
compared on the same games rather than on luck, keeps the best handful and
moves the mean toward them. Ratio-scale parameters are sampled in log space.
Nothing is adopted on faith: the fitted weights must beat the hand-tuned
baseline in a held-out match or the baseline is kept.

What it found, over 40-game matches on a 5-cube, Hard against Hard:

| | fitted vs hand-tuned |
|---|---|
| Classic | **59%** — adopted |
| Encirclement | **80%** — adopted |
| Torque | 45% — **rejected**, baseline kept |

Two results worth more than the win rates. The `fence` term — a hand-written
guess at "this cell builds toward an enclosure" — trained to essentially zero
in all three modes, independently rejecting a term I had already rejected by
hand. And `sweep` trained to zero in Classic and Torque, where no sweep exists:
the optimiser recovered the structure of the game rather than fitting noise.

### Searching

Hard's original "subtract what the best reply is worth" penalty measured
*worse than no search at all* — 57/23/15% against a fixed Medium with it on,
against 61/45/68% with it off. It made Hard answer the opponent's plans instead
of having one. It was replaced by negamax with alpha-beta over the learned
evaluation, and the depth for each mode was measured rather than assumed:

| | d0 | d1 | d2 | d3 | ships |
|---|---|---|---|---|---|
| Classic | **58%** | 15% | 40% | 30% | depth 0 |
| Torque | 47% | 40% | 43% | **73%** | depth 3 |
| Encirclement | 67% | 77% | 60% | **100%** | depth 3 |

Classic wants no search at all; the two new modes want three ply. Odd shallow
depths are consistently bad, which is the usual even-odd artefact of stopping a
search on the opponent's move. A move costs under 1 ms in Classic, 12 ms in
Torque and 20 ms in Encirclement, with a 68 ms worst case.

### The resulting ladder

40 games a pairing, size 5 (`d` = drawn):

| | hard v medium | medium v easy | hard v easy |
|---|---|---|---|
| Classic | 17-8 /15d | 27-3 /10d | 32-2 /6d |
| Torque | 34-6 | 21-19 | 37-3 |
| Encirclement | 39-0 /1d | 28-12 | 36-4 |

Torque's medium-versus-easy is thin at 21-19, and honestly so: it is a
high-variance mode where random play is competitive, and disabling Medium's
twists did not move it. The top of the ladder is solid in all three.

Across 200 Torque games the computer never once twisted the opponent into a
win, which is a test rather than a hope.

### Speed

Self-play needs a lot of games, so the nine cells of every line window are
precomputed per topology and evaluation became flat array reads. That is 6-10x
more games per second (Classic at Hard went from 1.6 to 16.3 games/s), and the
rewritten evaluator was checked against the old one over 20,804 evaluations on
four board sizes with zero mismatches, so the speed cost nothing in behaviour.

## How it is put together

```
electron/main.cjs    Steam: lobbies, P2P packets, callbacks. The only place
                     the native module is touched.
electron/preload.cjs contextBridge: plain JSON in, plain JSON out.
src/js/cube.js       Cube topology — cells, face frames, and the edge-folding
                     walk that makes a line stay straight around the cube.
src/js/game.js       Rules: legality, turn order, win detection. Pure logic.
src/js/view.js       three.js scene, tiles, picking, camera work.
src/js/themes.js     The three themes.
src/js/modes.js      The three game modes and the random roll.
src/js/weights.js    Fitted positional weights, per mode. Data, not code.
tools/train.mjs      Self-play fitting of those weights.
tools/evaluate.mjs   Measures strength, the ladder, and search depth.
src/js/ai.js         The computer opponent: threat scoring and the three
                     difficulty ladders.
src/js/net.js        Wire protocol and the renderer half of the bridge.
src/js/main.js       Controller tying the three together.
```

### The interesting part: walking a line around a cube

Cell centres live on a doubled integer lattice, so a cube of size N spans
`[-N, N]` and every centre has exactly one coordinate at `±N` — all of the
geometry is exact integer arithmetic with no floating-point comparisons.

A step is `p + 2d`. If the result overshoots the face, `CubeTopology.step`
rotates both the position and the direction 90° about the shared edge, which
drops the line onto the neighbouring face still heading "straight". Overshoot
on two axes at once means the line hit a cube corner, and it ends there.

Win detection walks out from the placed stone along the four line axes of its
face, in both directions, with a visited set so a fully-owned ring on a small
cube cannot be double-counted.

`npm test` covers this: lattice round-trips, every step landing on a real
neighbour with a tangent heading, reversibility, orthogonal rings closing after
exactly `4N` cells with their original heading, exactly 24 corner-blocked
diagonals, and wins that wrap across faces.

### Networking

Turn-based, so there is no prediction or rollback: both peers run the same
rules object and exchange moves over reliable Steam P2P packets. The host owns
matchmaking and the game configuration, announces who moves first, and is the
only side that issues `start`. Moves carry a sequence number and are rejected
if they arrive out of order, if it is not the sender's turn, or if the cell is
not legal.

## Not included

Deliberately scoped to the core game: no match history, no chat, no ranking.
