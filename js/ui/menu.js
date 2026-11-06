// 3D menu system drawn on a single canvas panel: main menu, song library (BeatSaver), search with
// virtual keyboard, song details & difficulty, settings, how-to, loading, pause, results.
import { CSS_COLORS, DIFFICULTY_ORDER, DIFFICULTY_LABEL, VERSION } from '../core/config.js';
import { loadRemoteImage } from '../songs/loader.js';
import { DEMO_INFO } from '../songs/demo.js';

const W = 1280, H = 800;
const ROWS = 5;
const PLAYABLE_CHARACTERISTICS = ['OneSaber', 'Standard', 'NoArrows', 'Lawless', 'Legacy'];
const CHAR_LABEL = { OneSaber: 'Um Sabre', Standard: 'Padrão', NoArrows: 'Sem Setas', Lawless: 'Lawless', Legacy: 'Legado' };

const TABS = [
  { id: 'Rating', label: 'EM ALTA' },
  { id: 'Curated', label: 'CURADAS' },
  { id: 'Latest', label: 'RECENTES' },
  { id: 'search', label: 'BUSCAR' },
  { id: 'offline', label: 'OFFLINE' },
];

function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}
function fmtScore(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

export class Menu {
  constructor(panel, logoPanel, app) {
    this.panel = panel;
    this.logo = logoPanel;
    this.app = app;
    this.screen = 'main';
    this.history = [];
    this.lib = { tab: 'Rating', query: '', items: [], apiPage: -1, pages: 1, loading: false, error: null, view: 0, reqId: 0 };
    this.detail = null;
    this.loading = { title: '', step: '', progress: 0, cancel: null };
    this.error = { title: '', message: '' };
    this.results = null;
    this.countdown = 0;
    this.searchText = '';
    panel.setDraw(this.draw.bind(this));
    logoPanel.setDraw(this.drawLogo.bind(this));
  }

  invalidate() { this.panel.invalidate(); }

  go(screen, noHistory) {
    if (!noHistory && this.screen !== screen && ['loading', 'error', 'pause', 'results', 'countdown'].indexOf(this.screen) < 0) this.history.push(this.screen);
    this.screen = screen;
    if (screen !== 'detail') this.app.audio.stopPreview();
    if (screen === 'library' && this.lib.apiPage < 0 && this.lib.tab !== 'offline') this.fetchMore();
    this.panel.hoverId = null;
    this.invalidate();
  }

  back() {
    const s = this.screen;
    if (s === 'pause') { this.app.resumeGame(); return; }
    if (s === 'results' || s === 'loading' || s === 'countdown') return;
    const prev = this.history.pop() || 'main';
    this.go(prev, true);
  }

  // ---------------- library data ----------------
  setTab(tab) {
    if (tab === 'search') { this.go('search'); return; }
    this.lib = { tab: tab, query: '', items: [], apiPage: -1, pages: 1, loading: false, error: null, view: 0, reqId: this.lib.reqId + 1 };
    if (tab !== 'offline') this.fetchMore();
    this.invalidate();
  }

  runSearch(q) {
    this.lib = { tab: 'search', query: q, items: [], apiPage: -1, pages: 1, loading: false, error: null, view: 0, reqId: this.lib.reqId + 1 };
    this.fetchMore();
    this.go('library');
  }

  fetchMore() {
    const lib = this.lib;
    if (lib.loading || lib.tab === 'offline') return;
    const next = lib.apiPage + 1;
    if (next >= lib.pages && lib.apiPage >= 0) return;
    lib.loading = true;
    lib.error = null;
    const req = lib.reqId;
    const self = this;
    const order = lib.tab === 'search' ? 'Relevance' : lib.tab;
    this.app.beatsaver.search(lib.tab === 'search' ? lib.query : '', next, order).then(function (res) {
      if (self.lib.reqId !== req) return;
      lib.loading = false;
      lib.apiPage = next;
      lib.pages = res.pages;
      for (const m of res.maps) lib.items.push(m);
      self.invalidate();
    }, function (err) {
      if (self.lib.reqId !== req) return;
      lib.loading = false;
      lib.error = err.message || String(err);
      self.invalidate();
    });
  }

  libraryItems() {
    if (this.lib.tab === 'offline') return [DEMO_INFO];
    return this.lib.items;
  }

  pageBy(dir) {
    const items = this.libraryItems();
    const nv = this.lib.view + dir * ROWS;
    if (nv < 0) return;
    if (nv >= items.length) {
      if (this.lib.tab !== 'offline' && (this.lib.apiPage + 1 < this.lib.pages)) { this.fetchMore(); this.lib.view = nv; }
      this.invalidate();
      return;
    }
    this.lib.view = nv;
    if (nv + ROWS * 2 > items.length) this.fetchMore();
    this.invalidate();
  }

  openDetail(entry) {
    const chars = [];
    for (const c of PLAYABLE_CHARACTERISTICS) {
      if (entry.diffs.some(function (d) { return d.characteristic === c; })) chars.push(c);
    }
    const characteristic = chars[0] || null;
    this.detail = { entry: entry, chars: chars, characteristic: characteristic, difficulty: null };
    this.selectCharacteristic(characteristic);
    this.go('detail');
    if (entry.previewURL) this.app.audio.playPreview(entry.previewURL);
  }

  selectCharacteristic(c) {
    const d = this.detail;
    d.characteristic = c;
    const diffs = this.diffsFor(c);
    // default: Normal or the easiest available above it
    let pick = diffs.find(function (x) { return x.difficulty === 'Normal'; }) || diffs[0];
    d.difficulty = pick ? pick.difficulty : null;
    this.invalidate();
  }

  diffsFor(c) {
    if (!this.detail || !c) return [];
    return this.detail.entry.diffs
      .filter(function (d) { return d.characteristic === c; })
      .sort(function (a, b) { return DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty); });
  }

  // ---------------- screen helpers called by the app ----------------
  showLoading(title, cancel) {
    this.loading = { title: title, step: 'Preparando…', progress: 0, cancel: cancel };
    this.go('loading');
  }
  setLoading(step, progress) {
    this.loading.step = step;
    if (progress !== undefined) this.loading.progress = progress;
    this.invalidate();
  }
  showError(title, message) {
    this.error = { title: title, message: message };
    this.go('error');
  }
  showResults(r) { this.results = r; this.history = ['main', 'library']; if (this.detail) this.history.push('detail'); this.go('results', true); }
  showPause() { this.go('pause', true); }
  showCountdown(n) { this.countdown = n; if (this.screen !== 'countdown') this.go('countdown', true); else this.invalidate(); }

  // ---------------- drawing ----------------
  drawLogo(p) {
    const ctx = p.ctx;
    ctx.clearRect(0, 0, p.pxW, p.pxH);
    p.glowText('BEAT TAGGINGS', p.pxW / 2, 110, 118, '#ffffff', CSS_COLORS.purple, 'center');
    p.glowText('BEAT TAGGINGS', p.pxW / 2, 110, 118, 'rgba(199,125,255,0.0)', CSS_COLORS.note0, 'center');
    ctx.fillStyle = CSS_COLORS.purpleHot;
    ctx.fillRect(p.pxW / 2 - 300, 190, 600, 5);
    p.text('RITMO  ·  CORTE  ·  DESVIE', p.pxW / 2, 225, 34, CSS_COLORS.purpleHot, 'center', '800');
  }

  draw(p) {
    p.bg();
    switch (this.screen) {
      case 'main': this.drawMain(p); break;
      case 'library': this.drawLibrary(p); break;
      case 'search': this.drawSearch(p); break;
      case 'detail': this.drawDetail(p); break;
      case 'settings': this.drawSettings(p); break;
      case 'howto': this.drawHowTo(p); break;
      case 'posture': this.drawPosture(p); break;
      case 'loading': this.drawLoading(p); break;
      case 'error': this.drawError(p); break;
      case 'pause': this.drawPause(p); break;
      case 'results': this.drawResults(p); break;
      case 'countdown': this.drawCountdown(p); break;
      default: this.drawMain(p);
    }
  }

  header(p, title, backBtn) {
    p.glowText(title, W / 2, 62, 50, '#ffffff', CSS_COLORS.purple, 'center');
    if (backBtn !== false) p.button('back', 30, 28, 170, 68, '◀ VOLTAR', this.back.bind(this), { size: 28 });
  }

  drawMain(p) {
    const self = this, app = this.app;
    p.glowText('MENU PRINCIPAL', W / 2, 80, 46, '#ffffff', CSS_COLORS.purple, 'center');
    const bx = W / 2 - 300, bw = 600;
    p.button('play', bx, 150, bw, 130, 'JOGAR', function () { self.go('library'); }, { selected: true, accent: CSS_COLORS.purple, size: 64, sub: 'Biblioteca de músicas BeatSaver' });
    p.button('tutorial', bx, 305, bw, 92, 'TUTORIAL / OFFLINE', function () { self.openDetail(DEMO_INFO); }, { size: 36, sub: '"Neon Tag" — funciona sem internet' });
    p.button('settings', bx, 420, 290, 88, 'CONFIGURAÇÕES', function () { self.go('settings'); }, { size: 30 });
    p.button('howto', bx + 310, 420, 290, 88, 'COMO JOGAR', function () { self.go('howto'); }, { size: 30 });
    const vr = app.xrStatus();
    p.text(vr, W / 2, 560, 26, CSS_COLORS.dim, 'center', '600', 1100);
    p.text('Gatilho: selecionar  ·  Touchpad: mover / rolar  ·  Voltar: pausar / retornar', W / 2, 610, 26, CSS_COLORS.purpleHot, 'center', '600', 1180);
    p.text('Mapas da comunidade via BeatSaver (api.beatsaver.com) · v' + VERSION, W / 2, 740, 22, 'rgba(255,255,255,0.45)', 'center', '500');
  }

  drawLibrary(p) {
    const self = this;
    const lib = this.lib;
    this.header(p, lib.tab === 'search' ? 'BUSCA: "' + (lib.query || '') + '"' : 'BIBLIOTECA', true);
    // tabs
    const tw = 200, tx0 = W / 2 - (TABS.length * (tw + 12) - 12) / 2;
    TABS.forEach(function (t, i) {
      p.button('tab-' + t.id, tx0 + i * (tw + 12), 112, tw, 56, t.label, function () { self.setTab(t.id); }, { selected: lib.tab === t.id, size: 24 });
    });
    const items = this.libraryItems();
    const y0 = 186, rh = 104;
    for (let r = 0; r < ROWS; r++) {
      const idx = lib.view + r;
      const it = items[idx];
      if (!it) break;
      const y = y0 + r * (rh + 6);
      const hover = p.area('row-' + idx, 40, y, W - 80, rh, function () { self.openDetail(it); });
      p.rect(40, y, W - 80, rh, hover ? 'rgba(155,48,255,0.42)' : 'rgba(255,255,255,0.06)', 16);
      if (hover) { p.ctx.lineWidth = 3; p.ctx.strokeStyle = '#fff'; p.ctx.stroke(); }
      const img = it.coverURL ? loadRemoteImage(it.coverURL, function () { self.invalidate(); }) : null;
      p.image(img, 52, y + 8, rh - 16, rh - 16, 10);
      const tx = 52 + rh;
      p.text(it.title + (it.subTitle ? ' ' + it.subTitle : ''), tx, y + 30, 32, '#ffffff', 'left', '800', 760);
      p.text((it.artist || '—') + '  ·  mapa: ' + (it.mapper || '—'), tx, y + 66, 24, CSS_COLORS.dim, 'left', '600', 760);
      const right = W - 60;
      p.text(fmtDur(it.duration) + '  ·  ' + Math.round(it.bpm || 0) + ' BPM', right, y + 30, 24, CSS_COLORS.purpleHot, 'right', '700');
      const chips = this.diffChips(it);
      p.text(chips, right, y + 66, 22, '#ffffff', 'right', '600', 330);
    }
    if (!items.length || lib.view >= items.length) {
      let msg = 'Nada encontrado.';
      if (lib.loading) msg = 'Carregando músicas do BeatSaver…';
      else if (lib.error) msg = 'Erro: ' + lib.error;
      p.text(msg, W / 2, 400, 32, lib.error ? CSS_COLORS.bad : CSS_COLORS.dim, 'center', '700', 1100);
      if (lib.error) p.button('retry', W / 2 - 150, 450, 300, 80, 'TENTAR DE NOVO', function () { self.fetchMore(); self.invalidate(); }, { size: 28 });
    } else if (lib.loading) {
      p.text('carregando…', W - 60, 150, 20, CSS_COLORS.dim, 'right', '600');
    }
    // paging
    const pageNo = Math.floor(lib.view / ROWS) + 1;
    p.button('prev', 40, 730, 180, 56, '▲ ANTERIOR', function () { self.pageBy(-1); }, { size: 24, disabled: lib.view === 0 });
    p.button('next', W - 220, 730, 180, 56, 'PRÓXIMA ▼', function () { self.pageBy(1); }, { size: 24, disabled: lib.tab === 'offline' || (lib.view + ROWS >= items.length && lib.apiPage + 1 >= lib.pages) });
    p.text('Página ' + pageNo + '  ·  deslize no touchpad para rolar', W / 2, 758, 22, CSS_COLORS.dim, 'center', '600');
  }

  diffChips(it) {
    const set = {};
    it.diffs.forEach(function (d) { if (PLAYABLE_CHARACTERISTICS.indexOf(d.characteristic) >= 0) set[d.difficulty] = true; });
    const out = [];
    DIFFICULTY_ORDER.forEach(function (d) { if (set[d]) out.push(DIFFICULTY_LABEL[d]); });
    if (it.source === 'demo') return 'Fácil · Normal · Difícil';
    return out.join(' · ') || 'incompatível';
  }

  drawSearch(p) {
    const self = this;
    this.header(p, 'BUSCAR MÚSICA', true);
    p.rect(140, 120, W - 280, 80, 'rgba(255,255,255,0.1)', 16);
    p.text((this.searchText || '') + '_', 170, 160, 40, '#ffffff', 'left', '700', W - 340);
    const rows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL\'', 'ZXCVBNM-&.'];
    const kw = 98, kh = 84, gap = 8;
    rows.forEach(function (row, ri) {
      const x0 = W / 2 - (row.length * (kw + gap) - gap) / 2;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        p.button('key-' + ri + '-' + i, x0 + i * (kw + gap), 225 + ri * (kh + gap), kw, kh, ch, function () {
          if (self.searchText.length < 40) self.searchText += ch.toLowerCase();
          self.app.audio.play('click');
          self.invalidate();
        }, { size: 36 });
      }
    });
    const y = 225 + 4 * (kh + gap) + 6;
    p.button('space', W / 2 - 520, y, 330, 84, 'ESPAÇO', function () { self.searchText += ' '; self.invalidate(); }, { size: 30 });
    p.button('bksp', W / 2 - 175, y, 200, 84, '⌫ APAGAR', function () { self.searchText = self.searchText.slice(0, -1); self.invalidate(); }, { size: 28 });
    p.button('clear', W / 2 + 40, y, 180, 84, 'LIMPAR', function () { self.searchText = ''; self.invalidate(); }, { size: 28 });
    p.button('go', W / 2 + 235, y, 285, 84, 'BUSCAR ▶', function () { self.runSearch(self.searchText); }, { size: 32, selected: true });
  }

  drawDetail(p) {
    const self = this;
    const d = this.detail;
    if (!d) { this.go('library', true); return; }
    const e = d.entry;
    this.header(p, 'DETALHES', true);
    const img = e.coverURL ? loadRemoteImage(e.coverURL, function () { self.invalidate(); }) : null;
    p.image(img, 60, 120, 300, 300, 22);
    const x = 400;
    p.text(e.title, x, 145, 46, '#ffffff', 'left', '800', W - x - 50);
    if (e.subTitle) p.text(e.subTitle, x, 192, 28, CSS_COLORS.dim, 'left', '600', W - x - 50);
    p.text('Artista: ' + (e.artist || '—'), x, 238, 30, '#ffffff', 'left', '600', W - x - 50);
    p.text('Mapeador: ' + (e.mapper || '—'), x, 280, 28, CSS_COLORS.dim, 'left', '600', W - x - 50);
    p.text(Math.round(e.bpm || 0) + ' BPM  ·  ' + fmtDur(e.duration) + (e.source === 'beatsaver' ? '  ·  ' + Math.round((e.score || 0) * 100) + '% de aprovação' : ''), x, 322, 28, CSS_COLORS.purpleHot, 'left', '700', W - x - 50);
    if (e.source === 'beatsaver') p.text('BeatSaver #' + e.id, x, 362, 22, 'rgba(255,255,255,0.5)', 'left', '500');

    if (!d.chars.length) {
      p.text('Este mapa não tem modos compatíveis (somente 360°/90°/Lightshow).', W / 2, 520, 30, CSS_COLORS.bad, 'center', '700', 1150);
      return;
    }
    // characteristic toggles
    p.text('MODO', 60, 462, 24, CSS_COLORS.dim, 'left', '800');
    d.chars.forEach(function (c, i) {
      p.button('char-' + c, 150 + i * 200, 436, 190, 54, CHAR_LABEL[c] || c, function () { self.selectCharacteristic(c); }, { selected: d.characteristic === c, size: 24 });
    });
    // difficulties
    p.text('DIFICULDADE', 60, 540, 24, CSS_COLORS.dim, 'left', '800');
    const diffs = this.diffsFor(d.characteristic);
    const bw = Math.min(210, (W - 120) / Math.max(1, diffs.length) - 12);
    diffs.forEach(function (df, i) {
      const sub = (df.nps ? df.nps.toFixed(1) + ' n/s' : '') + (df.njs ? '  ·  vel ' + Math.round(df.njs) : '');
      p.button('diff-' + df.difficulty, 60 + i * (bw + 12), 562, bw, 86, DIFFICULTY_LABEL[df.difficulty] || df.label, function () { d.difficulty = df.difficulty; self.invalidate(); },
        { selected: d.difficulty === df.difficulty, size: 28, sub: sub || ' ' });
    });
    const best = this.app.highscores.get(e.id, d.characteristic, d.difficulty);
    p.text(best ? 'Recorde: ' + fmtScore(best.score) + ' (' + best.rank + ', ' + (best.accuracy * 100).toFixed(1) + '%)' : 'Sem recorde ainda', 60, 700, 26, CSS_COLORS.dim, 'left', '700');
    if (d.characteristic !== 'OneSaber' && this.app.settings.get('oneSaberFilter')) {
      p.text('Mapa de 2 mãos: notas simultâneas serão unidas para 1 sabre.', 60, 745, 22, 'rgba(255,255,255,0.5)', 'left', '500', 700);
    }
    p.button('start', W - 400, 670, 340, 110, 'JOGAR ▶', function () {
      self.app.audio.stopPreview();
      self.app.startSong(e, d.characteristic, d.difficulty);
    }, { selected: true, size: 48, disabled: !d.difficulty });
  }

  drawSettings(p) {
    const self = this;
    const s = this.app.settings;
    this.header(p, 'CONFIGURAÇÕES', true);
    const rows = [
      { label: 'Qualidade gráfica', value: { low: 'Baixa', medium: 'Média', high: 'Alta' }[s.get('quality')], cycle: function () {
        const order = ['low', 'medium', 'high'];
        s.set('quality', order[(order.indexOf(s.get('quality')) + 1) % 3]);
      }, hint: 'aplicada ao entrar no VR' },
      { label: 'Velocidade das notas', value: s.get('noteSpeed').toFixed(1) + 'x', dec: function () { s.set('noteSpeed', Math.max(0.6, Math.round((s.get('noteSpeed') - 0.1) * 10) / 10)); }, inc: function () { s.set('noteSpeed', Math.min(1.6, Math.round((s.get('noteSpeed') + 0.1) * 10) / 10)); } },
      { label: 'Direção do corte', value: s.get('strictDirection') ? 'Obrigatória' : 'Bônus', cycle: function () { s.set('strictDirection', !s.get('strictDirection')); } },
      { label: 'Modo um sabre (simplificar)', value: s.get('oneSaberFilter') ? 'Ligado' : 'Desligado', cycle: function () { s.set('oneSaberFilter', !s.get('oneSaberFilter')); } },
      { label: 'Sem falha (No Fail)', value: s.get('noFail') ? 'Ligado' : 'Desligado', cycle: function () { s.set('noFail', !s.get('noFail')); } },
      { label: 'Atraso do áudio', value: (s.get('audioOffsetMs') > 0 ? '+' : '') + s.get('audioOffsetMs') + ' ms', dec: function () { s.set('audioOffsetMs', Math.max(-300, s.get('audioOffsetMs') - 10)); }, inc: function () { s.set('audioOffsetMs', Math.min(300, s.get('audioOffsetMs') + 10)); } },
      { label: 'Volume da música', value: Math.round(s.get('musicVolume') * 100) + '%', dec: function () { s.set('musicVolume', Math.max(0, Math.round((s.get('musicVolume') - 0.1) * 10) / 10)); }, inc: function () { s.set('musicVolume', Math.min(1, Math.round((s.get('musicVolume') + 0.1) * 10) / 10)); } },
      { label: 'Volume dos efeitos', value: Math.round(s.get('sfxVolume') * 100) + '%', dec: function () { s.set('sfxVolume', Math.max(0, Math.round((s.get('sfxVolume') - 0.1) * 10) / 10)); }, inc: function () { s.set('sfxVolume', Math.min(1, Math.round((s.get('sfxVolume') + 0.1) * 10) / 10)); } },
      { label: 'Touchpad', value: s.get('moveMode') === 'absolute' ? 'Posição (volta ao centro)' : 'Deslizar contínuo', cycle: function () { s.set('moveMode', s.get('moveMode') === 'absolute' ? 'velocity' : 'absolute'); } },
      { label: 'Mostrar FPS', value: s.get('showFps') ? 'Ligado' : 'Desligado', cycle: function () { s.set('showFps', !s.get('showFps')); } },
      { label: 'Agachar / inclinar', value: { auto: 'Acelerômetro + cabeça', tilt: 'Inclinar a cabeça', touchpad: 'Touchpad (baixo)', off: 'Desligado' }[s.get('posture')], cycle: function () {
        const order = ['auto', 'tilt', 'touchpad', 'off'];
        s.set('posture', order[(order.indexOf(s.get('posture')) + 1) % order.length]);
      } },
      { label: 'Sensibilidade da postura', value: s.get('postureSens') < 0.85 ? 'Baixa' : s.get('postureSens') > 1.15 ? 'Alta' : 'Média', cycle: function () {
        const v = s.get('postureSens'); s.set('postureSens', v < 0.85 ? 1.0 : v > 1.15 ? 0.7 : 1.4);
      } },
      { label: 'Barreiras extras', value: s.get('extraBarriers') ? 'Ligado' : 'Desligado', cycle: function () { s.set('extraBarriers', !s.get('extraBarriers')); } },
    ];
    const y0 = 100, rh = 50;
    rows.forEach(function (r, i) {
      const y = y0 + i * rh;
      p.rect(40, y, W - 80, rh - 8, i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', 12);
      p.text(r.label, 70, y + (rh - 8) / 2, 25, '#ffffff', 'left', '700', 520);
      if (r.hint) p.text(r.hint, 70 + 270, y + (rh - 8) / 2 + 2, 17, CSS_COLORS.dim, 'left', '500');
      if (r.cycle) {
        p.button('set-' + i, 760, y + 1, 440, rh - 10, r.value, function () { r.cycle(); self.invalidate(); }, { size: 23 });
      } else {
        p.button('dec-' + i, 760, y + 1, 90, rh - 10, '−', function () { r.dec(); self.invalidate(); }, { size: 30 });
        p.text(r.value, 980, y + (rh - 8) / 2, 25, CSS_COLORS.purpleHot, 'center', '800');
        p.button('inc-' + i, 1110, y + 1, 90, rh - 10, '+', function () { r.inc(); self.invalidate(); }, { size: 30 });
      }
    });
    p.button('posture-test', W / 2 - 230, 742, 460, 50, 'TESTAR POSTURA / SENSORES', function () { self.go('posture'); }, { size: 22, selected: true });
  }

  drawHowTo(p) {
    this.header(p, 'COMO JOGAR', true);
    const lines = [
      ['Sabre', 'Seu único sabre roxo segue a ORIENTAÇÃO do controle (mão direita, 3DoF).'],
      ['Blocos coloridos', 'Corte no ritmo. A seta indica a direção ideal do golpe; ponto = qualquer direção.'],
      ['Pontos', 'Golpes rápidos e centralizados valem mais. Acertos seguidos sobem o multiplicador até x8.'],
      ['Blocos pretos', 'NÃO toque neles com o sabre. Paredes pretas: desvie o corpo com o touchpad.'],
      ['Touchpad', 'Toque à esquerda/direita para se mover lateralmente. Solte para voltar ao centro.'],
      ['Barreiras', 'Barra preta no alto: ABAIXE-SE (agache ou curve a cabeça). Parede lateral: desvie.'],
      ['Pausa', 'Botão Voltar ou segure o gatilho por 1 segundo durante a música.'],
      ['Energia', 'Erros e paredes drenam a barra. Se zerar, a música falha (a menos que No Fail esteja ligado).'],
      ['Recentralizar', 'Segure o botão Oculus do controle para recentralizar a visão e o sabre.'],
    ];
    lines.forEach(function (l, i) {
      const y = 135 + i * 72;
      p.text(l[0], 70, y, 30, CSS_COLORS.purpleHot, 'left', '800');
      p.text(l[1], 330, y, 25, '#ffffff', 'left', '600', 880);
    });
  }

  drawPosture(p) {
    const app = this.app;
    const pt = app.posture;
    this.header(p, 'TESTAR POSTURA', true);
    const xr = app.renderer.xr.isPresenting;
    p.text('Fonte ativa: ' + pt.source, W / 2, 140, 28, '#ffffff', 'center', '800', 1150);
    const accel = pt.accelActive ? 'RECEBENDO (' + pt.motionEvents + ' leituras)' : (pt.motionEvents ? 'parou de enviar' : 'sem dados do navegador');
    p.text('Acelerômetro: ' + accel, W / 2, 190, 26, pt.accelActive ? CSS_COLORS.good : CSS_COLORS.bad, 'center', '700', 1150);
    const rows = [
      ['Acel. vertical', pt.rawVert.toFixed(2) + ' m/s²'],
      ['Acel. lateral', pt.rawLat.toFixed(2) + ' m/s²'],
      ['Deslocamento vertical', (pt.dy * 100).toFixed(0) + ' cm'],
      ['Inclinação frente/trás', pt.pitchDeg.toFixed(0) + '°'],
      ['Inclinação lateral', pt.rollDeg.toFixed(0) + '°'],
    ];
    rows.forEach(function (r, i) {
      const y = 250 + i * 50;
      p.text(r[0], 200, y, 26, CSS_COLORS.dim, 'left', '700');
      p.text(r[1], 1080, y, 28, '#ffffff', 'right', '800');
    });
    p.text('AGACHAR', 200, 530, 28, CSS_COLORS.purpleHot, 'left', '800');
    p.bar(400, 516, 680, 30, pt.crouch, CSS_COLORS.note0);
    p.text('INCLINAR', 200, 590, 28, CSS_COLORS.purpleHot, 'left', '800');
    p.rect(400, 576, 680, 30, 'rgba(255,255,255,0.12)', 15);
    const cx = 740 + pt.lean * 330;
    p.rect(cx - 20, 572, 40, 38, CSS_COLORS.purpleHot, 12);
    p.text(xr ? 'Abaixe-se rápido / curve a cabeça para baixo, ou incline o corpo para os lados.' : 'No modo tela: S = agachar, Q/E = inclinar (os sensores funcionam dentro do VR).', W / 2, 670, 23, CSS_COLORS.dim, 'center', '600', 1150);
    p.text('Se o acelerômetro não chegar, o jogo usa a inclinação da cabeça automaticamente.', W / 2, 710, 21, 'rgba(255,255,255,0.5)', 'center', '500', 1150);
  }

  drawLoading(p) {
    const self = this;
    const l = this.loading;
    p.glowText('CARREGANDO', W / 2, 150, 60, '#ffffff', CSS_COLORS.purple, 'center');
    p.text(l.title, W / 2, 260, 36, '#ffffff', 'center', '800', 1100);
    p.text(l.step, W / 2, 340, 30, CSS_COLORS.dim, 'center', '600', 1100);
    if (l.progress >= 0) p.bar(190, 400, W - 380, 30, l.progress, CSS_COLORS.purpleHot);
    else p.bar(190, 400, W - 380, 30, 0.5 + 0.5 * Math.sin(Date.now() / 300), CSS_COLORS.purpleHot);
    if (l.cancel) p.button('cancel', W / 2 - 150, 520, 300, 84, 'CANCELAR', function () { l.cancel(); self.back(); }, { size: 30 });
  }

  drawError(p) {
    this.header(p, 'OPS!', true);
    p.text(this.error.title, W / 2, 260, 40, CSS_COLORS.bad, 'center', '800', 1100);
    const words = String(this.error.message || '').split(' ');
    let line = '', y = 340;
    const ctx = p.ctx;
    ctx.font = '600 28px sans-serif';
    for (const w of words) {
      if (ctx.measureText(line + w).width > 1000) { p.text(line, W / 2, y, 28, '#ffffff', 'center', '600'); y += 44; line = ''; }
      line += w + ' ';
    }
    if (line) p.text(line, W / 2, y, 28, '#ffffff', 'center', '600');
    p.button('err-ok', W / 2 - 150, 620, 300, 90, 'OK', this.back.bind(this), { selected: true, size: 36 });
  }

  drawPause(p) {
    const app = this.app;
    p.glowText('PAUSADO', W / 2, 120, 80, '#ffffff', CSS_COLORS.purple, 'center');
    const g = app.game;
    if (g && g.song) p.text(g.song.title + '  ·  ' + Math.round(g.progress * 100) + '%', W / 2, 210, 30, CSS_COLORS.dim, 'center', '700', 1100);
    const bx = W / 2 - 280, bw = 560;
    p.button('resume', bx, 270, bw, 120, 'CONTINUAR', function () { app.resumeGame(); }, { selected: true, size: 48 });
    p.button('restart', bx, 415, bw, 100, 'REINICIAR', function () { app.restartGame(); }, { size: 38 });
    p.button('quit', bx, 540, bw, 100, 'SAIR PARA O MENU', function () { app.quitGame(); }, { size: 38 });
  }

  drawCountdown(p) {
    p.glowText(String(this.countdown), W / 2, H / 2 - 20, 280, '#ffffff', CSS_COLORS.purple, 'center');
    p.text('Prepare o sabre…', W / 2, H - 160, 34, CSS_COLORS.dim, 'center', '700');
  }

  drawResults(p) {
    const app = this.app;
    const r = this.results;
    if (!r) return;
    p.glowText(r.failed ? 'FALHOU' : (r.fullCombo ? 'FULL COMBO!' : 'MÚSICA CONCLUÍDA'), W / 2, 70, 54, '#ffffff', r.failed ? CSS_COLORS.bad : CSS_COLORS.purple, 'center');
    p.text(r.title, W / 2, 128, 30, CSS_COLORS.dim, 'center', '700', 1100);
    // rank
    p.glowText(r.rank, 260, 330, 240, r.failed ? CSS_COLORS.bad : '#ffffff', r.failed ? '#7a0020' : CSS_COLORS.note0, 'center');
    p.text((r.accuracy * 100).toFixed(2) + '%', 260, 490, 44, CSS_COLORS.purpleHot, 'center', '800');
    if (r.newBest) p.glowText('NOVO RECORDE!', 260, 560, 36, '#ffffff', CSS_COLORS.note0, 'center');
    const stats = [
      ['Pontuação', fmtScore(r.score)],
      ['Combo máximo', String(r.maxCombo)],
      ['Acertos', r.hits + ' / ' + r.totalNotes],
      ['Erros', String(r.misses + r.badCuts)],
      ['Blocos pretos atingidos', String(r.bombsHit)],
      ['Paredes atingidas', String(r.wallHits)],
      ['Dificuldade', r.difficultyLabel || ''],
    ];
    stats.forEach(function (s, i) {
      const y = 190 + i * 62;
      p.rect(520, y - 26, 700, 54, i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)', 10);
      p.text(s[0], 545, y, 28, CSS_COLORS.dim, 'left', '700');
      p.text(s[1], 1195, y, 32, '#ffffff', 'right', '800');
    });
    p.button('again', 520, 650, 340, 100, 'JOGAR DE NOVO', function () { app.restartGame(); }, { selected: true, size: 32 });
    p.button('tomenu', 880, 650, 340, 100, 'BIBLIOTECA', function () { app.quitGame(); }, { size: 32 });
  }
}
