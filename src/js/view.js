/**
 * three.js presentation of the cube board: tile meshes, themed materials and
 * lighting, pointer picking, and the camera work that matters most in this
 * game - swinging round to show you a move that landed on a face you were not
 * looking at.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FACES } from './cube.js';
import { EMPTY, P1, P2 } from './game.js';

const TILE = 0.9;        // tile width in world units (cell pitch is 1)
const TILE_DEPTH = 0.16;
const LIFT = 0.05;       // how far a tile stands proud of the cube body

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const shortestAngle = (a, b) => a + (((b - a + Math.PI) % (Math.PI * 2)) - Math.PI);

export class CubeView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(9, 8, 11);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.85;
    this.controls.autoRotateSpeed = 0.7;

    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.lightGroup = new THREE.Group();
    this.scene.add(this.lightGroup);
    this.ambienceGroup = new THREE.Group();
    this.scene.add(this.ambienceGroup);

    this.tiles = [];          // Mesh per cell id
    this.pops = new Map();    // cellId -> animation start time
    this.game = null;
    this.theme = null;
    this.interactive = false;
    this.hovered = -1;
    this.pickFilter = () => true;
    this.pickHandler = null;
    this.composer = null;
    this.flickerLights = [];
    this.twisting = null;
    this.flash = null;
    this.highlight = null;

    this.camTween = null;
    this._showcase = false;
    this._bias = false;
    this.radiusScale = 1;
    this.startedAt = performance.now();
    this.lastFrameAt = this.startedAt;

    this._buildDecorations();
    this._bindPointer();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------------------------------------------------------------- lifecycle

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.renderer.dispose();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    // Menu panels sit on the left, so shift the rendered scene to the right
    // rather than letting the cube hide behind them.
    const bias = this._bias && w > 820 ? 0.19 : 0;
    if (bias) this.camera.setViewOffset(w, h, -bias * w, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
  }

  set autoRotate(on) {
    this.controls.autoRotate = on;
  }

  /** Menu framing: cube off to one side and a little further away. */
  setShowcase(on) {
    if (this._showcase === on) return;
    this._showcase = on;
    this.radiusScale = on ? 1.14 : 1;
    this.setPanelBias(on);
    this.resetView(true);
  }

  /**
   * Shift the rendered scene right so a panel on the left does not cover the
   * board. Unlike setShowcase this leaves the camera where it is, so the
   * result card can appear beside the winning line instead of on top of it.
   */
  setPanelBias(on) {
    if (this._bias === on) return;
    this._bias = on;
    this.resize();
  }

  // -------------------------------------------------------------------- board

  /** Build tile meshes for a game. Safe to call again for a new board size. */
  setGame(game) {
    this.game = game;
    this._clearBoard();

    const n = game.size;
    const topo = game.topo;

    this.bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(n - 0.04, n - 0.04, n - 0.04),
      this.materials ? this.materials.body : new THREE.MeshStandardMaterial(),
    );
    this.boardGroup.add(this.bodyMesh);

    const geo = new THREE.BoxGeometry(TILE, TILE, TILE_DEPTH);
    this.tileGeometry = geo;
    const basis = new THREE.Matrix4();
    const uVec = new THREE.Vector3();
    const vVec = new THREE.Vector3();
    const nVec = new THREE.Vector3();

    for (let id = 0; id < topo.cellCount; id++) {
      const { f } = topo.decode(id);
      const face = FACES[f];
      uVec.fromArray(face.u);
      vVec.fromArray(face.v);
      nVec.fromArray(face.n);

      const mesh = new THREE.Mesh(geo, this.materials ? this.materials.empty : undefined);
      const p = topo.lattice(id);
      mesh.position.set(p[0] * 0.5, p[1] * 0.5, p[2] * 0.5)
        .addScaledVector(nVec, LIFT);
      mesh.quaternion.setFromRotationMatrix(basis.makeBasis(uVec, vVec, nVec));
      mesh.userData.cellId = id;
      mesh.userData.face = f;
      mesh.userData.normal = nVec.clone();
      mesh.userData.home = { position: mesh.position.clone(), quaternion: mesh.quaternion.clone() };
      this.boardGroup.add(mesh);
      this.tiles[id] = mesh;
    }

    this.winLine.geometry.setFromPoints([]);
    this.winLine.visible = false;
    this.winRings.clear();
    this.marker.visible = false;
    this.refresh();
    this.resetView(false);
  }

  _clearBoard() {
    for (const mesh of this.tiles) if (mesh) this.boardGroup.remove(mesh);
    this.tiles = [];
    this.pops.clear();
    this.hovered = -1;
    if (this.bodyMesh) {
      this.boardGroup.remove(this.bodyMesh);
      this.bodyMesh.geometry.dispose();
      this.bodyMesh = null;
    }
    if (this.tileGeometry) {
      this.tileGeometry.dispose();
      this.tileGeometry = null;
    }
  }

  /** Reusable overlays: the last-move outline and the winning-line polyline. */
  _buildDecorations() {
    const half = TILE / 2;
    const ring = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, -half, TILE_DEPTH / 2 + 0.02),
      new THREE.Vector3(half, -half, TILE_DEPTH / 2 + 0.02),
      new THREE.Vector3(half, half, TILE_DEPTH / 2 + 0.02),
      new THREE.Vector3(-half, half, TILE_DEPTH / 2 + 0.02),
    ]);
    this.markerMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true });
    this.ringGeometry = ring;
    this.marker = new THREE.LineLoop(ring, this.markerMaterial);
    this.marker.visible = false;
    this.marker.renderOrder = 2;
    this.scene.add(this.marker);

    this.winMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true });
    this.winLine = new THREE.Line(new THREE.BufferGeometry(), this.winMaterial);
    this.winLine.visible = false;
    this.winLine.renderOrder = 3;
    this.scene.add(this.winLine);

    this.winRings = new THREE.Group();
    this.scene.add(this.winRings);
  }

  // ------------------------------------------------------------ twisting

  /**
   * Animate a layer through its quarter turn. The tiles are reparented to a
   * pivot and rotated bodily, so the stones visibly travel to the cells they
   * now occupy; at the end each tile snaps back to its resting transform and
   * the board is repainted from the new state.
   */
  startTwist(move, onDone) {
    if (!this.game) { if (onDone) onDone(); return; }
    const ids = this.game.topo.twistLayer(move.axis, move.layer);
    const pivot = new THREE.Group();
    this.boardGroup.add(pivot);
    for (const id of ids) if (this.tiles[id]) pivot.attach(this.tiles[id]);

    const axis = new THREE.Vector3();
    axis.setComponent(move.axis, 1);
    this.marker.visible = false;
    this.winLine.visible = false;
    this.winRings.clear();
    this.setHighlight(null);
    this.twisting = {
      pivot, ids, axis,
      angle: (move.dir > 0 ? 1 : -1) * Math.PI / 2,
      t: 0, duration: 0.55, onDone,
    };
  }

  get busy() {
    return !!this.twisting;
  }

  /** Light up one twist layer so the player can see what they are about to turn. */
  setHighlight(layer) {
    if (!this.game) return;
    const same = (a, b) => (!a && !b) || (a && b && a.axis === b.axis && a.layer === b.layer);
    if (same(this.highlight, layer)) return;
    this.highlight = layer;
    this.refresh();
  }

  /** Briefly light the cells a sweep has just cleared. */
  flashCells(ids) {
    if (!ids || !ids.length) return;
    this.flash = { ids: [...ids], start: this.now(), duration: 0.75 };
    for (const id of ids) this.popCell(id);
  }

  /** Pull every tile's appearance from the current game state. */
  refresh() {
    if (!this.game || !this.materials) return;
    const g = this.game;
    for (let id = 0; id < this.tiles.length; id++) {
      const mesh = this.tiles[id];
      if (!mesh) continue;
      const state = g.cells[id];
      mesh.material = state === P1 ? this.materials.p1
        : state === P2 ? this.materials.p2
          : this.materials.empty;
    }

    if (g.winningLine) {
      const pts = g.winningLine.map((id) => {
        const m = this.tiles[id];
        return m.position.clone().addScaledVector(m.userData.normal, TILE_DEPTH / 2 + 0.03);
      });
      this.winLine.geometry.dispose();
      this.winLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.winLine.visible = true;
      this.winRings.clear();
      for (const id of g.winningLine) {
        const tile = this.tiles[id];
        tile.material = g.winner === P1 ? this.materials.win1 : this.materials.win2;
        const ring = new THREE.LineLoop(this.ringGeometry, this.winMaterial);
        ring.position.copy(tile.position);
        ring.quaternion.copy(tile.quaternion);
        ring.scale.setScalar(1.06);
        ring.renderOrder = 3;
        this.winRings.add(ring);
      }
    } else {
      this.winLine.visible = false;
      this.winRings.clear();
    }

    if (this.highlight) {
      for (const id of this.game.topo.twistLayer(this.highlight.axis, this.highlight.layer)) {
        if (this.tiles[id] && g.cells[id] === EMPTY) this.tiles[id].material = this.materials.preview;
      }
    }
    if (this.flash) {
      for (const id of this.flash.ids) if (this.tiles[id]) this.tiles[id].material = this.materials.flash;
    }

    if (g.lastMove >= 0 && this.tiles[g.lastMove]) {
      const m = this.tiles[g.lastMove];
      this.marker.position.copy(m.position);
      this.marker.quaternion.copy(m.quaternion);
      this.marker.visible = true;
    } else {
      this.marker.visible = false;
    }
  }

  /** Kick off the drop animation for a freshly placed stone. */
  popCell(id) {
    this.pops.set(id, this.now());
  }

  /** Seconds since the view was created. */
  now() {
    return (performance.now() - this.startedAt) / 1000;
  }

  // -------------------------------------------------------------------- theme

  setTheme(theme) {
    this.theme = theme;
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog = theme.fog
      ? new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far)
      : null;

    const make = (spec, extra = {}) => new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      emissive: spec.emissive ?? 0x000000,
      emissiveIntensity: spec.emissiveIntensity ?? 0,
      ...extra,
    });

    if (this.materials) for (const m of Object.values(this.materials)) m.dispose();
    this.materials = {
      body: make(theme.body),
      empty: make(theme.tiles.empty),
      p1: make(theme.tiles.p1),
      p2: make(theme.tiles.p2),
      hover: make(theme.tiles.empty, {
        emissive: new THREE.Color(theme.accent),
        emissiveIntensity: 0.75,
      }),
      win1: make(theme.tiles.p1),
      win2: make(theme.tiles.p2),
      flash: make(theme.tiles.empty, {
        emissive: new THREE.Color(theme.accent),
        emissiveIntensity: 1.6,
      }),
      preview: make(theme.tiles.empty, {
        emissive: new THREE.Color(theme.accent),
        emissiveIntensity: 0.5,
      }),
    };

    this.markerMaterial.color.set(theme.accent);
    this.winMaterial.color.set(theme.accent);

    if (this.bodyMesh) this.bodyMesh.material = this.materials.body;
    this._buildLights(theme);
    this._buildAmbience(theme);
    this._buildComposer(theme);
    this.refresh();
  }

  _buildLights(theme) {
    this.lightGroup.clear();
    this.flickerLights = [];
    for (const spec of theme.lights) {
      let light;
      if (spec.type === 'ambient') light = new THREE.AmbientLight(spec.color, spec.intensity);
      else if (spec.type === 'hemisphere') light = new THREE.HemisphereLight(spec.sky, spec.ground, spec.intensity);
      else if (spec.type === 'point') light = new THREE.PointLight(spec.color, spec.intensity, spec.distance ?? 0, 2);
      else light = new THREE.DirectionalLight(spec.color, spec.intensity);
      if (spec.position) light.position.fromArray(spec.position);
      if (spec.flicker) this.flickerLights.push({ light, base: spec.intensity });
      this.lightGroup.add(light);
    }
  }

  _buildAmbience(theme) {
    this.ambienceGroup.clear();
    this.ambience = null;
    if (theme.ambience === 'stars') {
      const count = 900;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = 45 + Math.random() * 55;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.cos(ph);
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(g, new THREE.PointsMaterial({
        color: 0x9fe8ff, size: 0.38, sizeAttenuation: true, transparent: true, opacity: 0.7, fog: false,
      }));
      this.ambienceGroup.add(points);
      this.ambience = { kind: 'stars', points };
    } else if (theme.ambience === 'embers') {
      const count = 260;
      const pos = new Float32Array(count * 3);
      const speed = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const r = 11 + Math.random() * 18;
        const th = Math.random() * Math.PI * 2;
        pos[i * 3] = Math.cos(th) * r;
        pos[i * 3 + 1] = -14 + Math.random() * 30;
        pos[i * 3 + 2] = Math.sin(th) * r;
        speed[i] = 0.6 + Math.random() * 1.4;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(g, new THREE.PointsMaterial({
        color: 0xff8c3c, size: 0.13, sizeAttenuation: true, transparent: true,
        opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      this.ambienceGroup.add(points);
      this.ambience = { kind: 'embers', points, speed };
    }
  }

  /** Bloom, when the theme asks for it. Falls back to plain rendering. */
  async _buildComposer(theme) {
    this.composer = null;
    if (!theme.bloom) return;
    const wanted = theme.id;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
      ]);
      if (!this.theme || this.theme.id !== wanted) return; // theme changed while loading
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new UnrealBloomPass(size, theme.bloom.strength, theme.bloom.radius, theme.bloom.threshold));
      composer.addPass(new OutputPass());
      composer.setSize(size.x, size.y);
      this.composer = composer;
    } catch (err) {
      console.warn('bloom unavailable, rendering without it', err);
    }
  }

  // ------------------------------------------------------------------ picking

  onPick(handler) {
    this.pickHandler = handler;
  }

  /** `filter(cellId)` decides which cells highlight and accept a click. */
  setInteractive(on, filter = () => true) {
    this.interactive = on;
    this.pickFilter = filter;
    if (!on) this._setHover(-1);
  }

  _bindPointer() {
    this.raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downAt = null;

    const toNdc = (ev) => {
      const rect = this.canvas.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      return ndc;
    };

    const hit = (ev) => {
      if (!this.tiles.length) return -1;
      this.raycaster.setFromCamera(toNdc(ev), this.camera);
      const targets = this.bodyMesh ? [...this.tiles, this.bodyMesh] : this.tiles;
      const hits = this.raycaster.intersectObjects(targets, false);
      if (!hits.length) return -1;
      const first = hits[0];
      // Tiles do not quite touch, so a click can land in the grout between
      // them. Fall back to whichever cell the point on the cube body sits in.
      return first.object === this.bodyMesh
        ? this._cellAtPoint(first.point)
        : first.object.userData.cellId;
    };

    this.canvas.addEventListener('pointerdown', (ev) => {
      downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      if (!this.interactive || this.twisting) return;
      const id = hit(ev);
      this._setHover(id >= 0 && this.pickFilter(id) ? id : -1);
    });

    this.canvas.addEventListener('pointerleave', () => this._setHover(-1));

    this.canvas.addEventListener('pointerup', (ev) => {
      if (!downAt) return;
      const dragged = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6;
      const held = performance.now() - downAt.t > 550;
      downAt = null;
      if (dragged || held || !this.interactive || this.twisting) return;
      const id = hit(ev);
      if (id >= 0 && this.pickFilter(id) && this.pickHandler) this.pickHandler(id);
    });
  }

  /** Which cell a point on the cube surface belongs to, or -1 if it misses. */
  _cellAtPoint(point) {
    if (!this.game) return -1;
    const n = this.game.size;
    const p = [point.x, point.y, point.z];
    const abs = p.map(Math.abs);
    const axis = abs.indexOf(Math.max(...abs));
    const sign = Math.sign(p[axis]) || 1;
    const face = FACES.find((f) => f.axis === axis && f.sign === sign);
    if (!face) return -1;
    const along = (basis) => p[0] * basis[0] + p[1] * basis[1] + p[2] * basis[2];
    const clamp = (k) => Math.min(n - 1, Math.max(0, Math.floor(k + n / 2)));
    return this.game.topo.id(face.index, clamp(along(face.v)), clamp(along(face.u)));
  }

  _setHover(id) {
    if (this.hovered === id) return;
    if (this.hovered >= 0 && this.tiles[this.hovered] && this.game
        && this.game.cells[this.hovered] === EMPTY) {
      this.tiles[this.hovered].material = this.materials.empty;
    }
    this.hovered = id;
    if (id >= 0 && this.tiles[id]) this.tiles[id].material = this.materials.hover;
    this.canvas.style.cursor = id >= 0 ? 'pointer' : 'default';
  }

  // ------------------------------------------------------------------- camera

  /** Swing the camera round so a given cell faces the viewer. */
  focusCell(id, duration = 0.75, pullBack = 1) {
    const mesh = this.tiles[id];
    if (!mesh) return;
    const face = FACES[mesh.userData.face];
    const dir = mesh.userData.normal.clone()
      .addScaledVector(new THREE.Vector3().fromArray(face.u), 0.46)
      .addScaledVector(new THREE.Vector3().fromArray(face.v), 0.32)
      .normalize();
    this._tweenCameraTo(dir, duration, pullBack);
  }

  /** The default three-faces-visible angle. */
  resetView(animated = true) {
    const dir = new THREE.Vector3(0.72, 0.56, 0.95).normalize();
    this._tweenCameraTo(dir, animated ? 0.6 : 0);
  }

  _tweenCameraTo(dir, duration, pullBack = 1) {
    const n = this.game ? this.game.size : 5;
    const radius = (n * 2.05 + 4.2) * this.radiusScale * pullBack;
    const target = dir.multiplyScalar(radius);
    if (duration <= 0) {
      this.camera.position.copy(target);
      this.controls.update();
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position);
    const to = new THREE.Spherical().setFromVector3(target);
    to.theta = shortestAngle(from.theta, to.theta);
    this.camTween = { from, to, t: 0, duration };
  }

  _stepCamera(dt) {
    if (!this.camTween) return;
    const tw = this.camTween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const k = easeOut(tw.t);
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(tw.from.radius, tw.to.radius, k),
      THREE.MathUtils.lerp(tw.from.phi, tw.to.phi, k),
      THREE.MathUtils.lerp(tw.from.theta, tw.to.theta, k),
    );
    this.camera.position.setFromSpherical(s);
    this.camera.lookAt(0, 0, 0);
    if (tw.t >= 1) this.camTween = null;
  }

  // -------------------------------------------------------------------- frame

  _frame() {
    const stamp = performance.now();
    const dt = Math.min((stamp - this.lastFrameAt) / 1000, 0.1);
    this.lastFrameAt = stamp;
    const now = (stamp - this.startedAt) / 1000;

    this._stepCamera(dt);
    if (!this.camTween) this.controls.update();

    if (this.twisting) {
      const tw = this.twisting;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      tw.pivot.setRotationFromAxisAngle(tw.axis, tw.angle * easeOut(tw.t));
      if (tw.t >= 1) {
        for (const id of tw.ids) {
          const mesh = this.tiles[id];
          if (!mesh) continue;
          this.boardGroup.attach(mesh);
          mesh.position.copy(mesh.userData.home.position);
          mesh.quaternion.copy(mesh.userData.home.quaternion);
          mesh.scale.setScalar(1);
        }
        this.boardGroup.remove(tw.pivot);
        this.twisting = null;
        this.refresh();
        if (tw.onDone) tw.onDone();
      }
    }

    if (this.flash && now - this.flash.start > this.flash.duration) {
      this.flash = null;
      this.refresh();
    }

    // stone drop animation
    if (this.pops.size) {
      for (const [id, start] of this.pops) {
        const mesh = this.tiles[id];
        if (!mesh) { this.pops.delete(id); continue; }
        const k = (now - start) / 0.28;
        if (k >= 1) {
          mesh.scale.setScalar(1);
          this.pops.delete(id);
        } else {
          mesh.scale.setScalar(0.35 + 0.75 * easeOut(k) - 0.1 * Math.sin(Math.PI * k));
        }
      }
    }

    // winning line and its stones breathe
    if (this.game && this.game.winningLine) {
      const pulse = 0.6 + 0.4 * Math.sin(now * 3.4);
      this.winMaterial.opacity = 0.55 + 0.45 * pulse;
      const base1 = this.theme.tiles.p1.emissiveIntensity ?? 0;
      const base2 = this.theme.tiles.p2.emissiveIntensity ?? 0;
      // The gold outline and the polyline are what mark the winning run, so
      // the stones only need a light shimmer. Boosted harder they blow out to
      // white and lose the colour that says whose line it is.
      this.materials.win1.emissiveIntensity = base1 + pulse * 0.22;
      this.materials.win2.emissiveIntensity = base2 + pulse * 0.22;
    }
    if (this.marker.visible) {
      this.markerMaterial.opacity = 0.55 + 0.45 * Math.sin(now * 2.6);
    }

    for (const { light, base } of this.flickerLights) {
      light.intensity = base * (0.82 + 0.18 * Math.sin(now * 7.3) * Math.sin(now * 3.1));
    }

    if (this.ambience?.kind === 'stars') {
      this.ambience.points.rotation.y += dt * 0.01;
    } else if (this.ambience?.kind === 'embers') {
      const attr = this.ambience.points.geometry.attributes.position;
      const arr = attr.array;
      for (let i = 0; i < this.ambience.speed.length; i++) {
        arr[i * 3 + 1] += dt * this.ambience.speed[i];
        arr[i * 3] += Math.sin(now * 0.7 + i) * dt * 0.12;
        if (arr[i * 3 + 1] > 16) arr[i * 3 + 1] = -16;
      }
      attr.needsUpdate = true;
    }

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}

/**
 * How squarely a cell faces the camera: 1 is dead-on, <= 0 is round the back.
 * The controller uses it to decide whether an incoming move needs the camera
 * swung round to be seen at all.
 */
CubeView.prototype.cellVisibility = function cellVisibility(id) {
  const mesh = this.tiles[id];
  if (!mesh) return 1;
  const toCamera = this.camera.position.clone().sub(mesh.position).normalize();
  return mesh.userData.normal.dot(toCamera);
};
