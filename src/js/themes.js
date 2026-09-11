/**
 * Three visual themes. A theme owns everything that makes the game look the
 * way it does: clear colour, board materials, the light rig, the optional
 * bloom pass, an ambient particle system, and the CSS custom properties the
 * HUD picks up. Switching one swaps all of it live, mid-game.
 */

export const THEMES = [
  {
    id: 'neon',
    name: 'Neon Circuit',
    tagline: 'Cold light on a black grid',
    background: 0x03060c,
    fog: { color: 0x03060c, near: 16, far: 52 },
    body: { color: 0x060a11, roughness: 0.5, metalness: 0.5, emissive: 0x000000, emissiveIntensity: 0 },
    tiles: {
      empty: { color: 0x7c93a8, roughness: 0.42, metalness: 0.2, emissive: 0x0d2836, emissiveIntensity: 0.35 },
      p1: { color: 0x16c8e8, roughness: 0.3, metalness: 0.25, emissive: 0x0e8ba6, emissiveIntensity: 0.7 },
      p2: { color: 0xff3d92, roughness: 0.3, metalness: 0.25, emissive: 0xc41c66, emissiveIntensity: 0.7 },
    },
    accent: 0xffe066,
    bloom: { strength: 0.32, radius: 0.65, threshold: 0.78 },
    ambience: 'stars',
    lights: [
      { type: 'ambient', color: 0x1b3550, intensity: 2.2 },
      { type: 'directional', color: 0xbfe9ff, intensity: 3.6, position: [6, 9, 8] },
      { type: 'directional', color: 0x8fa8ff, intensity: 1.2, position: [-8, -4, -6] },
      { type: 'point', color: 0x33e0ff, intensity: 60, position: [0, 0, 14], distance: 45 },
    ],
    ui: {
      bg: '#04060d', panel: 'rgba(10,18,30,0.78)', line: 'rgba(74,222,255,0.28)',
      text: '#cfe9f5', dim: '#6f8ea3', accent: '#22d3ee',
      p1: '#22d3ee', p2: '#ff2f87', glow: '0 0 18px rgba(34,211,238,0.55)',
    },
  },

  {
    id: 'sumi',
    name: 'Sumi-e',
    tagline: 'Ink and vermilion on rice paper',
    background: 0xe6dcc6,
    fog: { color: 0xe6dcc6, near: 20, far: 64 },
    body: { color: 0x6f6553, roughness: 0.95, metalness: 0.02, emissive: 0x000000, emissiveIntensity: 0 },
    tiles: {
      empty: { color: 0xf6efdf, roughness: 0.85, metalness: 0.02, emissive: 0x000000, emissiveIntensity: 0 },
      p1: { color: 0x15120f, roughness: 0.38, metalness: 0.1, emissive: 0x000000, emissiveIntensity: 0 },
      p2: { color: 0xc03a22, roughness: 0.5, metalness: 0.05, emissive: 0x3a0d04, emissiveIntensity: 0.2 },
    },
    accent: 0x9a6b1f,
    bloom: null,
    ambience: 'none',
    lights: [
      { type: 'hemisphere', sky: 0xfff8ea, ground: 0x8b8068, intensity: 3.2 },
      { type: 'directional', color: 0xfff3dd, intensity: 4.2, position: [7, 10, 6] },
      { type: 'directional', color: 0xcdbfa4, intensity: 1.3, position: [-6, 2, -8] },
    ],
    ui: {
      bg: '#e9e0cd', panel: 'rgba(250,245,234,0.86)', line: 'rgba(40,32,24,0.18)',
      text: '#221d16', dim: '#6d6252', accent: '#b8860b',
      p1: '#14110e', p2: '#c0392b', glow: '0 2px 14px rgba(60,48,32,0.18)',
    },
  },

  {
    id: 'magma',
    name: 'Magma Forge',
    tagline: 'Molten ore against cooled obsidian',
    background: 0x080402,
    fog: { color: 0x120704, near: 16, far: 50 },
    body: { color: 0x120c0a, roughness: 0.9, metalness: 0.2, emissive: 0x120301, emissiveIntensity: 1 },
    tiles: {
      empty: { color: 0x5a4a42, roughness: 0.92, metalness: 0.08, emissive: 0x1a0a04, emissiveIntensity: 0.5 },
      p1: { color: 0xff7a24, roughness: 0.35, metalness: 0.2, emissive: 0xd93f00, emissiveIntensity: 0.85 },
      p2: { color: 0xa855f7, roughness: 0.35, metalness: 0.2, emissive: 0x6d28d9, emissiveIntensity: 0.7 },
    },
    accent: 0xffd166,
    bloom: { strength: 0.42, radius: 0.7, threshold: 0.75 },
    ambience: 'embers',
    lights: [
      { type: 'ambient', color: 0x3a1b0d, intensity: 2.8 },
      { type: 'directional', color: 0xffc08a, intensity: 3.4, position: [5, 8, 7] },
      { type: 'point', color: 0xff5a00, intensity: 95, position: [0, -9, 0], distance: 34, flicker: true },
      { type: 'point', color: 0x8b5cf6, intensity: 55, position: [-7, 6, -7], distance: 36 },
      { type: 'directional', color: 0x9a7bff, intensity: 0.9, position: [-7, 1, -6] },
    ],
    ui: {
      bg: '#0a0503', panel: 'rgba(26,16,12,0.82)', line: 'rgba(255,140,60,0.26)',
      text: '#f3e2d2', dim: '#a3806a', accent: '#ff8a3c',
      p1: '#ff6a12', p2: '#a855f7', glow: '0 0 18px rgba(255,106,18,0.5)',
    },
  },
];

export const DEFAULT_THEME = 'neon';

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Push a theme's palette into CSS custom properties for the HUD. */
export function applyThemeToDocument(theme, root = document.documentElement) {
  const { ui } = theme;
  root.style.setProperty('--bg', ui.bg);
  root.style.setProperty('--panel', ui.panel);
  root.style.setProperty('--line', ui.line);
  root.style.setProperty('--text', ui.text);
  root.style.setProperty('--dim', ui.dim);
  root.style.setProperty('--accent', ui.accent);
  root.style.setProperty('--p1', ui.p1);
  root.style.setProperty('--p2', ui.p2);
  root.style.setProperty('--glow', ui.glow);
  root.dataset.theme = theme.id;
}
