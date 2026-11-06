// Beat Taggings — application bootstrap and state machine.
// States: menu | loading | countdown | playing | paused | results
import * as THREE from '../vendor/three.module.js';
import { LAYOUT, QUALITY_PRESETS, COLORS, DIFFICULTY_LABEL } from './core/config.js';
import { Settings, HighScores } from './core/settings.js';
import { makeTextures } from './render/textures.js';
import { Environment } from './render/environment.js';
import { Particles } from './render/particles.js';
import { Saber } from './render/saber.js';
import { ObjectRenderer } from './render/objects.js';
import { AudioEngine } from './audio/audio.js';
import { Input } from './input/input.js';
import { Game } from './gameplay/game.js';
import { CanvasPanel } from './ui/panel.js';
import { Menu } from './ui/menu.js';
import { Hud } from './ui/hud.js';
import { BeatSaverClient } from './songs/beatsaver.js';
import { downloadBinary, unpackPackage, loadDifficulty, bytesToImage } from './songs/loader.js';
import { adaptMap, generateBarriers } from './songs/mapparser.js';
import { PostureTracker } from './input/posture.js';
import { synthesizeDemoSong, generateDemoMap, DEMO_INFO } from './songs/demo.js';

const params = new URLSearchParams(window.location.search);
const DEBUG_AUTOPLAY = params.get('autoplay') === '1';

class App {
  constructor() {
    this.settings = new Settings();
    this.highscores = new HighScores();
    this.beatsaver = new BeatSaverClient();
    this.audio = new AudioEngine();
    this.audio.setVolumes(this.settings.get('musicVolume'), this.settings.get('sfxVolume'));
    this.state = 'menu';
    this.xrSupported = false;
    this.xrChecked = false;
    this.xrMode = 'none';
    this.fps = 72;
    this.loadToken = 0;
    this.cachedPackage = null; // { id, pkg, audioBuffer, cover }
    this.demoAudio = null;
    this.posture = new PostureTracker();
    this.headBaseY = 0; // 1.6 when the XR reference space is 'local' (eye level at origin)

    this._initRenderer();
    this._initScene();
    this._initUi();
    this._bindSettings();
    this._initDom();
    this.clock = new THREE.Clock();
    const self = this;
    this.renderer.setAnimationLoop(function () { self._frame(); });
  }

  quality() { return QUALITY_PRESETS[this.settings.get('quality')] || QUALITY_PRESETS.medium; }

