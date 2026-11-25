/*!
 * BirdJS v0.1.0 — mini motor 2D para juegos de lanzamiento y destrucción.
 * Incluye: Vec, Body/World (física de círculos y polígonos con impulsos secuenciales,
 * warm-starting, reposo/sleep), Assets, Audio (WebAudio), Input, Camera, Loop,
 * Particles, Storage y una autoprueba (BirdJS.selfTest).
 * Sin dependencias. Funciona en navegador y en Node (solo física).
 */
(function (root) {
  'use strict';
  const BirdJS = { version: '0.1.0' };
  const TAU = Math.PI * 2;
  let _bodyId = 1;

  /* ===================================================================
   *  Utilidades
   * =================================================================== */
  const U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    pick: (arr) => arr[(Math.random() * arr.length) | 0],
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  };
  BirdJS.Util = U;

  /* ===================================================================
   *  Cuerpo rígido
   * =================================================================== */
  class Body {
    constructor(o) {
      this.id = _bodyId++;
      this.shape = o.shape; // 'circle' | 'poly'
      this.x = o.x || 0; this.y = o.y || 0; this.a = o.a || 0;
      this.vx = o.vx || 0; this.vy = o.vy || 0; this.av = o.av || 0;
      this.static = !!o.static;
      this.density = o.density != null ? o.density : 1;
      this.friction = o.friction != null ? o.friction : 0.5;
      this.restitution = o.restitution != null ? o.restitution : 0.1;
      this.linDamp = o.linDamp != null ? o.linDamp : 0.03;
      this.angDamp = o.angDamp != null ? o.angDamp : 0.35;
      this.rollResist = o.rollResist;
      this.group = o.group || 0;          // mismo grupo != 0 => no colisionan entre sí
      this.userData = o.userData || null; // datos del juego
      this.kind = o.kind || '';
      this.asleep = false; this.sleepT = 0;
      this.dead = false;
      this.ox = 0; this.oy = 0; // centro del bbox respecto al centroide (para dibujar)
      this.r = 0; this.verts = null; this.norms = null; this.wv = null; this.wn = null;
      this.hw = 0; this.hh = 0;
      this.minX = 0; this.minY = 0; this.maxX = 0; this.maxY = 0;
      this.fx = 0; this.fy = 0; // fuerza acumulada (se limpia cada paso)
    }
    static circle(o) {
      const b = new Body(Object.assign({}, o, { shape: 'circle' }));
      b.r = o.r;
      b._mass(Math.PI * b.r * b.r * b.density, 0.5);
      b.updateTransform();
      return b;
    }
    static box(w, h, o) {
      const hw = w / 2, hh = h / 2;
      return Body.polygon([{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }], o);
    }
    /** Triángulo isósceles con la punta arriba (en coordenadas de pantalla). */
    static triangle(w, h, o) {
      return Body.polygon([{ x: 0, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }], o);
    }
    /** Vértices relativos al centro del bbox. (x,y) = posición del centro del bbox. */
    static polygon(verts, o) {
      o = o || {};
      const b = new Body(Object.assign({}, o, { shape: 'poly' }));
      let vs = verts.map((v) => ({ x: v.x, y: v.y }));
      let area = 0, cx = 0, cy = 0;
      for (let i = 0; i < vs.length; i++) {
        const p = vs[i], q = vs[(i + 1) % vs.length], cr = p.x * q.y - p.y * q.x;
        area += cr / 2; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
      }
      if (area < 0) { vs.reverse(); area = -area; cx = -cx; cy = -cy; }
      cx /= 6 * area; cy /= 6 * area;
      vs = vs.map((v) => ({ x: v.x - cx, y: v.y - cy }));
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const v of vs) { minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x); miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y); }
      b.ox = -cx; b.oy = -cy; // el centro del bbox está en (-cx,-cy) respecto al centroide
      b.hw = (maxx - minx) / 2; b.hh = (maxy - miny) / 2;
      const co = Math.cos(b.a), si = Math.sin(b.a);
      b.x += cx * co - cy * si; b.y += cx * si + cy * co;
      b.verts = vs;
      b.norms = vs.map((v, i) => {
        const q = vs[(i + 1) % vs.length], ex = q.x - v.x, ey = q.y - v.y, l = Math.hypot(ex, ey);
        return { x: ey / l, y: -ex / l };
      });
      b.wv = vs.map(() => ({ x: 0, y: 0 }));
      b.wn = vs.map(() => ({ x: 0, y: 0 }));
      let I = 0;
      for (let i = 0; i < vs.length; i++) {
        const p = vs[i], q = vs[(i + 1) % vs.length], cr = p.x * q.y - p.y * q.x;
        I += cr * (p.x * p.x + p.y * p.y + p.x * q.x + p.y * q.y + q.x * q.x + q.y * q.y) / 12;
      }
      b._massI(area * b.density, I * b.density);
      b.r = Math.hypot(b.hw, b.hh) + 2;
      b.updateTransform();
      return b;
    }
    _mass(m, k) { this._massI(m, k * m * this.r * this.r); }
    _massI(m, I) {
      this.mass = m; this.inertia = I;
      if (this.static) { this.invM = 0; this.invI = 0; }
      else { this.invM = 1 / m; this.invI = 1 / I; }
    }
    setStatic() { this.static = true; this.invM = 0; this.invI = 0; this.vx = this.vy = this.av = 0; return this; }
    updateTransform() {
      if (this.shape === 'circle') {
        this.minX = this.x - this.r; this.maxX = this.x + this.r; this.minY = this.y - this.r; this.maxY = this.y + this.r;
        return;
      }
      const c = Math.cos(this.a), s = Math.sin(this.a);
      let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
      for (let i = 0; i < this.verts.length; i++) {
        const v = this.verts[i], w = this.wv[i];
        w.x = this.x + v.x * c - v.y * s; w.y = this.y + v.x * s + v.y * c;
        const n = this.norms[i], m = this.wn[i];
        m.x = n.x * c - n.y * s; m.y = n.x * s + n.y * c;
        if (w.x < mnx) mnx = w.x; if (w.x > mxx) mxx = w.x; if (w.y < mny) mny = w.y; if (w.y > mxy) mxy = w.y;
      }
      this.minX = mnx; this.maxX = mxx; this.minY = mny; this.maxY = mxy;
    }
    /** Centro del bbox en el mundo (útil para dibujar sprites). */
    center() {
      const c = Math.cos(this.a), s = Math.sin(this.a);
      return { x: this.x + this.ox * c - this.oy * s, y: this.y + this.ox * s + this.oy * c };
    }
    wake() { this.asleep = false; this.sleepT = 0; }
    applyImpulse(ix, iy, px, py) {
      if (this.static) return;
      this.vx += ix * this.invM; this.vy += iy * this.invM;
      if (px !== undefined) this.av += ((px - this.x) * iy - (py - this.y) * ix) * this.invI;
      this.wake();
    }
    speed() { return Math.hypot(this.vx, this.vy); }
  }

  /* ===================================================================
   *  Detección de colisiones
   * =================================================================== */
  function colCircleCircle(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
    return { nx, ny, pts: [{ x: a.x + nx * a.r, y: a.y + ny * a.r, pen: rr - d }] };
  }

  // normal del polígono hacia el círculo
  function circlePoly(c, p) {
    let sepMax = -1e9, idx = 0;
    for (let i = 0; i < p.wv.length; i++) {
      const n = p.wn[i], v = p.wv[i];
      const s = n.x * (c.x - v.x) + n.y * (c.y - v.y);
      if (s > c.r) return null;
      if (s > sepMax) { sepMax = s; idx = i; }
    }
    const v1 = p.wv[idx], v2 = p.wv[(idx + 1) % p.wv.length], n = p.wn[idx];
    if (sepMax < 0) {
      return { nx: n.x, ny: n.y, x: c.x - n.x * c.r, y: c.y - n.y * c.r, pen: c.r - sepMax };
    }
    const d1 = (c.x - v1.x) * (v2.x - v1.x) + (c.y - v1.y) * (v2.y - v1.y);
    const d2 = (c.x - v2.x) * (v1.x - v2.x) + (c.y - v2.y) * (v1.y - v2.y);
    if (d1 <= 0 || d2 <= 0) {
      const v = d1 <= 0 ? v1 : v2;
      const dx = c.x - v.x, dy = c.y - v.y, d = Math.hypot(dx, dy);
      if (d > c.r) return null;
      const inv = d > 1e-6 ? 1 / d : 0;
      return { nx: dx * inv, ny: dy * inv, x: v.x, y: v.y, pen: c.r - d };
    }
    return { nx: n.x, ny: n.y, x: c.x - n.x * sepMax, y: c.y - n.y * sepMax, pen: c.r - sepMax };
  }

  function faceSep(A, B) {
    let best = -1e9, bi = 0;
    for (let i = 0; i < A.wv.length; i++) {
      const n = A.wn[i], v = A.wv[i];
      let m = 1e9;
      for (let j = 0; j < B.wv.length; j++) {
        const w = B.wv[j], s = n.x * (w.x - v.x) + n.y * (w.y - v.y);
        if (s < m) m = s;
      }
      if (m > best) { best = m; bi = i; }
      if (best > 0) break;
    }
    return { sep: best, i: bi };
  }

  function clip(p1, p2, nx, ny, c, out) {
    const d1 = nx * p1.x + ny * p1.y - c, d2 = nx * p2.x + ny * p2.y - c;
    let n = 0;
    if (d1 <= 0) out[n++] = { x: p1.x, y: p1.y };
    if (d2 <= 0) out[n++] = { x: p2.x, y: p2.y };
    if (d1 * d2 < 0 && n < 2) {
      const t = d1 / (d1 - d2);
      out[n++] = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
    }
    return n;
  }

  function colPolyPoly(A, B) {
    const fa = faceSep(A, B); if (fa.sep >= 0) return null;
    const fb = faceSep(B, A); if (fb.sep >= 0) return null;
    let R, I, ri, flip;
    if (fa.sep >= fb.sep * 0.95 + fa.sep * 0.01) { R = A; I = B; ri = fa.i; flip = false; }
    else { R = B; I = A; ri = fb.i; flip = true; }
    const rn = R.wn[ri], v1 = R.wv[ri], v2 = R.wv[(ri + 1) % R.wv.length];
    // cara incidente: la más opuesta a la normal de referencia
    let ii = 0, md = 1e9;
    for (let i = 0; i < I.wn.length; i++) {
      const d = rn.x * I.wn[i].x + rn.y * I.wn[i].y;
      if (d < md) { md = d; ii = i; }
    }
    const i1 = I.wv[ii], i2 = I.wv[(ii + 1) % I.wv.length];
    let tx = v2.x - v1.x, ty = v2.y - v1.y; const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
    const o1 = [], o2 = [];
    if (clip(i1, i2, -tx, -ty, -(tx * v1.x + ty * v1.y), o1) < 2) return null;
    if (clip(o1[0], o1[1], tx, ty, tx * v2.x + ty * v2.y, o2) < 2) return null;
    const pts = [];
    for (let k = 0; k < 2; k++) {
      const sep = rn.x * (o2[k].x - v1.x) + rn.y * (o2[k].y - v1.y);
      if (sep <= 0) pts.push({ x: o2[k].x, y: o2[k].y, pen: -sep });
    }
    if (!pts.length) return null;
    return { nx: flip ? -rn.x : rn.x, ny: flip ? -rn.y : rn.y, pts };
  }

  /* ===================================================================
   *  Mundo físico
   * =================================================================== */
  class World {
    constructor(o) {
      o = o || {};
      this.gx = o.gx || 0; this.gy = o.gy != null ? o.gy : 1000;
      this.iterations = o.iterations || 10;
      this.slop = o.slop != null ? o.slop : 0.6;
      this.percent = o.percent != null ? o.percent : 0.25;
      this.sleepSpeed = o.sleepSpeed || 18;
      this.sleepTime = o.sleepTime || 0.4;
      this.maxSpeed = o.maxSpeed || 2600;
      this.restSpeed = o.restSpeed || 90; this.restDamp = o.restDamp != null ? o.restDamp : 9;
      this.bodies = [];
      this.pairs = new Map();
      this.onImpact = null; // (a, b, impulse, closingSpeed, x, y, isNew)
      this.stats = { bodies: 0, awake: 0, contacts: 0, stepMs: 0, steps: 0 };
    }
    add(b) { this.bodies.push(b); return b; }
    remove(b) {
      b.dead = true;
      // despertar a los vecinos para que no queden flotando sin soporte
      for (const o of this.bodies) {
        if (o.static || o === b || !o.asleep) continue;
        if (o.maxX > b.minX - 10 && o.minX < b.maxX + 10 && o.maxY > b.minY - 10 && o.minY < b.maxY + 10) o.wake();
      }
    }
    clear() { this.bodies.length = 0; this.pairs.clear(); }

    /** Cuerpos dentro de un radio (por centro). */
    inRadius(x, y, r) {
      const out = [];
      for (const b of this.bodies) {
        if (b.dead) continue;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < r + (b.shape === 'circle' ? b.r : b.r * 0.6)) out.push({ body: b, dist: d });
      }
      return out;
    }
    /** Explosión radial: `strength` es el cambio de velocidad (px/s) en el centro, con caída lineal. Devuelve [{body, k}] con k∈(0,1]. */
    explode(x, y, radius, strength) {
      const res = [];
      for (const { body: b, dist } of this.inRadius(x, y, radius)) {
        const k = Math.max(0.05, 1 - dist / (radius * 1.25));
        if (!b.static) {
          const dx = b.x - x, dy = b.y - y, d = Math.max(dist, 1);
          b.applyImpulse(dx / d * strength * k * b.mass, (dy / d * strength * k - strength * 0.25 * k) * b.mass);
        }
        res.push({ body: b, k });
      }
      return res;
    }

    /** Paso con subdivisión automática: los cuerpos muy rápidos no atraviesan piezas finas. */
    step(dt) {
      let mx = 0;
      for (const o of this.bodies) {
        if (o.static || o.asleep) continue;
        const s = Math.abs(o.vx) + Math.abs(o.vy); if (s > mx) mx = s;
      }
      const n = Math.min(4, Math.max(1, Math.ceil(mx * dt / 7)));
      for (let i = 0; i < n; i++) this._step(dt / n);
    }

    _step(dt) {
      const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
      const bodies = this.bodies;
      // limpiar muertos
      for (let i = bodies.length - 1; i >= 0; i--) if (bodies[i].dead) bodies.splice(i, 1);

      // 1) integrar fuerzas
      for (const b of bodies) {
        if (b.static || b.asleep) continue;
        b.vx += (this.gx + b.fx * b.invM) * dt; b.vy += (this.gy + b.fy * b.invM) * dt;
        b.fx = 0; b.fy = 0;
        let ld = 1 / (1 + dt * b.linDamp), ad = 1 / (1 + dt * b.angDamp);
        if (b.touch) {
          // amortiguación de reposo: apaga la vibración residual de las pilas
          const sp0 = Math.abs(b.vx) + Math.abs(b.vy);
          if (sp0 < this.restSpeed) { ld /= 1 + dt * this.restDamp; ad /= 1 + dt * this.restDamp * 1.5; }
          b.touch = false;
        }
        b.vx *= ld; b.vy *= ld; b.av *= ad;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > this.maxSpeed) { b.vx *= this.maxSpeed / sp; b.vy *= this.maxSpeed / sp; }
      }

      // 1b) un cuerpo en movimiento despierta a los dormidos que toca (o casi toca):
      //     así nada se queda flotando cuando su soporte se mueve o desaparece
      for (const A of bodies) {
        if (A.static || A.asleep) continue;
        if (A.vx * A.vx + A.vy * A.vy < 64 && Math.abs(A.av) < 0.5) continue;
        for (const S of bodies) {
          if (!S.asleep) continue;
          if (S.maxX > A.minX - 5 && S.minX < A.maxX + 5 && S.maxY > A.minY - 5 && S.minY < A.maxY + 5) S.wake();
        }
      }

      // 2) fase ancha + estrecha
      const manifolds = [];
      const n = bodies.length;
      for (let i = 0; i < n; i++) {
        const A = bodies[i];
        for (let j = i + 1; j < n; j++) {
          const B = bodies[j];
          if (A.static && B.static) continue;
          if (A.asleep && B.asleep) continue;
          if (A.asleep && B.static) continue;
          if (B.asleep && A.static) continue;
          if (A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY) continue;
          if (A.group !== 0 && A.group === B.group) continue;
          const m = this._collide(A, B);
          if (m) manifolds.push(m);
        }
      }
      this.stats.contacts = manifolds.length;

      // 3) pre-paso, warm start
      const newPairs = new Map();
      for (const m of manifolds) {
        const A = m.a, B = m.b;
        A.touch = true; B.touch = true;
        const key = A.id < B.id ? A.id * 1048576 + B.id : B.id * 1048576 + A.id;
        const old = this.pairs.get(key);
        m.key = key; m.isNew = !old;
        m.mu = Math.sqrt(A.friction * B.friction);
        m.e = Math.max(A.restitution, B.restitution);
        m.closing = 0;
        if (A.shape === 'circle') A._rc = true;
        if (B.shape === 'circle') B._rc = true;
        for (const c of m.pts) {
          c.rax = c.x - A.x; c.ray = c.y - A.y; c.rbx = c.x - B.x; c.rby = c.y - B.y;
          const rnA = c.rax * m.ny - c.ray * m.nx, rnB = c.rbx * m.ny - c.rby * m.nx;
          c.kN = A.invM + B.invM + A.invI * rnA * rnA + B.invI * rnB * rnB;
          const tx = -m.ny, ty = m.nx;
          const rtA = c.rax * ty - c.ray * tx, rtB = c.rbx * ty - c.rby * tx;
          c.kT = A.invM + B.invM + A.invI * rtA * rtA + B.invI * rtB * rtB;
          // velocidad relativa previa
          const dvx = (B.vx - B.av * c.rby) - (A.vx - A.av * c.ray);
          const dvy = (B.vy + B.av * c.rbx) - (A.vy + A.av * c.rax);
          const vn = dvx * m.nx + dvy * m.ny;
          c.closing = -vn; if (c.closing > m.closing) m.closing = c.closing;
          c.bias = vn < -60 ? -m.e * vn : 0;
          c.spec = c.pen < 0 ? -c.pen / dt : 0;
          // anclas locales para el solver de posiciones
          { const hp = c.pen / 2, mx = c.x, my = c.y;
            const ax = mx + m.nx * hp - A.x, ay = my + m.ny * hp - A.y, bx = mx - m.nx * hp - B.x, by = my - m.ny * hp - B.y;
            const ca = Math.cos(A.a), sa = Math.sin(A.a), cb = Math.cos(B.a), sb = Math.sin(B.a);
            c.lax = ax * ca + ay * sa; c.lay = -ax * sa + ay * ca;
            c.lbx = bx * cb + by * sb; c.lby = -bx * sb + by * cb; }
          c.Pn = 0; c.Pt = 0;
          if (old) {
            for (const oc of old.pts) {
              if (Math.abs(oc.x - c.x) + Math.abs(oc.y - c.y) < 5) { c.Pn = oc.Pn; c.Pt = oc.Pt; break; }
            }
          }
          // warm start
          const px = m.nx * c.Pn + tx * c.Pt, py = m.ny * c.Pn + ty * c.Pt;
          A.vx -= px * A.invM; A.vy -= py * A.invM; A.av -= (c.rax * py - c.ray * px) * A.invI;
          B.vx += px * B.invM; B.vy += py * B.invM; B.av += (c.rbx * py - c.rby * px) * B.invI;
        }
        if (m.pts.length === 2) {
          const c1 = m.pts[0], c2 = m.pts[1];
          const r1A = c1.rax * m.ny - c1.ray * m.nx, r2A = c2.rax * m.ny - c2.ray * m.nx;
          const r1B = c1.rbx * m.ny - c1.rby * m.nx, r2B = c2.rbx * m.ny - c2.rby * m.nx;
          m.k12 = A.invM + B.invM + A.invI * r1A * r2A + B.invI * r1B * r2B;
          const det = c1.kN * c2.kN - m.k12 * m.k12;
          m.block = det > 1e-12 && c1.kN * c1.kN < 1000 * det ? 1 / det : 0;
        }
        newPairs.set(key, m);
        // despertar
        if (A.asleep && !B.static && !B.asleep && B.speed() > this.sleepSpeed * 1.6) A.wake();
        if (B.asleep && !A.static && !A.asleep && A.speed() > this.sleepSpeed * 1.6) B.wake();
      }
      this.pairs = newPairs;

      // 4) iteraciones del solver
      manifolds.sort((p, q) => (q.a.y + q.b.y) - (p.a.y + p.b.y)); // de abajo hacia arriba
      for (let it = 0; it < this.iterations; it++) {
        for (let mi = 0; mi < manifolds.length; mi++) {
          const m = manifolds[(it & 1) ? manifolds.length - 1 - mi : mi];
          const A = m.a, B = m.b, nx = m.nx, ny = m.ny, tx = -ny, ty = nx;
          // fricción (secuencial)
          for (const c of m.pts) {
            const dvx = (B.vx - B.av * c.rby) - (A.vx - A.av * c.ray);
            const dvy = (B.vy + B.av * c.rbx) - (A.vy + A.av * c.rax);
            let jt = -(dvx * tx + dvy * ty) / c.kT;
            const maxF = m.mu * c.Pn;
            const nPt = U.clamp(c.Pt + jt, -maxF, maxF);
            jt = nPt - c.Pt; c.Pt = nPt;
            const px = tx * jt, py = ty * jt;
            A.vx -= px * A.invM; A.vy -= py * A.invM; A.av -= (c.rax * py - c.ray * px) * A.invI;
            B.vx += px * B.invM; B.vy += py * B.invM; B.av += (c.rbx * py - c.rby * px) * B.invI;
          }
          // normal
          if (m.block) {
            const c1 = m.pts[0], c2 = m.pts[1];
            const rel = (c) => {
              const dvx = (B.vx - B.av * c.rby) - (A.vx - A.av * c.ray), dvy = (B.vy + B.av * c.rbx) - (A.vy + A.av * c.rax);
              return dvx * nx + dvy * ny;
            };
            const a1 = c1.Pn, a2 = c2.Pn, k11 = c1.kN, k22 = c2.kN, k12 = m.k12;
            let b1 = rel(c1) - c1.bias + c1.spec - (k11 * a1 + k12 * a2), b2 = rel(c2) - c2.bias + c2.spec - (k12 * a1 + k22 * a2);
            let x1 = -(k22 * b1 - k12 * b2) * m.block, x2 = -(k11 * b2 - k12 * b1) * m.block;
            if (!(x1 >= 0 && x2 >= 0)) {
              x1 = -b1 / k11; x2 = 0;
              if (!(x1 >= 0 && k12 * x1 + b2 >= 0)) {
                x1 = 0; x2 = -b2 / k22;
                if (!(x2 >= 0 && k12 * x2 + b1 >= 0)) {
                  x1 = 0; x2 = 0;
                  if (!(b1 >= 0 && b2 >= 0)) { x1 = a1; x2 = a2; }
                }
              }
            }
            const d1 = x1 - a1, d2 = x2 - a2;
            c1.Pn = x1; c2.Pn = x2;
            for (let q = 0; q < 2; q++) {
              const c = q ? c2 : c1, jn = q ? d2 : d1, px = nx * jn, py = ny * jn;
              A.vx -= px * A.invM; A.vy -= py * A.invM; A.av -= (c.rax * py - c.ray * px) * A.invI;
              B.vx += px * B.invM; B.vy += py * B.invM; B.av += (c.rbx * py - c.rby * px) * B.invI;
            }
          } else {
            for (const c of m.pts) {
              const dvx = (B.vx - B.av * c.rby) - (A.vx - A.av * c.ray);
              const dvy = (B.vy + B.av * c.rbx) - (A.vy + A.av * c.rax);
              let jn = -((dvx * nx + dvy * ny) - c.bias + c.spec) / c.kN;
              const nPn = Math.max(c.Pn + jn, 0);
              jn = nPn - c.Pn; c.Pn = nPn;
              const px = nx * jn, py = ny * jn;
              A.vx -= px * A.invM; A.vy -= py * A.invM; A.av -= (c.rax * py - c.ray * px) * A.invI;
              B.vx += px * B.invM; B.vy += py * B.invM; B.av += (c.rbx * py - c.rby * px) * B.invI;
            }
          }
        }
      }

      // 5) integrar posiciones
      for (const b of bodies) {
        if (b.static || b.asleep) continue;
        if (b._rc) { b.av /= 1 + dt * (b.rollResist != null ? b.rollResist : 2.5); b._rc = false; }
        b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.av * dt;
      }
      // 6) corrección de posición (pseudo-impulsos con anclas locales, incluye rotación)
      for (let it = 0; it < 3; it++) {
        for (const m of manifolds) {
          const A = m.a, B = m.b, nx = m.nx, ny = m.ny;
          if (A.invM + B.invM === 0) continue;
          const ca = Math.cos(A.a), sa = Math.sin(A.a), cb = Math.cos(B.a), sb = Math.sin(B.a);
          for (const c of m.pts) {
            const rax = c.lax * ca - c.lay * sa, ray = c.lax * sa + c.lay * ca;
            const rbx = c.lbx * cb - c.lby * sb, rby = c.lbx * sb + c.lby * cb;
            const sep = ((B.x + rbx) - (A.x + rax)) * nx + ((B.y + rby) - (A.y + ray)) * ny;
            const C = U.clamp(this.percent * (sep + this.slop), -8, 0);
            if (C === 0) continue;
            const rnA = rax * ny - ray * nx, rnB = rbx * ny - rby * nx;
            const K = A.invM + B.invM + A.invI * rnA * rnA + B.invI * rnB * rnB;
            const imp = -C / K, px = nx * imp, py = ny * imp;
            A.x -= px * A.invM; A.y -= py * A.invM; A.a -= A.invI * (rax * py - ray * px);
            B.x += px * B.invM; B.y += py * B.invM; B.a += B.invI * (rbx * py - rby * px);
          }
        }
      }
      // 7) eventos de impacto
      if (this.onImpact) {
        for (const m of manifolds) {
          let imp = 0, px = 0, py = 0;
          for (const c of m.pts) { imp += c.Pn; px += c.x; py += c.y; }
          px /= m.pts.length; py /= m.pts.length;
          if (m.closing > 25 || m.isNew) this.onImpact(m.a, m.b, imp, m.closing, px, py, m.isNew);
        }
      }
      // 8) reposo
      let awake = 0;
      for (const b of bodies) {
        if (b.static) continue;
        if (!b.asleep) {
          if (Math.hypot(b.vx, b.vy) < this.sleepSpeed && Math.abs(b.av) < 0.3) {
            b.sleepT += dt;
            if (b.sleepT > this.sleepTime) { b.asleep = true; b.vx = b.vy = b.av = 0; }
          } else b.sleepT = 0;
        }
        if (!b.asleep) { b.updateTransform(); awake++; }
      }
      this.stats.bodies = bodies.length; this.stats.awake = awake; this.stats.steps++;
      this.stats.stepMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    }

    _collide(A, B) {
      let r, a = A, b = B;
      if (A.shape === 'circle' && B.shape === 'circle') r = colCircleCircle(A, B);
      else if (A.shape === 'poly' && B.shape === 'poly') r = colPolyPoly(A, B);
      else if (A.shape === 'circle') {
        const c = circlePoly(A, B);
        if (c) r = { nx: -c.nx, ny: -c.ny, pts: [{ x: c.x, y: c.y, pen: c.pen }] };
      } else {
        const c = circlePoly(B, A);
        if (c) r = { nx: c.nx, ny: c.ny, pts: [{ x: c.x, y: c.y, pen: c.pen }] };
      }
      if (!r) return null;
      r.a = a; r.b = b;
      return r;
    }

    /** Dibujo de depuración (contornos, centros, estado de reposo). */
    debugDraw(ctx) {
      ctx.save(); ctx.lineWidth = 1.5;
      for (const b of this.bodies) {
        ctx.strokeStyle = b.static ? '#888' : b.asleep ? '#4a4' : '#e33';
        ctx.beginPath();
        if (b.shape === 'circle') {
          ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(b.a) * b.r, b.y + Math.sin(b.a) * b.r);
        } else {
          b.wv.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y))); ctx.closePath();
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  BirdJS.Body = Body; BirdJS.World = World;

  /* ===================================================================
   *  Autoprueba de la física
   * =================================================================== */
  BirdJS.selfTest = function () {
    const results = [];
    const t0 = Date.now();
    // 1) pila de cajas estable
    {
      const w = new World({ gy: 1000 });
      w.add(Body.box(2000, 40, { x: 0, y: 20, static: true, friction: 0.6 }).setStatic());
      const boxes = [];
      for (let i = 0; i < 5; i++) boxes.push(w.add(Body.box(50, 50, { x: 0, y: -25 - i * 50, density: 1, friction: 0.6 })));
      for (let i = 0; i < 360; i++) w.step(1 / 120);
      const drift = boxes.reduce((m, b) => Math.max(m, Math.abs(b.x)), 0);
      const topY = boxes[4].y;
      results.push({ name: 'Stable stack of 5 boxes', ok: drift < 5 && Math.abs(topY - (-225)) < 12, info: 'drift ' + drift.toFixed(2) + 'px, y=' + topY.toFixed(1) });
    }
    // 2) rebote de un círculo y reposo
    {
      const w = new World({ gy: 1000 });
      w.add(Body.box(2000, 40, { x: 0, y: 20, static: true }).setStatic());
      const c = w.add(Body.circle({ x: 0, y: -300, r: 20, density: 1, restitution: 0.5 }));
      let bounced = false, minY = 0;
      for (let i = 0; i < 600; i++) { w.step(1 / 120); if (c.vy < -50) bounced = true; }
      results.push({ name: 'Circle bounces and comes to rest', ok: bounced && Math.abs(c.y + 20) < 2 && c.asleep, info: 'y=' + c.y.toFixed(1) + ' asleep=' + c.asleep });
    }
    // 3) triángulo apoyado
    {
      const w = new World({ gy: 1000 });
      w.add(Body.box(2000, 40, { x: 0, y: 20, static: true }).setStatic());
      const t = w.add(Body.triangle(60, 60, { x: 0, y: -200, density: 1, friction: 0.7 }));
      for (let i = 0; i < 480; i++) w.step(1 / 120);
      results.push({ name: 'Triangle rests without sinking', ok: Math.abs(t.center().y + 30) < 3 && Math.abs(t.a % TAU) < 0.2, info: 'cy=' + t.center().y.toFixed(1) });
    }
    // 4) conservación de impacto (evento)
    {
      const w = new World({ gy: 0 });
      let got = 0;
      w.onImpact = (a, b, imp) => { got = Math.max(got, imp); };
      const a = w.add(Body.circle({ x: 0, y: 0, r: 20, vx: 400, density: 1 }));
      w.add(Body.box(40, 200, { x: 80, y: 0, density: 1 }));
      for (let i = 0; i < 120; i++) w.step(1 / 120);
      results.push({ name: 'Impact events', ok: got > 1000, info: 'impulse ' + got.toFixed(0) });
    }
    // 5) sin tunelado a alta velocidad
    {
      const w = new World({ gy: 0 });
      w.add(Body.box(8, 400, { x: 300, y: 0, static: true }).setStatic());
      const c = w.add(Body.circle({ x: 0, y: 0, r: 10, vx: 2500, density: 1, restitution: 0.1 }));
      for (let i = 0; i < 120; i++) w.step(1 / 120);
      results.push({ name: 'No tunneling at 2500 px/s', ok: c.x < 300, info: 'x=' + c.x.toFixed(1) });
    }
    // 6) rodadura: un círculo lanzado sobre el suelo se detiene
    {
      const w = new World({ gy: 850 });
      w.add(Body.box(6000, 40, { x: 0, y: 20, static: true, friction: 0.8 }).setStatic());
      const c = w.add(Body.circle({ x: 0, y: -20, r: 15, vx: 300, density: 1, friction: 0.8, restitution: 0.2, rollResist: 4 }));
      for (let i = 0; i < 1200; i++) w.step(1 / 120);
      results.push({ name: 'Rolling circle comes to a stop', ok: c.asleep && c.x > 20 && c.x < 700, info: 'x=' + c.x.toFixed(0) + ' asleep=' + c.asleep });
    }
    // 7) nada flota al quitar el soporte
    {
      const w = new World({ gy: 850 });
      w.add(Body.box(2000, 40, { x: 0, y: 20, static: true }).setStatic());
      const bs = [0, 1, 2].map((i) => w.add(Body.box(50, 50, { x: 0, y: -25 - i * 50, density: 1, friction: 0.6 })));
      for (let i = 0; i < 480; i++) w.step(1 / 120);
      const dormidos = bs.every((x) => x.asleep);
      w.remove(bs[0]);
      for (let i = 0; i < 480; i++) w.step(1 / 120);
      results.push({ name: 'Nothing floats after support is removed', ok: dormidos && Math.abs(bs[2].y - (-25 - 50)) < 4, info: 'top y=' + bs[2].y.toFixed(1) + ' (expected -75)' });
    }
    const ok = results.every((r) => r.ok);
    return { ok, results, ms: Date.now() - t0, version: BirdJS.version };
  };

  /* ===================================================================
   *  Solo navegador a partir de aquí
   * =================================================================== */
  const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';

  /* ---------- Assets ---------- */
  BirdJS.Assets = {
    images: {}, buffers: {},
    loadImages(map) {
      return Promise.all(Object.keys(map).map((k) => new Promise((res) => {
        const im = new Image();
        im.onload = () => { this.images[k] = im; res(); };
        im.onerror = () => { console.warn('BirdJS: failed to load', k); res(); };
        im.src = map[k];
      })));
    },
    img(k) { return this.images[k]; },
  };

  /* ---------- Audio ---------- */
  BirdJS.Audio = {
    ctx: null, master: null, musicGain: null, sfxGain: null,
    buffers: {}, groups: {}, raw: {}, muted: false, musicSrc: null, musicName: null,
    _ensure() {
      if (this.ctx || !hasDOM) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.4; this.musicGain.connect(this.master);
      this.master.gain.value = this.muted ? 0 : 1;
    },
    /** Registra sonidos {nombre: base64 mp3}. Se decodifican al desbloquear el audio. */
    register(map) { Object.assign(this.raw, map); },
    /** Decodifica un sonido registrado (con caché). */
    _decode(n) {
      this._dec = this._dec || {};
      if (this._dec[n]) return this._dec[n];
      this._dec[n] = (async () => {
        try {
          const bin = atob(this.raw[n]), buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          this.buffers[n] = await new Promise((res, rej) => this.ctx.decodeAudioData(buf.buffer, res, rej));
        } catch (e) { /* ignorar */ }
      })();
      return this._dec[n];
    },
    /** Desbloquea el audio y decodifica los efectos. Las pistas `amb_*` se decodifican al pedirlas. */
    async unlock() {
      this._ensure(); if (!this.ctx) return;
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) {} }
      if (this._decoding) return this._decoding;
      this._decoding = (async () => {
        await Promise.all(Object.keys(this.raw).filter((n) => !n.startsWith('amb_')).map((n) => this._decode(n)));
        if (this.pendingMusic) { const m = this.pendingMusic; this.pendingMusic = null; this.music(m); }
      })();
      return this._decoding;
    },
    play(name, o) {
      o = o || {};
      if (!this.ctx || this.muted) return null;
      const buf = this.buffers[name]; if (!buf) return null;
      const s = this.ctx.createBufferSource(); s.buffer = buf;
      if (o.rate) s.playbackRate.value = o.rate;
      const g = this.ctx.createGain(); g.gain.value = o.vol != null ? o.vol : 1;
      s.connect(g); g.connect(this.sfxGain); s.start(0);
      return s;
    },
    /** Reproduce un sonido al azar cuyo nombre empiece por prefijo. */
    any(prefix, o) {
      const list = this._byPrefix(prefix); if (!list.length) return null;
      o = Object.assign({}, o); if (o.jitter) o.rate = (o.rate || 1) * (1 + (Math.random() - 0.5) * o.jitter);
      return this.play(U.pick(list), o);
    },
    _byPrefix(p) {
      this._pc = this._pc || {};
      if (!this._pc[p] || this._pc[p].n !== Object.keys(this.buffers).length)
        this._pc[p] = { n: Object.keys(this.buffers).length, l: Object.keys(this.buffers).filter((k) => k.startsWith(p)) };
      return this._pc[p].l;
    },
    /** Música/ambiente en bucle con fundido cruzado entre pistas. */
    music(name, fade) {
      fade = fade == null ? 1.5 : fade;
      this.wantMusic = name;
      if (!this.ctx) { this.pendingMusic = name; return; }
      if (this.musicName === name && this.musicSrc) return;
      if (!this.buffers[name]) {
        if (this.raw[name]) this._decode(name).then(() => { if (this.wantMusic === name) this.music(name, fade); });
        else this.pendingMusic = name;
        return;
      }
      const old = this.musicSrc, oldG = this.musicNode, t = this.ctx.currentTime;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + fade); g.connect(this.musicGain);
      const s = this.ctx.createBufferSource(); s.buffer = this.buffers[name]; s.loop = true; s.connect(g); s.start(0);
      if (old && oldG) {
        oldG.gain.cancelScheduledValues(t); oldG.gain.setValueAtTime(oldG.gain.value, t); oldG.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => { try { old.stop(); } catch (e) {} }, fade * 1000 + 150);
      }
      this.musicSrc = s; this.musicNode = g; this.musicName = name;
    },
    stopMusic() { if (this.musicSrc) { try { this.musicSrc.stop(); } catch (e) {} this.musicSrc = null; this.musicNode = null; this.musicName = null; } },
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 1; },
  };

  /* ---------- Cámara ---------- */
  class Camera {
    constructor() { this.x = 0; this.y = 0; this.scale = 1; this.vw = 800; this.vh = 600; this.minX = 0; this.maxX = 2000; this.minY = -2000; this.maxY = 2000; }
    /** Ajusta tamaño del lienzo (px) y escala para ver `worldH` unidades de alto. */
    resize(pw, ph, worldH) { this.vw = pw; this.vh = ph; this.scale = ph / worldH; }
    clamp() {
      const ww = this.vw / this.scale, wh = this.vh / this.scale;
      this.x = U.clamp(this.x, this.minX, Math.max(this.minX, this.maxX - ww));
      this.y = U.clamp(this.y, this.minY, Math.max(this.minY, this.maxY - wh));
    }
    toWorld(sx, sy) { return { x: sx / this.scale + this.x, y: sy / this.scale + this.y }; }
    toScreen(wx, wy) { return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale }; }
    apply(ctx) { ctx.setTransform(this.scale, 0, 0, this.scale, -this.x * this.scale, -this.y * this.scale); }
  }
  BirdJS.Camera = Camera;

  /* ---------- Entrada (puntero unificado) ---------- */
  BirdJS.Input = class {
    constructor(el, handlers) {
      this.el = el; this.h = handlers || {}; this.down = false; this.id = null; this.keys = {};
      if (!hasDOM) return;
      const pos = (e) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) * (el.width / r.width), y: (e.clientY - r.top) * (el.height / r.height) }; };
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', (e) => {
        if (this.down) return;
        this.down = true; this.id = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch (x) {}
        const p = pos(e); this.h.down && this.h.down(p.x, p.y, e); e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (this.down && e.pointerId !== this.id) return;
        const p = pos(e); this.h.move && this.h.move(p.x, p.y, e, this.down);
      });
      const up = (e) => {
        if (!this.down || e.pointerId !== this.id) return;
        this.down = false; const p = pos(e); this.h.up && this.h.up(p.x, p.y, e);
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      window.addEventListener('keydown', (e) => { this.keys[e.key] = true; this.h.key && this.h.key(e.key, e); });
      window.addEventListener('keyup', (e) => { this.keys[e.key] = false; });
    }
  };

  /* ---------- Bucle principal (paso fijo) ---------- */
  BirdJS.Loop = class {
    constructor(update, render, step) {
      this.update = update; this.render = render; this.step = step || 1 / 120;
      this.acc = 0; this.last = 0; this.running = false; this.fps = 60; this.timeScale = 1;
      this._tick = this._tick.bind(this);
    }
    start() { if (this.running || !hasDOM) return; this.running = true; this.last = performance.now(); requestAnimationFrame(this._tick); }
    stop() { this.running = false; }
    _tick(now) {
      if (!this.running) return;
      let dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.05;
      this.acc += dt * this.timeScale;
      let n = 0;
      while (this.acc >= this.step && n < 8) { this.update(this.step); this.acc -= this.step; n++; }
      if (n === 8) this.acc = 0;
      this.render(dt);
      requestAnimationFrame(this._tick);
    }
  };

  /* ---------- Partículas y textos flotantes ---------- */
  BirdJS.Particles = class {
    constructor() { this.list = []; this.texts = []; }
    emit(p) {
      this.list.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, life: 0.8, age: 0, size: 6, grow: 0, color: '#fff', gravity: 600, rot: 0, vr: 0, shape: 'circle', alpha: 1, drag: 0.5 }, p));
    }
    burst(x, y, n, o) {
      o = o || {};
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, s = U.rand(o.minSpeed || 40, o.maxSpeed || 260);
        this.emit(Object.assign({}, o, { x: x + U.rand(-4, 4), y: y + U.rand(-4, 4), vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 0), life: U.rand((o.life || 0.6) * 0.6, (o.life || 0.6) * 1.2), size: U.rand((o.size || 6) * 0.6, (o.size || 6) * 1.3), rot: Math.random() * TAU, vr: U.rand(-8, 8), color: Array.isArray(o.color) ? U.pick(o.color) : o.color || '#fff' }));
      }
    }
    text(x, y, str, o) { this.texts.push(Object.assign({ x, y, str, age: 0, life: 1.2, color: '#fff', size: 26 }, o)); }
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i]; p.age += dt;
        if (p.age >= p.life) { this.list.splice(i, 1); continue; }
        p.vy += p.gravity * dt; const d = 1 / (1 + p.drag * dt); p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.size += p.grow * dt;
      }
      for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.age += dt; t.y -= 34 * dt; if (t.age >= t.life) this.texts.splice(i, 1); }
    }
    draw(ctx) {
      for (const p of this.list) {
        const k = p.age / p.life;
        ctx.globalAlpha = Math.max(0, p.alpha * (1 - k * k));
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
        } else { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    drawTexts(ctx, font) {
      ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      for (const t of this.texts) {
        const k = t.age / t.life;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = (t.size * (1 + 0.25 * Math.max(0, 1 - k * 6))) + 'px ' + (font || 'sans-serif');
        ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.strokeText(t.str, t.x, t.y);
        ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    }
  };

  /* ---------- Almacenamiento seguro ---------- */
  BirdJS.Storage = {
    get(k, def) { try { const v = localStorage.getItem('birdjs:' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('birdjs:' + k, JSON.stringify(v)); } catch (e) {} },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BirdJS;
  else root.BirdJS = BirdJS;
})(typeof window !== 'undefined' ? window : globalThis);
