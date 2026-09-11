import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${root}src/index.html`, 'utf8');

test('the CSP hash matches the inline import map', () => {
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(map, 'index.html must carry an inline import map');
  const hash = `sha256-${createHash('sha256').update(map[1], 'utf8').digest('base64')}`;
  const csp = html.match(/content="([^"]*Content-Security|[^"]*script-src[^"]*)"/);
  assert.ok(csp, 'index.html must carry a Content-Security-Policy');
  assert.ok(
    csp[1].includes(hash),
    `CSP script-src must allow the import map (expected ${hash}). ` +
    'Re-hash the import map after editing it, or Chromium will block it and the app will not boot.',
  );
});

test('the import map points at files that exist', (t) => {
  if (!existsSync(`${root}node_modules/three`)) {
    t.skip('dependencies are not installed');
    return;
  }
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const resolve = (p) => `${root}src/${p}`;
  assert.ok(existsSync(resolve(map.imports.three)), 'three build is missing');
  for (const addon of ['controls/OrbitControls.js', 'postprocessing/EffectComposer.js',
    'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js']) {
    assert.ok(existsSync(resolve(map.imports['three/addons/'] + addon)), `missing addon: ${addon}`);
  }
});
