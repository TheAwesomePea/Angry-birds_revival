/* Angry Birds — juego de prueba construido sobre BirdJS */
(function () {
  'use strict';
  const { Body, World, Assets, Audio, Camera, Input, Loop, Particles, Storage, Util: U } = BirdJS;
  const $ = (id) => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d');

  /* ---------------- constantes ---------------- */
  const S = 0.7;            // escala de bloques y cerdos
  const BS = 0.8;           // escala de pájaros
  const VIEW_H = 720;       // alto visible del mundo
  const GY = 620;           // y del suelo
  const WORLD_W = 2500;
  const OX = -330;          // desplazamiento horizontal de las estructuras
  const SX = 250, SY = GY - 112; // ancla de la resortera
  const MAXD = 100, KPOW = 9.5, GRAV = 850;
  const FONT = "'Arial Black', Impact, 'Segoe UI', sans-serif";
  const TAU = Math.PI * 2;

  const MAT = {
    wood: { d: 0.8, f: 0.6, e: 0.1, K: 380, pts: 500, col: ['#b8742c', '#8a5220', '#d9953f'], col_: 'wood_collision_a', dm: 'wood_damage_a', ds: 'wood_destroyed_a' },
    ice: { d: 0.5, f: 0.3, e: 0.08, K: 260, pts: 400, col: ['#9fd4ee', '#cfeefa', '#6bb4da'], col_: 'ice_light_collision_a', dm: 'light_damage_a', ds: 'light_destroyed_a' },
    stone: { d: 1.8, f: 0.7, e: 0.05, K: 900, pts: 800, col: ['#9a9a9a', '#6f6f6f', '#c0c0c0'], col_: 'rock_collision_a', dm: 'rock_damage_a', ds: 'rock_destroyed_a' },
    tnt: { d: 0.7, f: 0.5, e: 0.1, K: 60, pts: 1000, col: ['#c33', '#fff', '#a22'], col_: 'wood_collision_a', dm: 'wood_damage_a', ds: 'wood_destroyed_a' },
  };
  const BIRDS = {
    red: { r: 15, d: 2.0, snd: '01', name: 'Red' },
    blue: { r: 11, d: 2.0, snd: '02', name: 'Blues' },
    chuck: { r: 15, d: 2.0, snd: '03', name: 'Chuck' },
    bomb: { r: 21, d: 2.4, snd: '04', name: 'Bomb' },
    matilda: { r: 23, d: 2.0, snd: '05', name: 'Matilda' },
    hal: { r: 18, d: 2.0, snd: '01', name: 'Hal' },
    terence: { r: 33, d: 2.4, snd: '01', name: 'Terence' },
  };
  const PIGS = {
    small: { w: 48, K: 240 }, medium: { w: 78, K: 280 }, helmet: { w: 93, K: 650 },
    large: { w: 98, K: 330 }, grandpa: { w: 110, K: 380 }, king: { w: 126, K: 480 },
  };

  /* ---------------- estado ---------------- */
  const world = new World({ gy: GRAV, iterations: 10 });
  const cam = new Camera(); cam.maxX = WORLD_W;
  const fx = new Particles();
  const G = {
    screen: 'loading', state: 'idle', level: 0, score: 0, queue: [], cur: null, curType: null,
    flying: [], armed: false, paused: false, debug: false, t: 0, calmT: 0, turnT: 0, winT: -1, loseT: -1,
    dragging: false, panning: false, drag: { x: SX, y: SY }, loadAnim: null, pigs: 0, stars: [0, 0, 0], thr: [0, 0],
    totalBirds: 0, soundCD: {}, endless: false, endlessWave: 0, waveScore: 0, worldOffset: 0, slingX: SX, rollAnim: null, lastBirdType: 'red',
  };
  let saved = Storage.get('progress', { stars: [] });
  saved.best = saved.best || []; saved.seen = saved.seen || {};
  let token = 0;

  /* ---------------- utilidades de sonido ---------------- */
  function sfx(prefix, vol, jitter) {
    const now = performance.now(), cd = G.soundCD;
    if (cd[prefix] && now - cd[prefix] < 70) return;
    cd[prefix] = now;
    Audio.any(prefix, { vol: vol == null ? 1 : vol, jitter: jitter || 0.06 });
  }

  /* ---------------- construcción de niveles ---------------- */
  const D = (mat, kind) => { const im = Assets.img(mat + '_' + kind + '_0'); return { w: im.width * S, h: im.height * S }; };
  let blocks = 0, pigPts = 0, blockPts = 0;

  function B(mat, kind, cx, bottom, rot) {
    const m = MAT[mat], d = D(mat, kind), w = d.w, h = d.h;
    const effH = rot ? w : h, cy = bottom - effH / 2;
    const o = { x: cx + OX + G.worldOffset, y: cy, a: rot ? Math.PI / 2 : 0, density: m.d, friction: m.f, restitution: m.e, kind: 'block' };
    let b;
    if (kind === 'circ') { o.a = 0; o.angDamp = 0.4; b = Body.circle(Object.assign(o, { r: w / 2 * 0.97 })); }
    else if (kind === 'tri') b = Body.triangle(w * 0.98, h * 0.98, o);
    else b = Body.box(w, h, o);
    b.userData = { type: 'block', mat, kind, w, h, imgs: [mat + '_' + kind + '_0', mat + '_' + kind + '_1', mat + '_' + kind + '_2'], hp: b.mass * m.K, maxHp: b.mass * m.K, stage: 0, flash: 0 };
    world.add(b); blocks++; blockPts += m.pts;
    return bottom - effH;
  }
  function tnt(cx, bottom) {
    const im = Assets.img('tnt'), w = im.width * S, h = im.height * S, m = MAT.tnt;
    const b = Body.box(w, h, { x: cx + OX + G.worldOffset, y: bottom - h / 2, density: m.d, friction: m.f, restitution: m.e, kind: 'block' });
    b.userData = { type: 'block', mat: 'tnt', kind: 'tnt', w, h, imgs: ['tnt', 'tnt', 'tnt'], hp: b.mass * m.K, maxHp: b.mass * m.K, stage: 0, flash: 0 };
    world.add(b); blocks++; blockPts += m.pts; return bottom - h;
  }
  function pig(type, cx, bottom) {
    const P = PIGS[type], im = Assets.img('pig_' + type + '_0'), w = im.width * S, h = im.height * S, r = w * 0.4;
    const b = Body.circle({ x: cx + OX + G.worldOffset, y: bottom - r, r, density: 0.9, friction: 0.7, restitution: 0.1, angDamp: 1.6, kind: 'pig' });
    b.userData = { type: 'pig', pt: type, w, h, hp: b.mass * P.K, maxHp: b.mass * P.K, slot: 0, blink: U.rand(1, 4), blinkT: 0, react: 0, oink: U.rand(5, 14), flash: 0 };
    world.add(b); G.pigs++; pigPts += 5000;
  }
  // casa de varios pisos: postes + techo
  function house(x, bottom, cfg) {
    let y = bottom;
    for (const f of cfg.floors) {
      const mat = f.mat || cfg.mat, pk = f.post || 'short', ph = D(mat, pk).w, span = f.span || 90;
      B(mat, pk, x - span / 2, y, true); B(mat, pk, x + span / 2, y, true);
      if (f.pig) pig(f.pig, x, y);
      if (f.tnt) tnt(x, y);
      const rw = D(mat, 'plank').w;
      if (span + 14 <= rw) B(mat, 'plank', x, y - ph, false);
      else { B(mat, 'plank', x - rw / 2 + 6, y - ph, false); B(mat, 'plank', x + rw / 2 - 6, y - ph, false); }
      y -= ph + D(mat, 'plank').h;
    }
    return y;
  }

  const LEVELS = [
    { name: 'First Flight', birds: ['red', 'red', 'red'], build() {
      const t = house(1300, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }] });
      B('wood', 'tri', 1300, t, false); pig('small', 1520, GY);
    } },
    { name: 'Twin Houses', birds: ['red', 'red', 'red', 'red'], build() {
      house(1150, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }] });
      house(1400, GY, { mat: 'wood', floors: [{ post: 'plank', pig: 'small' }, { post: 'short' }] });
    } },
    { name: 'Ice Palace', birds: ['red', 'blue', 'blue', 'red'], build() {
      const t = house(1300, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'medium' }, { post: 'short', pig: 'small' }] });
      B('ice', 'tri', 1300, t, false); pig('small', 1560, GY);
    } },
    { name: 'Stone Base', birds: ['red', 'chuck', 'chuck', 'bomb', 'red'], build() {
      house(1250, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }, { post: 'short' }] });
      house(1500, GY, { mat: 'stone', floors: [{ post: 'short', pig: 'helmet', span: 100 }, { post: 'short', mat: 'wood', pig: 'small' }] });
    } },
    { name: 'TNT Bridge', birds: ['chuck', 'bomb', 'red', 'matilda', 'blue'], build() {
      const a = house(1180, GY, { mat: 'wood', floors: [{ post: 'plank' }] });
      const b = house(1470, GY, { mat: 'ice', floors: [{ post: 'plank' }] });
      pig('medium', 1180, a); pig('small', 1445, b); B('stone', 'cube', 1498, b, false);
      tnt(1325, tnt(1325, GY));
      pig('small', 1650, GY);
    } },
    { name: 'Frozen Fortress', birds: ['blue', 'blue', 'chuck', 'matilda', 'red', 'red'], build() {
      const t = house(1350, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'medium' }, { post: 'short', pig: 'small' }] });
      B('ice', 'tri', 1350, t, false);
      house(1100, GY, { mat: 'ice', floors: [{ post: 'short', pig: 'small' }] });
      pig('helmet', 1620, GY);
    } },
    { name: 'Stone Castle', birds: ['bomb', 'bomb', 'matilda', 'terence', 'red', 'chuck'], build() {
      house(1350, GY, { mat: 'stone', floors: [{ post: 'plank', pig: 'grandpa', span: 100 }, { post: 'short', pig: 'helmet' }, { post: 'short', mat: 'wood', pig: 'small' }] });
      house(1110, GY, { mat: 'stone', floors: [{ post: 'plank', pig: 'large', span: 100 }] });
      house(1600, GY, { mat: 'wood', floors: [{ post: 'plank', pig: 'medium', tnt: false }] });
    } },
    { name: 'King Pig', birds: ['terence', 'hal', 'chuck', 'bomb', 'matilda', 'red', 'blue'], build() {
      const t = house(1450, GY, { mat: 'stone', floors: [{ post: 'plank', pig: 'king', span: 112 }, { post: 'plank', mat: 'wood', pig: 'large', span: 100 }, { post: 'short', mat: 'ice', pig: 'helmet' }] });
      B('ice', 'tri', 1450, t, false);
      house(1150, GY, { mat: 'wood', floors: [{ post: 'plank', pig: 'medium' }] });
      house(1750, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'small' }] });
      tnt(1300, GY); tnt(1600, GY);
    } },
    { name: 'Timber Tower', birds: ['red', 'chuck', 'red', 'blue'], build() {
      const y = house(1370, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }, { post: 'short', pig: 'medium' }, { post: 'plank', pig: 'small' }] });
      B('wood', 'tri', 1370, y, false); pig('small', 1630, GY); tnt(1190, GY);
    } },
    { name: 'Glass Garden', birds: ['blue', 'blue', 'red', 'chuck'], build() {
      house(1250, GY, { mat: 'ice', floors: [{ post: 'short', pig: 'small' }, { post: 'plank', pig: 'medium' }] });
      house(1510, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'small' }, { post: 'short', pig: 'small' }] });
      B('ice', 'tri', 1380, GY - 155, false);
    } },
    { name: 'The Long Bridge', birds: ['chuck', 'red', 'bomb', 'blue', 'red'], build() {
      house(1150, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }] });
      house(1550, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'medium' }] });
      B('wood', 'plank', 1350, GY - 84, false); B('wood', 'plank', 1350, GY - 126, false);
      pig('small', 1350, GY - 126); tnt(1350, GY); pig('small', 1740, GY);
    } },
    { name: 'Rocky Ridge', birds: ['terence', 'red', 'chuck', 'bomb', 'red'], build() {
      house(1370, GY, { mat: 'stone', floors: [{ post: 'short', pig: 'helmet', span: 105 }, { post: 'plank', pig: 'medium', span: 105 }] });
      house(1110, GY, { mat: 'stone', floors: [{ post: 'plank', pig: 'small', span: 100 }] }); pig('large', 1630, GY); tnt(1510, GY);
    } },
    { name: 'Piggy Pyramid', birds: ['blue', 'blue', 'chuck', 'red', 'bomb'], build() {
      house(1370, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }, { post: 'short', pig: 'medium' }, { post: 'short', pig: 'helmet' }] });
      B('wood', 'tri', 1370, GY - 250, false); pig('small', 1190, GY); pig('small', 1550, GY);
    } },
    { name: 'TNT Trouble', birds: ['chuck', 'bomb', 'red', 'matilda', 'blue', 'red'], build() {
      house(1280, GY, { mat: 'wood', floors: [{ post: 'plank', pig: 'medium' }, { post: 'short', pig: 'small' }] }); house(1530, GY, { mat: 'ice', floors: [{ post: 'short', pig: 'helmet' }] });
      tnt(1160, GY); tnt(1405, GY); tnt(1650, GY); pig('small', 1780, GY);
    } },
    { name: 'Fortress in the Clouds', birds: ['blue', 'blue', 'matilda', 'chuck', 'bomb', 'red'], build() {
      const y = house(1400, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'small' }, { post: 'plank', pig: 'medium' }, { post: 'short', pig: 'helmet' }] });
      B('ice', 'tri', 1400, y, false); house(1120, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }] }); pig('large', 1650, GY);
    } },
    { name: 'The Heavyweight', birds: ['terence', 'terence', 'bomb', 'chuck', 'red', 'matilda'], build() {
      house(1390, GY, { mat: 'stone', floors: [{ post: 'plank', pig: 'king', span: 112 }, { post: 'short', pig: 'grandpa', span: 105 }] });
      house(1120, GY, { mat: 'stone', floors: [{ post: 'short', pig: 'large', span: 100 }] }); house(1650, GY, { mat: 'wood', floors: [{ post: 'plank', pig: 'medium' }] }); tnt(1510, GY);
    } },
    { name: 'Crosswind', birds: ['hal', 'blue', 'chuck', 'matilda', 'red', 'bomb'], build() {
      house(1200, GY, { mat: 'wood', floors: [{ post: 'plank', pig: 'small' }, { post: 'short', pig: 'medium' }] }); house(1510, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'helmet' }, { post: 'short', pig: 'small' }] });
      B('stone', 'cube', 1360, GY - 170, false); pig('small', 1700, GY);
    } },
    { name: 'Three Little Forts', birds: ['red', 'blue', 'chuck', 'bomb', 'red', 'matilda'], build() {
      house(1120, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'small' }] }); house(1380, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'medium' }] });
      house(1640, GY, { mat: 'stone', floors: [{ post: 'short', pig: 'helmet', span: 100 }] }); tnt(1250, GY); tnt(1510, GY);
    } },
    { name: 'King Pig’s Keep', birds: ['terence', 'bomb', 'chuck', 'hal', 'matilda', 'blue', 'red'], build() {
      const y = house(1420, GY, { mat: 'stone', floors: [{ post: 'plank', pig: 'king', span: 115 }, { post: 'plank', pig: 'grandpa', span: 108 }, { post: 'short', mat: 'wood', pig: 'helmet' }] });
      B('stone', 'tri', 1420, y, false); house(1130, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'large' }] }); house(1730, GY, { mat: 'wood', floors: [{ post: 'short', pig: 'medium' }] }); tnt(1280, GY); tnt(1590, GY);
    } },
    { name: 'Final Fling', birds: ['terence', 'hal', 'bomb', 'matilda', 'chuck', 'blue', 'red', 'red'], build() {
      house(1180, GY, { mat: 'stone', floors: [{ post: 'plank', pig: 'large', span: 106 }, { post: 'short', pig: 'helmet', span: 100 }] });
      const y = house(1460, GY, { mat: 'ice', floors: [{ post: 'plank', pig: 'king', span: 115 }, { post: 'short', pig: 'grandpa', span: 105 }] });
      B('ice', 'tri', 1460, y, false); house(1740, GY, { mat: 'wood', floors: [{ post: 'plank', pig: 'medium' }, { post: 'short', pig: 'small' }] }); tnt(1320, GY); tnt(1600, GY); pig('small', 1850, GY);
    } },
  ];

  const slingX = () => G.endless ? G.slingX : SX;

  /* ---------------- birds ---------------- */
  const THEMES = [
    { amb: 'amb_jungle', tint: null }, { amb: 'amb_savannah', tint: '#ffe6c2' },
    { amb: 'amb_dryforest', tint: '#cfe4ff' }, { amb: 'amb_construction', tint: null },
    { amb: 'amb_city', tint: '#d9dde8' }, { amb: 'amb_dryforest', tint: '#c4dcff' },
    { amb: 'amb_city', tint: '#ffc9a8' }, { amb: 'amb_savannah', tint: '#f0a89c' },
  ];
  LEVELS.forEach((L, i) => Object.assign(L, THEMES[i % THEMES.length]));
  const MENU_MUSIC = 'amb_construction';

  function makeBird(type, x, y, vx, vy, group) {
    const t = BIRDS[type];
    const b = Body.circle({ x, y, r: t.r, density: t.d, friction: 0.8, restitution: 0.2, angDamp: 0.9, rollResist: 4, linDamp: 0, group: group || 0, kind: 'bird', vx, vy });
    b.userData = { type: 'bird', bt: type, age: 0, still: 0, used: false, hit: false, fuse: -1, fade: -1, w: Assets.img('bird_' + type).width * BS, h: Assets.img('bird_' + type).height * BS };
    world.add(b); return b;
  }
  function birdSprite(type) { return Assets.img('bird_' + type); }

  function loadNextBird() {
    if (!G.queue.length) { G.cur = null; return; }
    const type = G.queue.shift();
    G.curType = type; G.cur = null;
    const from = { x: slingX() - 60, y: GY - BIRDS[type].r };
    G.loadAnim = { t: 0, from, type };
    G.state = 'loading';
    sfx('bird_next_military_a', 0.8, 0);
  }

  function launch() {
    const type = G.curType, d = G.drag; G.lastBirdType = type;
    const vx = (slingX() - d.x) * KPOW, vy = (SY - d.y) * KPOW;
    const b = makeBird(type, d.x, d.y, vx, vy, 0);
    G.flying = [b]; G.cur = null; G.curType = null; G.state = 'flying'; G.turnT = 0; G.calmT = 0; G.follow = true;
    sfx('bird_shot-a', 1, 0.04);
    setTimeout(() => sfx('bird_' + BIRDS[type].snd + '_flying', 0.6, 0.04), 80);
    updateBirdCount();
  }

  function ability(b) {
    const u = b.userData; if (!u || u.used || u.dead) return;
    u.used = true;
    if (u.bt === 'red' || u.bt === 'terence') { sfx('redbird_yell0', 0.9, 0.05); return; }
    if (u.bt === 'blue') {
      sfx('bird_02_select', 0.8);
      const g = b.id; b.group = g;
      for (const s of [-0.28, 0.28]) {
        const c = Math.cos(s), si = Math.sin(s);
        const nb = makeBird('blue', b.x, b.y + s * 20, b.vx * c - b.vy * si, b.vx * si + b.vy * c, g);
        nb.userData.used = true; G.flying.push(nb);
      }
      fx.burst(b.x, b.y, 8, { color: ['#7cc8ff', '#fff'], size: 4, life: 0.4, gravity: 0, maxSpeed: 120 });
    } else if (u.bt === 'chuck') {
      sfx('special_boost', 1);
      const sp = Math.hypot(b.vx, b.vy) || 1, ns = Math.max(sp * 2.2, 1250);
      b.vx = b.vx / sp * ns; b.vy = b.vy / sp * ns;
      fx.burst(b.x, b.y, 10, { color: ['#ffe14a', '#fff'], size: 4, life: 0.4, gravity: 0, maxSpeed: 200 });
    } else if (u.bt === 'bomb') { explodeBird(b); }
    else if (u.bt === 'matilda') {
      sfx('bird_pushing_egg_out', 1);
      const egg = Body.circle({ x: b.x, y: b.y + 14, r: 10, density: 2, friction: 0.5, restitution: 0.2, kind: 'egg', vx: b.vx * 0.3, vy: 120, group: b.id });
      egg.userData = { type: 'egg', age: 0 };
      b.group = b.id; world.add(egg);
      b.vy = -460; b.vx = b.vx * 1.15;
    } else if (u.bt === 'hal') {
      sfx('boomerang_activate', 1);
      b.vx = -b.vx * 0.95; b.vy = Math.min(b.vy * 0.2, 0) - 140;
    }
  }

  /* ---------------- explosiones y daños ---------------- */
  function explode(x, y, radius, dmg, snd) {
    sfx(snd || 'tnt_box_explodes', 1, 0.03);
    const hits = world.explode(x, y, radius, 650);
    for (const { body, k } of hits) hurt(body, dmg * k, true);
    fx.burst(x, y, 22, { color: ['#ffd23a', '#ff8a1f', '#fff3b0'], size: 11, life: 0.55, gravity: -40, maxSpeed: radius * 2.2, drag: 3, grow: 14 });
    fx.burst(x, y, 14, { color: ['#555', '#777', '#999'], size: 12, life: 0.9, gravity: -60, maxSpeed: radius * 1.2, drag: 2, grow: 10, alpha: 0.7 });
    shake = Math.max(shake, 10);
  }
  function explodeBird(b) {
    if (b.userData.dead) return; b.userData.dead = true; world.remove(b);
    explode(b.x, b.y, 135, 1300000);
  }
  let shake = 0;

  function popup(x, y, pts, col) { G.score += pts; G.waveScore += pts; fx.text(x, y, String(pts), { color: col || '#fff', size: 24 }); $('score').textContent = G.score.toLocaleString('en-US'); }

  function hurt(b, amt, force) {
    const u = b.userData; if (!u || u.dead || u.hp === undefined) return;
    u.hp -= amt; u.flash = 0.18;
    if (u.hp <= 0) { kill(b); return; }
    const ratio = u.hp / u.maxHp;
    if (u.type === 'block') {
      const st = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;
      if (st > u.stage) { u.stage = st; sfx(MAT[u.mat].dm, 0.9); popup(b.x, b.y - 10, 100, '#ffe'); }
    } else if (u.type === 'pig') {
      u.react = 0.6; sfx('piglette_damage_a', 0.9);
    }
  }
  function kill(b) {
    const u = b.userData; if (u.dead) return; u.dead = true; world.remove(b);
    if (u.type === 'block') {
      const m = MAT[u.mat];
      sfx(m.ds, 1, 0.05);
      fx.burst(b.x, b.y, 12, { color: m.col, size: 7, life: 0.9, shape: 'rect', maxSpeed: 260, up: 120, gravity: 900 });
      popup(b.x, b.y - 14, m.pts, '#fff');
      if (u.mat === 'tnt') explode(b.x, b.y, 150, 1500000);
    } else if (u.type === 'pig') {
      sfx('piglette_destroyed', 1);
      fx.burst(b.x, b.y, 16, { color: ['#8de35a', '#c9f59b', '#fff'], size: 9, life: 0.7, maxSpeed: 240, gravity: 200, drag: 2 });
      fx.burst(b.x, b.y, 8, { color: ['#eee', '#ccc'], size: 12, life: 0.8, maxSpeed: 120, gravity: -30, drag: 2, grow: 10, alpha: 0.8 });
      popup(b.x, b.y - 20, 5000, '#9f6');
      G.pigs--;
    }
  }

  const THR = { block: 120, pig: 90 };
  world.onImpact = (A, B2, imp, cl, x, y, isNew) => {
    if (!G.armed) return;
    const ua = A.userData, ub = B2.userData;
    if (ua && ua.dead || ub && ub.dead) return;
    const vol = U.clamp(cl / 500, 0.2, 1);
    // huevo de Matilda
    for (const [e, o] of [[A, B2], [B2, A]]) {
      if (e.userData && e.userData.type === 'egg' && !e.userData.dead && (cl > 40 || isNew)) {
        e.userData.dead = true; world.remove(e); sfx('special_egg_explosion', 1);
        explode(e.x, e.y, 100, 1000000, 'special_egg_explosion'); return;
      }
    }
    // sonidos
    for (const b of [A, B2]) {
      const u = b.userData; if (!u || cl < 60) continue;
      if (u.type === 'block') sfx(MAT[u.mat].col_, vol * 0.8);
      else if (u.type === 'pig') sfx('piglette_collision_a', vol);
      else if (u.type === 'bird') {
        const nowT = performance.now(); if (!u.sndT || nowT - u.sndT > 250) { u.sndT = nowT; Audio.any('bird_' + BIRDS[u.bt].snd + '_collision_a', { vol, jitter: 0.05 }); }
      }
    }
    // marcar golpe en pájaros
    for (const b of [A, B2]) { const u = b.userData; if (u && u.type === 'bird' && cl > 60) { u.hit = true; if (u.bt === 'bomb' && u.fuse < 0) u.fuse = 1.2; } }
    // daños
    for (const [b, o] of [[A, B2], [B2, A]]) {
      const u = b.userData; if (!u || u.hp === undefined) continue;
      const thr = u.type === 'pig' ? THR.pig : THR.block;
      if (cl < thr) continue;
      const ou = o.userData;
      const k = o.static ? 0.5 : ou && ou.type === 'bird' ? 1 : 0.7;
      hurt(b, imp * k);
    }
  };

  /* ---------------- niveles: carga ---------------- */
  function startLevel(i, options = {}) {
    G.level = i; const L = LEVELS[i];
    if (!G.endless) { G.worldOffset = 0; G.slingX = SX; }
    const keepScore = !!options.keepScore, previousScore = G.score;
    world.clear(); fx.list.length = 0; fx.texts.length = 0;
    world.add(Body.box(WORLD_W + 4000, 300, { x: G.worldOffset + WORLD_W / 2, y: GY + 150, static: true, friction: 0.8, restitution: 0.05, kind: 'ground' }).setStatic());
    world.add(Body.box(100, 4000, { x: G.worldOffset - 50, y: GY - 1500, static: true }).setStatic());
    G.pigs = 0; blocks = 0; pigPts = 0; blockPts = 0; G.armed = false; G.score = keepScore ? previousScore : 0; G.waveScore = 0;
    L.build();
    for (let k = 0; k < 150; k++) world.step(1 / 120);
    G.armed = true;
    G.queue = L.birds.slice();
    if (G.endless) { const extra = Math.min(10, Math.floor((G.endlessWave - 1) / 2)); const pool = ['red','blue','chuck','bomb','matilda','hal','terence']; for (let n = 0; n < extra; n++) G.queue.push(pool[(G.endlessWave + n) % pool.length]); }
    G.totalBirds = G.queue.length; G.flying = []; G.cur = null; G.curType = null;
    G.winT = -1; G.loseT = -1; G.paused = false;
    G.thr = [pigPts + 0.3 * blockPts, pigPts + 0.5 * blockPts + 10000 * Math.max(1, G.queue.length - 2)];
    $('score').textContent = G.score.toLocaleString('en-US');
    cam.maxX = G.endless ? G.worldOffset + WORLD_W : WORLD_W;
    cam.x = G.worldOffset; cam.y = 0; setScreen('game');
    updateBirdCount();
    sfx('level_start_military_a', 0.9, 0); G.state = options.rolling ? 'rolling' : 'intro';
    token++; G.introT = 0; G.tint = L.tint; Audio.music(L.amb);
    G.rollAnim = options.rolling ? options.rollAnim : null;
  }
  function updateBirdCount() {
    const left = G.queue.length + (G.curType ? 1 : 0);
    $('birdsLeft').textContent = (G.endless ? 'WAVE ' + G.endlessWave + '  ·  ' : '') + '🐦 ' + left;
  }

  /* ---------------- entrada ---------------- */
  let lastP = null;
  new Input(cv, {
    down(sx, sy) {
      Audio.unlock().then(() => Audio.music(MENU_MUSIC));
      if (G.screen !== 'game' || G.paused) return;
      const p = cam.toWorld(sx, sy);
      if (G.state === 'ready') {
        if (U.dist(p.x, p.y, slingX(), SY) < 70) { G.dragging = true; G.drag = { x: slingX(), y: SY }; sfx('slingshot_streched', 0.8); sfx('bird_' + BIRDS[G.curType].snd + '_select', 0.9); }
        else { G.panning = true; lastP = sx; }
      } else if (G.state === 'flying') {
        G.follow = true;
        for (const b of G.flying.slice()) if (!b.dead) ability(b);
      } else { G.panning = true; lastP = sx; G.follow = false; }
    },
    move(sx, sy) {
      if (G.dragging) {
        const p = cam.toWorld(sx, sy);
        let dx = p.x - slingX(), dy = p.y - SY; const d = Math.hypot(dx, dy);
        if (d > MAXD) { dx *= MAXD / d; dy *= MAXD / d; }
        if (dx > 15) dx = 15;
        G.drag = { x: slingX() + dx, y: Math.min(SY + dy, GY - BIRDS[G.curType].r - 2) };
      } else if (G.panning && lastP != null) {
        cam.x -= (sx - lastP) / cam.scale; lastP = sx; cam.clamp();
      }
    },
    up() {
      if (G.dragging) {
        G.dragging = false;
        const d = Math.hypot(G.drag.x - slingX(), G.drag.y - SY);
        if (d > 18) launch(); else G.drag = { x: slingX(), y: SY };
      }
      G.panning = false; lastP = null;
    },
    key(k) {
      if (k === 'p' || k === 'P') togglePause();
      if (k === 'd' || k === 'D') G.debug = !G.debug;
      if (k === 'r' || k === 'R') { if (G.screen === 'game') startLevel(G.level); }
    },
  });

  /* ---------------- actualización ---------------- */
  function update(dt) {
    G.t += dt;
    if (G.screen === 'cutscene') { tickCut(dt); return; }
    if (G.screen !== 'game' || G.paused) return;
    world.step(dt);
    fx.update(dt);
    if (G.state === 'rolling' && G.rollAnim) {
      const r = G.rollAnim, k0 = U.clamp((r.t += dt) / r.dur, 0, 1);
      r.x = U.lerp(r.fromX, r.toX, k0); r.angle += dt * 11;
      cam.x = U.lerp(r.fromCam, r.toCam, k0); cam.clamp();
      if (k0 >= 1) { G.rollAnim = null; G.state = 'idle'; loadNextBird(); }
      return;
    }
    shake *= 0.9;
    // animaciones de objetos
    for (const b of world.bodies) {
      const u = b.userData; if (!u) continue;
      if (u.flash > 0) u.flash -= dt;
      if (u.type === 'pig') {
        if (u.react > 0) u.react -= dt;
        u.blink -= dt; if (u.blink < 0) { u.blinkT = 0.14; u.blink = U.rand(2, 5); }
        if (u.blinkT > 0) u.blinkT -= dt;
        u.oink -= dt; if (u.oink < 0) { u.oink = U.rand(7, 16); if (!b.asleep || Math.random() < 0.5) sfx('piglette_oink_a', 0.5, 0.1); }
      }
      if (u.type === 'bird') {
        u.age += dt;
        if (u.fuse >= 0) { u.fuse -= dt; if (u.fuse < 0) { explodeBird(b); continue; } }
        if (u.fade >= 0) { u.fade -= dt; if (u.fade < 0) { fx.burst(b.x, b.y, 8, { color: ['#fff', '#ddd'], size: 7, life: 0.5, gravity: 0, maxSpeed: 90, drag: 2 }); world.remove(b); u.dead = true; } }
      }
      if (u.type === 'egg') { u.age += dt; if (u.age > 6) { u.dead = true; world.remove(b); } }
      if (b.y > GY + 600 || b.x > G.worldOffset + WORLD_W + 500) { if (u.type === 'pig') { kill(b); } else { u.dead = true; world.remove(b); } }
    }
    G.flying = G.flying.filter((b) => !b.userData.dead);

    if (G.state === 'loading') {
      const a = G.loadAnim; a.t += dt / 0.5;
      if (a.t >= 1) { G.cur = a.type; G.state = 'ready'; G.drag = { x: slingX(), y: SY }; G.loadAnim = null; sfx('bird_' + BIRDS[a.type].snd + '_select', 0.5); }
    } else if (G.state === 'intro') {
      G.introT += dt;
      let mx = 0; for (const b of world.bodies) if (!b.static && b.x > mx) mx = b.x;
      const tx = Math.max(0, mx + 120 - cam.vw / cam.scale);
      cam.x += ((G.introT < 1.5 ? tx : (G.endless ? G.worldOffset : 0)) - cam.x) * Math.min(1, dt * 2.5); cam.clamp();
      if (G.introT > 2.2) loadNextBird();
    } else if (G.state === 'flying') {
      G.turnT += dt;
      // camino de cámara
      const lead = G.flying.reduce((m, b) => (b.x > m ? b.x : m), -1e9);
      if (G.follow && lead > -1e8) { const tx = lead - cam.vw / cam.scale * 0.4; cam.x += (tx - cam.x) * Math.min(1, dt * 3); cam.clamp(); }
      // pájaros detenidos se desvanecen
      for (const b of G.flying) {
        const u = b.userData;
        if (b.speed() < 25 && (u.hit || b.asleep)) u.still += dt; else u.still = 0;
        if (u.still > 1.0 && u.fade < 0) u.fade = 1.2;
      }
      // calma general
      let moving = 0;
      for (const b of world.bodies) if (!b.static && !b.asleep && b.userData && b.userData.type !== 'bird' && b.speed() > 28) moving++;
      const birdsActive = G.flying.some((b) => !b.userData.dead && b.userData.fade < 0 && !(b.userData.still > 0.6));
      if (moving === 0 && !birdsActive) G.calmT += dt; else G.calmT = 0;
      if (G.calmT > 1.0 || G.turnT > 14) endTurn();
    }
    // victoria / derrota
    if (G.pigs <= 0 && G.winT < 0 && G.armed && G.screen === 'game') { G.winT = 2.2; }
    if (G.winT >= 0) { G.winT -= dt; if (G.winT < 0) { if (G.endless) advanceEndlessWave(); else showEnd(true); } }
    if (G.loseT >= 0) { G.loseT -= dt; if (G.loseT < 0 && G.pigs > 0) showEnd(false); }
    G.follow = G.follow && G.state === 'flying';
    if (G.state === 'ready' && !G.dragging && !G.panning) cam.x += ((G.endless ? G.worldOffset : 0) - cam.x) * Math.min(1, dt * 2.5);
    if (G.state === 'loading') cam.x += ((G.endless ? G.worldOffset : 0) - cam.x) * Math.min(1, dt * 3);
  }
  function startEndless() {
    G.endless = true; G.endlessWave = 1; G.worldOffset = 0; G.slingX = SX; G.rollAnim = null; G.score = 0;
    startLevel(0); updateBirdCount();
  }
  function advanceEndlessWave() {
    const oldX = slingX(), oldCam = G.worldOffset, nextWave = G.endlessWave + 1;
    const nextOffset = (nextWave - 1) * 2800;
    const rollAnim = { type: G.lastBirdType || 'red', x: oldX, y: GY - 24, fromX: oldX, toX: SX + nextOffset, fromCam: oldCam, toCam: nextOffset, t: 0, dur: 2.1, angle: 0 };
    G.endlessWave = nextWave; G.worldOffset = nextOffset; G.slingX = SX + nextOffset;
    startLevel((nextWave - 1) % LEVELS.length, { keepScore: true, rolling: true, rollAnim });
    fx.burst(oldX, GY - 36, 24, { color: ['#a56b31','#d89a54','#ffd23a','#fff'], size: 9, life: 0.85, shape: 'rect', maxSpeed: 300, gravity: 720, grow: 4 });
    sfx('tnt_box_explodes', 0.8, 0.02); updateBirdCount();
  }
  function endTurn() {
    for (const b of G.flying) if (!b.userData.dead) b.userData.fade = Math.min(b.userData.fade < 0 ? 9 : b.userData.fade, 0.6);
    G.flying = [];
    if (G.pigs <= 0) { G.state = 'done'; return; }
    if (G.queue.length) { G.state = 'idle'; const tk = token; setTimeout(() => { if (G.screen === 'game' && tk === token) loadNextBird(); }, 700); updateBirdCount(); }
    else { G.state = 'done'; G.loseT = 1.2; }
  }

  /* ---------------- fin de nivel ---------------- */
  function showEnd(win) {
    if (G.screen !== 'game') return;
    G.state = 'done'; G.screen = 'end'; G.winT = -1; G.loseT = -1; $('hud').classList.add('hidden');
    const left = G.queue.length + (G.curType ? 1 : 0);
    let bonus = 0, stars = 0;
    if (win) {
      bonus = G.endless ? 0 : left * 10000; G.score += bonus; $('score').textContent = G.score.toLocaleString('en-US');
      stars = G.waveScore >= G.thr[1] ? 3 : G.waveScore >= G.thr[0] ? 2 : 1;
      if (!G.endless) {
        const prev = saved.stars[G.level] || 0;
        if (stars > prev) saved.stars[G.level] = stars;
        if (G.score > (saved.best[G.level] || 0)) saved.best[G.level] = G.score;
        Storage.set('progress', saved);
      }
      sfx('level_clear_military_a', 1, 0);
    } else sfx('level_failed_piglets_a', 1, 0);
    $('endTitle').textContent = G.endless ? 'Endless run over' : (win ? 'Level cleared!' : 'Level failed!');
    $('endScore').innerHTML = (G.endless ? 'Reached wave ' + G.endlessWave + '<br>' : '') + 'Score: <b>' + G.score.toLocaleString('en-US') + '</b>' + (bonus ? '<br><small>+' + bonus.toLocaleString('en-US') + ' for unused birds</small>' : '');
    const st = $('stars'); st.innerHTML = ''; st.classList.toggle('hidden', G.endless);
    for (let i = 0; i < 3; i++) { const star = document.createElement('span'); star.textContent = '★'; star.className = 'star' + (i < stars ? ' on' : ''); star.style.animationDelay = 0.3 + i * 0.35 + 's'; st.appendChild(star); if (i < stars && !G.endless) setTimeout(() => sfx('star_collect', 0.8, 0), 300 + i * 350); }
    $('bNext').style.display = !G.endless && win && G.level < LEVELS.length - 1 ? '' : 'none';
    $('bFinal').style.display = !G.endless && win && G.level === LEVELS.length - 1 ? '' : 'none';
    $('end').classList.remove('hidden');
  }

  /* ---------------- dibujo ---------------- */
  const gimg = (n) => Assets.img(n);
  function drawTrees(name, par, k, gs) {
    const t = gimg(name); if (!t) return;
    const sc = cam.scale, tw = t.width * k * sc * 0.9, th = t.height * k * sc * 0.9;
    const off = cam.x * par * sc, n0 = Math.floor(off / tw), x0 = -(off - n0 * tw);
    for (let i = 0; x0 + i * tw < cv.width + tw; i++) {
      const n = n0 + i, x = x0 + i * tw, y = gs - th + 8 * sc;
      if (((n % 2) + 2) % 2) { ctx.save(); ctx.translate(x + tw, y); ctx.scale(-1, 1); ctx.drawImage(t, 0, 0, tw + 1, th); ctx.restore(); }
      else ctx.drawImage(t, x, y, tw + 1, th);
    }
  }
  function drawBackground() {
    const w = cv.width, h = cv.height, sc = cam.scale, gs = (GY - cam.y) * sc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#bfe8fb'; ctx.fillRect(0, 0, w, h);
    const sk = gimg('bg_sky');
    if (sk) {
      const s = Math.max(w / sk.width, gs / sk.height) * 1.06, sw = sk.width * s, sh = sk.height * s;
      ctx.drawImage(sk, -(sw - w) * 0.5 - cam.x * sc * 0.02, gs - sh, sw, sh);
    }
    // nubes suaves
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 9; i++) {
      const span = WORLD_W * 0.6 + 400, bx = ((i * 337 + 80 - cam.x * 0.12 + G.t * (4 + i)) % span + span) % span - 200;
      const cx = bx * sc, cy = (60 + (i * 53) % 190) * sc, r = (22 + (i * 7) % 16) * sc;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.arc(cx + r * 1.1, cy + r * 0.2, r * 0.8, 0, TAU); ctx.arc(cx - r * 1.1, cy + r * 0.3, r * 0.7, 0, TAU); ctx.arc(cx + r * 0.2, cy - r * 0.4, r * 0.8, 0, TAU); ctx.fill();
    }
    drawTrees('bg_trees_far', 0.22, 1.35, gs);
    drawTrees('bg_trees_near', 0.5, 1.0, gs);
    if (G.tint && G.screen === 'game') {
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = G.tint; ctx.fillRect(0, 0, w, gs); ctx.globalCompositeOperation = 'source-over';
    }
  }

  function tileRow(img, k, y, x0, x1, dy) {
    const tw = img.width * k, th = img.height * k;
    for (let x = Math.floor(x0 / tw) * tw; x < x1; x += tw) ctx.drawImage(img, x, y, tw + 1, th);
    return th;
  }
  function drawGround() {
    const x0 = cam.x - 20, x1 = cam.x + cam.vw / cam.scale + 20;
    ctx.fillStyle = '#6b4423'; ctx.fillRect(x0, GY + 60, x1 - x0, 500);
    const g = gimg('ground'); if (g) tileRow(g, 0.52, GY - 5, x0, x1);
    const g2 = gimg('grass2'); if (g2) tileRow(g2, 0.5, GY - g2.height * 0.5 + 9, x0, x1);
  }
  function drawFrontGrass() {
    const g1 = gimg('grass1'); if (!g1) return;
    const x0 = cam.x - 20, x1 = cam.x + cam.vw / cam.scale + 20;
    ctx.globalAlpha = 0.92; tileRow(g1, 0.3, GY - g1.height * 0.3 + 10, x0, x1); ctx.globalAlpha = 1;
  }

  function drawSprite(img, x, y, w, h, a, flash) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    if (flash > 0) { ctx.globalAlpha = Math.min(0.5, flash * 2.5); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(img, -w / 2, -h / 2, w, h); }
    ctx.restore();
  }

  function drawBody(b) {
    const u = b.userData; if (!u) return;
    if (u.type === 'block') {
      const img = Assets.img(u.imgs[u.stage]) || Assets.img(u.imgs[0]);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      ctx.drawImage(img, b.ox - u.w / 2, b.oy - u.h / 2, u.w, u.h);
      if (u.flash > 0) { ctx.globalAlpha = Math.min(0.45, u.flash * 2.5); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(img, b.ox - u.w / 2, b.oy - u.h / 2, u.w, u.h); }
      ctx.restore();
    } else if (u.type === 'pig') {
      const r = u.hp / u.maxHp;
      let slot = r > 0.66 ? 0 : r > 0.33 ? 3 : 4;
      if (slot === 0 && u.react > 0) slot = 2; else if (slot === 0 && u.blinkT > 0) slot = 1;
      const img = Assets.img('pig_' + u.pt + '_' + slot);
      const w = img.width * S, h = img.height * S;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      ctx.drawImage(img, -w / 2, b.r - h, w, h);
      ctx.restore();
    } else if (u.type === 'bird') {
      const img = birdSprite(u.bt);
      ctx.save(); ctx.globalAlpha = u.fade >= 0 ? Math.max(0, u.fade / 1.2) : 1;
      drawSprite(img, b.x, b.y, u.w, u.h, b.a, 0); ctx.restore();
      if (u.bt === 'bomb' && u.fuse >= 0 && Math.floor(u.fuse * 10) % 2) { ctx.fillStyle = 'rgba(255,60,0,0.45)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2, 0, TAU); ctx.fill(); }
    } else if (u.type === 'egg') {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r * 0.85, b.r, b.a, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }

  function birdOnGround(type, x) { const t = BIRDS[type], img = birdSprite(type); const w = img.width * BS, h = img.height * BS; ctx.drawImage(img, x - w / 2, GY - t.r - h / 2 + 2 * 0, w, h); }

  function drawSling(front) {
    const bx = slingX(), top = SY + 28;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!front) {
      ctx.strokeStyle = '#5a3516'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(bx + 8, top - 6); ctx.lineTo(bx + 14, SY - 8); ctx.stroke();
      ctx.strokeStyle = '#7a4a22'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(bx + 6, top - 6); ctx.lineTo(bx + 12, SY - 8); ctx.stroke();
    } else {
      ctx.strokeStyle = '#4a2c11'; ctx.lineWidth = 17; ctx.beginPath(); ctx.moveTo(bx, GY); ctx.lineTo(bx, top); ctx.stroke();
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(bx - 2, GY); ctx.lineTo(bx - 2, top); ctx.stroke();
      ctx.strokeStyle = '#4a2c11'; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(bx, top + 2); ctx.lineTo(bx - 14, SY - 6); ctx.stroke();
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(bx - 2, top + 2); ctx.lineTo(bx - 15, SY - 6); ctx.stroke();
    }
  }
  function drawBand(front, px, py) {
    ctx.strokeStyle = '#2d1a0b'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    const sx = front ? slingX() - 14 : slingX() + 14, sy = SY - 6;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px + (front ? -3 : 3), py + 2); ctx.stroke();
  }

  function drawTrajectory() {
    const d = G.drag, vx = (slingX() - d.x) * KPOW, vy = (SY - d.y) * KPOW;
    for (let i = 1; i <= 16; i++) {
      const t = i * 0.075, x = d.x + vx * t, y = d.y + vy * t + 0.5 * GRAV * t * t;
      if (y > GY) break;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.95 - i * 0.04) + ')'; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.2, 5.5 - i * 0.2), 0, TAU); ctx.fill(); ctx.stroke();
    }
  }

  function render() {
    if (G.screen === 'cutscene') { drawCutscene(); return; }
    drawBackground();
    cam.apply(ctx);
    if (shake > 0.5) ctx.translate(U.rand(-shake, shake) * 0.4, U.rand(-shake, shake) * 0.4);
    drawGround();
    if (G.screen !== 'game' && G.screen !== 'end') { ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    drawSling(false);
    // cola de pájaros
    { let qx = slingX() - 50; for (const t of G.queue.slice(0, 5)) { const w = birdSprite(t).width * BS; qx -= w * 0.4; birdOnGround(t, qx); qx -= w * 0.4 + 2; } }
    if (G.state === 'loading' && G.loadAnim) {
      const a = G.loadAnim, k = U.clamp(a.t, 0, 1), x = U.lerp(a.from.x, slingX(), k), y = U.lerp(a.from.y, SY, k) - Math.sin(k * Math.PI) * 55;
      const img = birdSprite(a.type); ctx.drawImage(img, x - img.width * BS / 2, y - img.height * BS / 2, img.width * BS, img.height * BS);
    }
    // bloques, cerdos, pájaros
    for (const b of world.bodies) if (b.userData && b.userData.type === 'block' && !b.dead) drawBody(b);
    for (const b of world.bodies) if (b.userData && b.userData.type === 'pig' && !b.dead) drawBody(b);
    for (const b of world.bodies) if (b.userData && (b.userData.type === 'bird' || b.userData.type === 'egg') && !b.dead) drawBody(b);
    if (G.rollAnim) { const r = G.rollAnim, im = birdSprite(r.type), w = im.width * BS, h = im.height * BS; ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.angle); ctx.drawImage(im, -w/2, -h/2, w, h); ctx.restore(); }
    // pájaro en la resortera
    if (G.cur && (G.state === 'ready')) {
      const p = G.dragging ? G.drag : { x: slingX(), y: SY };
      drawBand(false, p.x, p.y);
      const img = birdSprite(G.cur); ctx.drawImage(img, p.x - img.width * BS / 2, p.y - img.height * BS / 2, img.width * BS, img.height * BS);
      drawBand(true, p.x, p.y);
      if (G.dragging) drawTrajectory();
    }
    drawSling(true);
    drawFrontGrass();
    fx.draw(ctx); fx.drawTexts(ctx, FONT);
    if (G.debug) world.debugDraw(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (G.debug) {
      const s = world.stats; ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(10, cv.height - 110, 300, 100);
      ctx.fillStyle = '#9f9'; ctx.font = '14px monospace';
      ['BirdJS v' + BirdJS.version, 'FPS ' + loop.fps.toFixed(0) + '  step ' + s.stepMs.toFixed(2) + ' ms', 'bodies ' + s.bodies + ' (awake ' + s.awake + ')', 'contacts ' + s.contacts + '  state ' + G.state].forEach((t, i) => ctx.fillText(t, 20, cv.height - 88 + i * 20));
    }
  }

  /* ---------------- cinemáticas ---------------- */
  // vista = [zoom, foco x, foco y] sobre el encuadre "cubrir"; se interpola de a → b (Ken Burns)
  const CUTS = {
    intro: { panels: [
      { img: 'cs1', a: [1.0, 0.0, 0.5], b: [1.15, 1.0, 0.5], snd: 'bird_05_select', text: 'One quiet morning… the birds discovered their nest was empty.' },
      { img: 'cs2', a: [1.0, 1.0, 0.5], b: [1.35, 0.85, 0.5], snd: 'piglette_oink_a', text: 'The green pigs had taken every egg to their fortress!' },
      { img: 'cs3', a: [1.0, 0.0, 0.7], b: [1.18, 0.4, 0.3], snd: 'redbird_yell0', text: 'The birds will not stand by. It is time to get those eggs back!' },
    ], done() { setScreen('levels'); } },
    boss: { panels: [
      { img: 'cs2', a: [1.1, 0.0, 0.5], b: [1.7, 1.0, 0.45], snd: 'piglette_oink_a', text: 'King Pig is waiting deep inside the fortress… get ready!' },
    ], done() { startLevel(7); } },
    ending: { panels: [
      { img: 'cs3', a: [1.2, 0.5, 0.3], b: [1.0, 0.2, 0.6], snd: 'level_clear_military_a', text: 'The eggs are safe! The birds have defeated King Pig.' },
      { img: 'cs1', a: [1.15, 1.0, 0.5], b: [1.0, 0.0, 0.5], snd: 'piglette_oink_a', text: 'But green pigs never give up… will they return?' },
    ], done() { setScreen('levels'); } },
  };
  let CS = null;
  const csDur = (p) => Math.max(5, p.text.length / 26 + 2.6);
  function playCut(name, done) {
    CS = { def: CUTS[name], idx: 0, t: 0, full: false, after: done || CUTS[name].done };
    setScreen('cutscene');
    $('csText').textContent = ''; sfx(CS.def.panels[0].snd, 0.9, 0);
  }
  function nextPanel() {
    CS.idx++; CS.t = 0; CS.full = false;
    if (CS.idx >= CS.def.panels.length) { finishCut(); return; }
    $('csText').textContent = ''; sfx(CS.def.panels[CS.idx].snd, 0.9, 0);
  }
  function finishCut() { const f = CS && CS.after; CS = null; $('cs').classList.add('hidden'); if (f) f(); }
  function tickCut(dt) {
    if (!CS) return;
    CS.t += dt;
    const p = CS.def.panels[CS.idx], n = CS.full ? p.text.length : Math.min(p.text.length, Math.floor(CS.t * 30));
    const shown = p.text.slice(0, n);
    if ($('csText').textContent !== shown) $('csText').textContent = shown;
    $('csHint').style.opacity = n >= p.text.length ? 1 : 0;
    if (CS.t > csDur(p)) nextPanel();
  }
  function tapCut() {
    if (!CS) return;
    const p = CS.def.panels[CS.idx];
    if (!CS.full && CS.t * 30 < p.text.length) CS.full = true; else nextPanel();
  }
  function drawCutscene() {
    if (!CS) return;
    const w = cv.width, h = cv.height, p = CS.def.panels[CS.idx], im = gimg(p.img);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    if (!im) return;
    const rx = 0, ry = h * 0.1, rw = w, rh = h * 0.74, dur = csDur(p);
    const k = Math.min(1, CS.t / dur), e = k * k * (3 - 2 * k);
    const z = U.lerp(p.a[0], p.b[0], e), fx = U.lerp(p.a[1], p.b[1], e), fy = U.lerp(p.a[2], p.b[2], e);
    const base = Math.max(rw / im.width, rh / im.height) * z, iw = im.width * base, ih = im.height * base;
    const alpha = Math.max(0, Math.min(1, CS.t / 0.7, (dur - CS.t) / 0.6));
    ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip(); ctx.globalAlpha = alpha;
    ctx.drawImage(im, rx - (iw - rw) * fx, ry - (ih - rh) * fy, iw, ih);
    ctx.restore();
  }
  function enterLevel(i) {
    if (i === 7 && !saved.seen.boss) { saved.seen.boss = 1; Storage.set('progress', saved); playCut('boss'); }
    else startLevel(i);
  }

  /* ---------------- pantallas ---------------- */
  function setScreen(s) {
    G.screen = s;
    if (s === 'levels') G.endless = false;
    for (const id of ['menu', 'levels', 'end', 'cs']) $(id).classList.add('hidden');
    $('hud').classList.toggle('hidden', s !== 'game');
    $('pauseMenu').classList.add('hidden');
    if (s === 'menu') { $('menu').classList.remove('hidden'); Audio.music(MENU_MUSIC); }
    if (s === 'levels') { buildLevelGrid(); $('levels').classList.remove('hidden'); Audio.music(MENU_MUSIC); }
    if (s === 'cutscene') $('cs').classList.remove('hidden');
  }
  function buildLevelGrid() {
    const lv = $('levels');
    if (!lv.style.backgroundImage) lv.style.backgroundImage = 'url(' + window.IMGS.ui_sun + '), linear-gradient(#4fb8f2,#bfe8fb)';
    $('bBackImg').src = window.IMGS.ui_back;
    const g = $('grid'); g.innerHTML = '';
    let total = 0, next = -1;
    LEVELS.forEach((L, i) => { const s = saved.stars[i] || 0; total += s; if (next < 0 && !(i > 0 && !(saved.stars[i - 1] > 0)) && s === 0) next = i; });
    $('totalStars').textContent = '★ ' + total + '/' + LEVELS.length * 3;
    LEVELS.forEach((L, i) => {
      const s = saved.stars[i] || 0, locked = i > 0 && !(saved.stars[i - 1] > 0);
      const kind = locked ? 'gray' : s >= 3 ? 'teal' : i === next ? 'purple' : 'green';
      const d = document.createElement('button'); d.className = 'card ' + kind;
      d.style.backgroundImage = 'url(' + window.IMGS['ui_card_' + kind] + ')'; d.style.animationDelay = i * 0.06 + 's';
      const stars = [0, 1, 2].map((k) => '<s class="' + (k < s ? 'on' : '') + '">★</s>').join('');
      const best = saved.best[i] ? saved.best[i].toLocaleString('en-US') : '';
      d.innerHTML = '<span class="cn">' + L.name + '</span>' + (locked ? '<img class="lock" src="' + window.IMGS.ui_lock + '">' : '<b>' + (i + 1) + '</b><i>' + stars + '</i><small>' + best + '</small>');
      d.onclick = () => { if (locked) { sfx('menu_back', 0.6, 0); return; } Audio.unlock(); sfx('menu_confirm', 0.9, 0); enterLevel(i); };
      g.appendChild(d);
    });
  }
  function togglePause() {
    if (G.screen !== 'game') return;
    G.paused = !G.paused; $('pauseMenu').classList.toggle('hidden', !G.paused);
    sfx(G.paused ? 'menu_confirm' : 'menu_back', 0.7, 0);
  }
  function runTest() {
    const r = BirdJS.selfTest(), out = $('testOut');
    out.innerHTML = '<b>BirdJS v' + r.version + ' — ' + (r.ok ? 'ALL TESTS PASSED' : 'TESTS FAILED') + ' (' + r.ms + ' ms)</b>' + r.results.map((x) => '<div class="' + (x.ok ? 'ok' : 'bad') + '">' + (x.ok ? '✔ ' : '✘ ') + x.name + ' <small>' + x.info + '</small></div>').join('');
  }

  /* ---------------- arranque ---------------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr);
    cam.resize(cv.width, cv.height, VIEW_H); cam.clamp();
  }
  addEventListener('resize', resize); resize();

  const loop = new Loop(update, render, 1 / 120);
  window.__game = { G, world, startLevel, startEndless, advanceEndlessWave, LEVELS, cam, loop, playCut, setScreen,
    shoot(L, deg) { if (G.state !== 'ready') return false; const t = deg * Math.PI / 180; G.drag = { x: slingX() - L * Math.cos(t), y: SY + L * Math.sin(t) }; launch(); return true; },
    tap() { for (const b of G.flying.slice()) ability(b); } };

  Audio.register(window.SNDS);
  Assets.loadImages(window.IMGS).then(() => {
    $('logo').src = window.IMGS.logo;
    $('loading').classList.add('hidden');
    setScreen('menu'); loop.start();
  });

  $('bPlay').onclick = () => {
    Audio.unlock().then(() => Audio.music(MENU_MUSIC)); sfx('menu_confirm', 0.9, 0);
    if (!saved.seen.intro) { saved.seen.intro = 1; Storage.set('progress', saved); playCut('intro'); } else setScreen('levels');
  };
  $('bIntro').onclick = () => { Audio.unlock().then(() => Audio.music(MENU_MUSIC)); playCut('intro'); };
  $('bEndless').onclick = () => { Audio.unlock(); sfx('menu_confirm', 0.9, 0); startEndless(); };
  $('bFinal').onclick = () => playCut('ending');
  $('csSkip').onclick = (e) => { e.stopPropagation(); finishCut(); };
  $('cs').addEventListener('pointerdown', (e) => { if (e.target.id !== 'csSkip') tapCut(); });
  addEventListener('keydown', (e) => { if (G.screen === 'cutscene') { if (e.key === 'Escape') finishCut(); else if (e.key === ' ' || e.key === 'Enter') tapCut(); } });
  $('bTest').onclick = runTest;
  $('bBack').onclick = () => { sfx('menu_back', 0.8, 0); setScreen('menu'); };
  $('bPause').onclick = togglePause;
  $('bResume').onclick = togglePause;
  $('bRestart').onclick = () => startLevel(G.level);
  $('bRestart2').onclick = () => startLevel(G.level);
  $('bRetry').onclick = () => startLevel(G.level);
  $('bNext').onclick = () => enterLevel(G.level + 1);
  $('bMenu').onclick = () => { setScreen('levels'); };
  $('bMenu2').onclick = () => { setScreen('levels'); };
  $('bDebug').onclick = () => { G.debug = !G.debug; };
  $('bSnd').onclick = () => { Audio.setMuted(!Audio.muted); $('bSnd').textContent = Audio.muted ? '🔇' : '🔊'; };
})();