  _initRenderer() {
    const canvas = document.getElementById('scene');
    const r = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality().pixelRatio));
    r.setSize(window.innerWidth, window.innerHeight);
    r.xr.enabled = true;
    r.outputEncoding = THREE.sRGBEncoding;
    r.setClearColor(COLORS.fog);
    this.renderer = r;
    const self = this;
    window.addEventListener('resize', function () {
      if (r.xr.isPresenting) return;
      self.camera.aspect = window.innerWidth / window.innerHeight;
      self.camera.updateProjectionMatrix();
      r.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initScene() {
    const q = this.quality();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 140);
    this.rig = new THREE.Group();          // moved sideways by the touchpad
    this.head = new THREE.Group();         // offsets 'local' reference spaces to standing height
    this.rig.add(this.head);
    this.head.add(this.camera);
    this.camera.position.set(0, LAYOUT.headHeight, 0);
    this.camera.rotation.x = -0.1;
    this.scene.add(this.rig);

    this.textures = makeTextures();
    this.env = new Environment(this.scene, this.textures, q);
    this.particles = new Particles(this.scene, this.textures.particle, q.particles);
    this.objects = new ObjectRenderer(this.scene, this.textures);
    this.saber = new Saber(this.rig, this.textures, this.particles, q);
    this.saber.attachWorld(this.scene);
    this.input = new Input(this.renderer, this.camera, this.rig, this.renderer.domElement);
    this.game = new Game({
      objects: this.objects, particles: this.particles, audio: this.audio, saber: this.saber,
      env: this.env, settings: this.settings, input: this.input,
    });
    const self = this;
    this.game.onFinish = function (r) { self._onFinish(r); };

    // Laser pointer + reticle for menus
    const laserGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 6, 1, true);
    laserGeo.translate(0, 0.5, 0);
    laserGeo.rotateX(Math.PI / 2); // along +Z (lookAt aims +Z at the target)
    this.laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: COLORS.purpleHot, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.laser.renderOrder = 40;
    this.scene.add(this.laser);
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures.reticle, color: 0xffffff, depthTest: false, fog: false }));
    this.reticle.scale.set(0.05, 0.05, 1);
    this.reticle.renderOrder = 41;
    this.scene.add(this.reticle);
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._head = new THREE.Vector3();
    this._aim = null;
    if (DEBUG_AUTOPLAY) {
      this.game.hitLog = [];
      this.input.autoAim = function (out) {
        if (self.state !== 'playing') return false;
        return self.game.autoAim(out, self.rig.position.x);
      };
    }
  }

  _initUi() {
    this.panel = new CanvasPanel(1280, 800, 2.4);
    this.panel.mesh.position.set(0, 1.45, -2.5);
    this.rig.add(this.panel.mesh);
    this.logoPanel = new CanvasPanel(1024, 256, 2.6, { transparent: true, passive: true });
    this.logoPanel.mesh.position.set(0, 2.55, -2.65);
    this.rig.add(this.logoPanel.mesh);
    this.menu = new Menu(this.panel, this.logoPanel, this);
    this.hud = new Hud(this.rig, this.camera);
    this.hud.setVisible(false);
    this.logoPanel.redrawIfDirty();
  }

  _bindSettings() {
    const self = this;
    this.settings.onChange(function (k) {
      if (k === 'musicVolume' || k === 'sfxVolume') self.audio.setVolumes(self.settings.get('musicVolume'), self.settings.get('sfxVolume'));
      if (k === 'quality') {
        const q = self.quality();
        self.env.setQuality(q);
        if (!self.renderer.xr.isPresenting) self.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
      }
    });
  }

  // ---------------- DOM overlay / WebXR session ----------------
  _initDom() {
    const self = this;
    this.dom = {
      overlay: document.getElementById('overlay'),
      status: document.getElementById('status'),
      vr: document.getElementById('btn-vr'),
      flat: document.getElementById('btn-flat'),
      corner: document.getElementById('corner'),
      cornerVr: document.getElementById('btn-corner-vr'),
      fps: document.getElementById('fps'),
    };
    this.dom.vr.addEventListener('click', function () { self.enterVR(); });
    this.dom.cornerVr.addEventListener('click', function () { self.enterVR(); });
    this.dom.flat.addEventListener('click', function () {
      try { self.audio.ensure(); } catch (e) { /* shown later */ }
      self.posture.start();
      self.dom.overlay.classList.add('hidden');
      self.dom.corner.classList.remove('hidden');
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.pauseGame(); });
    this.detectXR();
  }

  detectXR() {
    const self = this;
    const done = function (ok, mode) {
      self.xrChecked = true;
      self.xrSupported = ok;
      self.xrMode = mode;
      self.dom.vr.disabled = !ok;
      self.dom.cornerVr.classList.toggle('hidden', !ok);
      self.dom.status.textContent = ok
        ? (mode === 'webvr-polyfill' ? 'VR disponível (WebVR via polyfill). Toque em ENTRAR NO VR.' : 'VR disponível (WebXR). Toque em ENTRAR NO VR.')
        : 'Este navegador não oferece VR. Você pode jogar na tela com mouse/teclado.';
      self.menu.invalidate();
    };
    const tryXR = function (mode) {
      if (!navigator.xr || !navigator.xr.isSessionSupported) { done(false, 'none'); return; }
      navigator.xr.isSessionSupported('immersive-vr').then(function (ok) { done(!!ok, mode); }, function () { done(false, 'none'); });
    };
    if (navigator.xr) { tryXR('webxr'); return; }
    if (navigator.getVRDisplays) {
      // Older Oculus Browser builds: WebVR 1.1 only -> bridge to WebXR with the official polyfill.
      const s = document.createElement('script');
      s.src = 'vendor/webxr-polyfill.min.js';
      s.onload = function () {
        try { new window.WebXRPolyfill({ cardboard: false }); } catch (e) { /* ignore */ }
        tryXR('webvr-polyfill');
      };
      s.onerror = function () { done(false, 'none'); };
      document.head.appendChild(s);
      return;
    }
    done(false, 'none');
  }

  xrStatus() {
    if (this.renderer.xr.isPresenting) return 'Modo VR ativo (' + (this.refSpaceType || '') + ', 3DoF).';
    if (!this.xrChecked) return 'Verificando suporte a VR…';
    return this.xrSupported ? 'VR disponível — use o botão “Entrar no VR” na página.' : 'Modo tela: mouse = sabre, clique = selecionar, A/D = mover, Esc = pausar.';
  }

  async enterVR() {
    if (!this.xrSupported || this.renderer.xr.isPresenting) return;
    try { this.audio.ensure(); } catch (e) { /* ignore */ }
    this.posture.start();
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    } catch (e) {
      this.dom.status.textContent = 'Não foi possível iniciar o VR: ' + (e && e.message ? e.message : e);
      return;
    }
    try {
      let type = 'local-floor';
      try { await session.requestReferenceSpace('local-floor'); } catch (e) { type = 'local'; }
      this.refSpaceType = type;
      this.headBaseY = type === 'local' ? LAYOUT.headHeight : 0;
      this.head.position.y = this.headBaseY;
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      const q = this.quality();
      this.renderer.xr.setReferenceSpaceType(type);
      this.renderer.xr.setFramebufferScaleFactor(q.framebufferScale);
      await this.renderer.xr.setSession(session);
      const layer = session.renderState && session.renderState.baseLayer;
      if (layer && 'fixedFoveation' in layer) { try { layer.fixedFoveation = q.foveation; } catch (e) { /* ignore */ } }
      if (session.updateTargetFrameRate && session.supportedFrameRates) {
        const rates = Array.prototype.slice.call(session.supportedFrameRates);
        if (rates.indexOf(72) >= 0) session.updateTargetFrameRate(72).catch(function () { /* ignore */ });
      }
      const self = this;
      session.addEventListener('end', function () { self._onSessionEnd(); });
      session.addEventListener('visibilitychange', function () {
        if (session.visibilityState && session.visibilityState !== 'visible') self.pauseGame();
      });
      this.dom.overlay.classList.add('hidden');
      this.dom.corner.classList.add('hidden');
      this.saber.resetTrail();
      this.menu.invalidate();
    } catch (e) {
      this.dom.status.textContent = 'Erro ao configurar a sessão VR: ' + (e && e.message ? e.message : e);
      try { session.end(); } catch (e2) { /* ignore */ }
    }
  }

  _onSessionEnd() {
    this.pauseGame();
    this.headBaseY = 0;
    this.head.position.set(0, 0, 0);
    this.camera.position.set(0, LAYOUT.headHeight, 0);
    this.camera.rotation.set(-0.1, 0, 0);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.dom.overlay.classList.remove('hidden');
    this.dom.corner.classList.add('hidden');
    this.menu.invalidate();
  }

  // ---------------- Song flow ----------------
  async startSong(entry, characteristic, difficulty) {
    const token = ++this.loadToken;
    const self = this;
    const cancelled = function () { return token !== self.loadToken; };
    this.state = 'loading';
    this.menu.showLoading(entry.title, function () { self.loadToken++; self.state = 'menu'; });
    try {
      this.audio.ensure();
      let audioBuffer, map, njs, offset, bpm;
      if (entry.source === 'demo') {
        if (!this.demoAudio) {
          this.menu.setLoading('Sintetizando a música…', -1);
          await nextFrame();
          const synth = synthesizeDemoSong(32000);
          this.demoAudio = this.audio.bufferFromChannels(synth.channels, synth.sampleRate);
        }
        if (cancelled()) return;
        audioBuffer = this.demoAudio;
        map = generateDemoMap(difficulty);
        const d = DEMO_INFO.diffs.find(function (x) { return x.difficulty === difficulty; });
        njs = d ? d.njs : 12; offset = 0; bpm = DEMO_INFO.bpm;
      } else {
        let cached = this.cachedPackage && this.cachedPackage.id === entry.id ? this.cachedPackage : null;
        if (!cached) {
          if (!entry.downloadURL) throw new Error('Mapa sem link de download');
          this.menu.setLoading('Baixando mapa…', 0);
          const buf = await downloadBinary(entry.downloadURL, function (f, bytes) {
            if (!cancelled()) self.menu.setLoading('Baixando mapa… ' + (bytes / 1048576).toFixed(1) + ' MB', f >= 0 ? f * 0.7 : -1);
          });
          if (cancelled()) return;
          this.menu.setLoading('Descompactando…', 0.72);
          await nextFrame();
          const pkg = unpackPackage(buf);
          this.menu.setLoading('Decodificando áudio…', 0.8);
          await nextFrame();
          const ab = pkg.audioBytes.buffer.slice(pkg.audioBytes.byteOffset, pkg.audioBytes.byteOffset + pkg.audioBytes.byteLength);
          const decoded = await this.audio.decode(ab);
          if (cancelled()) return;
          cached = { id: entry.id, pkg: pkg, audioBuffer: decoded };
          pkg.audioBytes = null; // free memory
          this.cachedPackage = cached;
        }
        this.menu.setLoading('Lendo o mapa…', 0.95);
        await nextFrame();
        const diff = loadDifficulty(cached.pkg, characteristic, difficulty);
        audioBuffer = cached.audioBuffer;
        map = diff.map; njs = diff.njs || 10; offset = diff.offset; bpm = cached.pkg.info.bpm;
      }
      if (cancelled()) return;
      const oneSaber = this.settings.get('oneSaberFilter') && characteristic !== 'OneSaber';
      const allowCrouch = this.settings.get('posture') !== 'off';
      let adapted = adaptMap(map, { oneSaber: oneSaber, lateralLanes: LAYOUT.lateralRange / LAYOUT.laneWidth, allowCrouch: allowCrouch });
      if (this.settings.get('extraBarriers')) {
        adapted = generateBarriers(adapted, { bpm: bpm, allowCrouch: allowCrouch, endTime: audioBuffer.duration, seed: hashString(entry.id + difficulty) });
      }
      if (!adapted.notes.length && !adapted.walls.length) throw new Error('O mapa não tem notas jogáveis');
      this.current = { entry: entry, characteristic: characteristic, difficulty: difficulty };
      this.game.load({ title: entry.title, audioBuffer: audioBuffer, bpm: bpm, map: adapted, njs: njs, startBeatOffset: offset });
      this.game.song.title = entry.title;
      this._beginCountdown();
    } catch (e) {
      if (cancelled()) return;
      console.error(e);
      this.state = 'menu';
      this.menu.showError('Não foi possível carregar a música', e && e.message ? e.message : String(e));
    }
  }

  _beginCountdown() {
    this.state = 'countdown';
    this.countdownT = 3;
    this.menu.showCountdown(3);
    this.audio.play('beep');
    this.saber.ignite(true);
  }

  _startPlaying() {
    this.state = 'playing';
    this.saber.resetTrail();
    this.game.start();
    this.audio.play('go');
  }

  pauseGame() {
    if (this.state === 'playing') {
      this.game.pause();
      this.state = 'paused';
      this.menu.showPause();
    } else if (this.state === 'countdown' && this.resumeAfterCountdown) {
      this.state = 'paused';
      this.menu.showPause();
    }
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    // short countdown before resuming
    this.state = 'countdown';
    this.resumeAfterCountdown = true;
    this.countdownT = 2;
    this.menu.showCountdown(2);
    this.audio.play('beep');
  }

  restartGame() {
    if (!this.game.song) return;
    this.game.stop();
    this.resumeAfterCountdown = false;
    this._beginCountdown();
  }

  quitGame() {
    this.game.stop();
    this.resumeAfterCountdown = false;
    this.state = 'menu';
    this.menu.history = ['main'];
    this.menu.go(this.menu.detail ? 'detail' : 'library', true);
    this.menu.history = ['main', 'library'];
  }

  _onFinish(result) {
    const self = this;
    const c = this.current || {};
    result.title = this.game.song ? this.game.song.title : '';
    result.difficultyLabel = (DIFFICULTY_LABEL[c.difficulty] || c.difficulty || '') + (c.characteristic ? ' · ' + c.characteristic : '');
    if (!result.failed && c.entry) result.newBest = this.highscores.submit(c.entry.id, c.characteristic, c.difficulty, result);
    this.lastResult = result;
    this.state = 'finishing';
    setTimeout(function () {
      if (self.state !== 'finishing') return;
      self.state = 'results';
      self.objects.clearTransient();
      self.menu.showResults(result);
    }, 1600);
  }

  // ---------------- Frame ----------------
  _frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    const st = this.state;
    const inGame = st === 'playing' || st === 'countdown' || st === 'finishing';
    this.input.update(dt, inGame);

    // lateral movement (touchpad / keys)
    let target = 0;
    if (st === 'playing' || st === 'countdown') {
      const range = LAYOUT.lateralRange;
      if (DEBUG_AUTOPLAY && st === 'playing') {
        target = this.game.autoDodge(this.rig.position.x) * range;
      } else if (this.settings.get('moveMode') === 'velocity' && this.input.isXR) {
        target = Math.max(-range, Math.min(range, this.rig.position.x + this.input.touchX * 2.4 * dt));
      } else {
        target = this.input.touchActive ? this.input.touchX * range : 0;
      }
    }
    const k = Math.min(1, dt * 11);
    this.rig.position.x += (target - this.rig.position.x) * k;

    // posture: crouch (duck under overhead barriers) and lean
    const pmode = this.settings.get('posture');
    const touch = this.input;
    if (DEBUG_AUTOPLAY && st === 'playing') {
      this.posture.force(this.game.autoCrouch(), 0, dt);
    } else if (!this.input.isXR) {
      this.posture.force(pmode !== 'off' && this.input.crouchKey ? 1 : 0, pmode !== 'off' ? this.input.leanKey : 0, dt);
      this.posture.source = 'teclado (S = agachar, Q/E = inclinar)';
    } else {
      this.posture.update(dt, this.camera.quaternion, pmode, this.settings.get('postureSens'), { active: touch.touchActive, x: touch.touchX, y: touch.touchY });
    }
    const applyPosture = st === 'playing' || st === 'countdown' || st === 'finishing';
    const crouch = applyPosture ? this.posture.crouch : 0;
    const lean = applyPosture ? this.posture.lean : 0;
    this.head.position.set(lean * LAYOUT.leanMax, this.headBaseY - crouch * LAYOUT.crouchDrop, 0);
    const sp = LAYOUT.saberPivot;
    this.saber.group.position.set(sp.x + lean * LAYOUT.leanMax * 0.7, sp.y - crouch * LAYOUT.crouchDrop * 0.8, sp.z);
    this.rig.updateMatrixWorld(true);

    this.saber.update(dt, this.input.orientation);

    // head position for wall collisions
    this.camera.updateMatrixWorld();
    this._head.setFromMatrixPosition(this.camera.matrixWorld);

    const menuVisible = st === 'menu' || st === 'loading' || st === 'paused' || st === 'results' || st === 'countdown';
    this.panel.mesh.visible = menuVisible;
    this.logoPanel.mesh.visible = st === 'menu' || st === 'loading';
    this.hud.setVisible(st === 'playing' || st === 'paused' || st === 'countdown' || st === 'finishing');

    if (st === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT);
      if (n !== this.menu.countdown && n > 0) { this.menu.showCountdown(n); this.audio.play('beep'); }
      if (this.countdownT <= 0) {
        if (this.resumeAfterCountdown) { this.resumeAfterCountdown = false; this.state = 'playing'; this.game.resume(); }
        else this._startPlaying();
      }
    }

    if (st === 'playing') {
      this.game.update(dt, this._head);
      if (this.input.backPressed || this.input.triggerHeld > 1.0) { this.input.triggerHeld = -10; this.pauseGame(); }
      const ev = this.game.events;
      for (let i = 0; i < ev.length; i++) {
        if (ev[i] === 'miss' || ev[i] === 'bomb' || ev[i] === 'badcut') this.hud.flashDamage(0.35);
      }
      ev.length = 0;
    } else if (st === 'countdown' || st === 'paused' || st === 'finishing') {
      this.game.update(0, this._head); // keep objects drawn (frozen)
    }
    if (this.hud.group.visible) this.hud.update(dt, this.game, this.fps, this.settings.get('showFps'), this.posture.crouch, st === 'playing' ? this.game.upcomingBarrier() : null);
    if (this.menu.screen === 'posture' && st === 'menu') {
      this._postureRedraw = (this._postureRedraw || 0) + dt;
      if (this._postureRedraw > 0.1) { this._postureRedraw = 0; this.menu.invalidate(); }
    }

    // menus: pointer + click
    if (menuVisible && st !== 'countdown') {
      const hit = this.panel.raycast(this.input.pointerOrigin, this.input.pointerDir);
      if (hit) {
        if (this.panel.setPointer(hit.u, hit.v) && this.panel.hoverId) this.audio.play('hover');
        if (this.input.triggerPressed) {
          if (this.panel.click(hit.u, hit.v)) { this.audio.play('click'); this.input.haptic(0.3, 20); }
        }
      } else {
        this.panel.setPointer(null, null);
      }
      this._updateLaser(hit);
      if (this.input.swipe !== 0 && this.menu.screen === 'library') this.menu.pageBy(this.input.swipe > 0 ? 1 : -1);
      if (this.input.backPressed) { this.audio.play('click'); this.menu.back(); }
    } else {
      this.laser.visible = false;
      this.reticle.visible = false;
    }
    if (st === 'loading' && this.menu.loading.progress < 0) this.menu.invalidate();
    this.panel.redrawIfDirty();

    this.env.update(dt, st === 'playing' ? 2.2 : 0.6);
    this.objects.update(dt);
    this.particles.update(dt);
    if (this.dom.fps && this.settings.get('showFps')) this.dom.fps.textContent = Math.round(this.fps) + ' fps';

    this.renderer.render(this.scene, this.camera);
  }

  _updateLaser(hit) {
    const xr = this.renderer.xr.isPresenting;
    // In VR the laser comes out of the saber; on desktop the cursor is the mouse so only show the reticle.
    if (xr) {
      const len = hit ? hit.distance : 3;
      this.laser.visible = true;
      this.laser.position.copy(this.input.pointerOrigin);
      this._v1.copy(this.input.pointerOrigin).add(this.input.pointerDir);
      this.laser.lookAt(this._v1);
      this.laser.scale.set(1, 1, len);
    } else {
      this.laser.visible = false;
    }
    this.reticle.visible = !!hit;
    if (hit) this.reticle.position.copy(hit.point).addScaledVector(this.input.pointerDir, -0.01);
  }
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function nextFrame() {
  return new Promise(function (r) { setTimeout(r, 16); });
}

function showFatal(msg) {
  const el = document.getElementById('status');
  if (el) { el.textContent = 'Erro: ' + msg; el.classList.add('error'); }
}

window.addEventListener('error', function (e) { showFatal(e.message || 'erro desconhecido'); });
window.addEventListener('unhandledrejection', function (e) { showFatal((e.reason && e.reason.message) || String(e.reason)); });

try {
  const app = new App();
  window.__bt = app;
  document.body.classList.add('ready');
  if (params.get('demo')) {
    // e.g. ?demo=Normal&autoplay=1 — used by automated tests
    document.getElementById('overlay').classList.add('hidden');
    app.menu.openDetail(DEMO_INFO);
    app.startSong(DEMO_INFO, 'OneSaber', params.get('demo'));
  }
} catch (e) {
  console.error(e);
  showFatal(e && e.message ? e.message : String(e));
}
