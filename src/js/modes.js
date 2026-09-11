/**
 * The three ways to play. Each keeps five-in-a-row and adds one rule that
 * only makes sense on a closed surface.
 */
export const MODES = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Five in a row, rolling over every edge.',
    rules: [
      'Claim an empty tile on your turn.',
      'First to five in a row wins. Rows roll over face edges and keep going straight.',
    ],
  },
  {
    id: 'torque',
    name: 'Torque',
    blurb: 'Spend a turn twisting a layer. Two twists each.',
    rules: [
      'Five in a row still wins.',
      'Instead of placing, you may twist one layer of the cube a quarter turn. Stones travel with the tiles.',
      'Two twists each, for the whole game. Spending one costs you the turn.',
      'A twist that leaves five in a row wins for whoever owns it — and if it leaves five for both, the player who twisted loses.',
    ],
  },
  {
    id: 'encircle',
    name: 'Encirclement',
    blurb: 'Close a loop and the stones inside are swept away.',
    rules: [
      'Five in a row still wins.',
      'Your stones also cut the surface: close a loop and the smaller side is inside it.',
      'Every enemy stone inside is swept off the board, freeing the tile.',
      'Sweep their last stone off the cube and you win outright.',
      'Split the cube exactly in half and neither side is inside — nothing is swept.',
    ],
  },
];

/** Not a mode: picks one of the three each time a game starts. */
export const RANDOM_MODE = {
  id: 'random',
  name: 'Roll the dice',
  blurb: 'A different mode every game, rematches included.',
};

export const DEFAULT_MODE = 'classic';

export function modeById(id) {
  return MODES.find((m) => m.id === id) || MODES[0];
}

/** Resolve a menu choice to a concrete mode for one game. */
export function resolveMode(choice, rng = Math.random) {
  if (choice !== RANDOM_MODE.id) return modeById(choice).id;
  return MODES[Math.floor(rng() * MODES.length)].id;
}
