/**
 * Modo Táctil: superficie para DESLIZAR con el dedo (o arrastrar con el mouse).
 *
 * - Cada deslizamiento completo envía UN pulso en la dirección dominante
 *   (arriba = avanzar, abajo = retroceder, izquierda, derecha), igual que
 *   tocar una flecha en modo Pulso. Se decide al LEVANTAR el dedo.
 * - El inicio puede estar en cualquier parte de la superficie.
 * - Mientras se arrastra se dibuja un trazo luminoso que se desvanece y se
 *   ilumina la flecha de la dirección que se enviará.
 * - Un toque sin desplazamiento, un trazo muy corto o una diagonal ambigua no
 *   envían nada (se explica en pantalla).
 * - Pointer Events: el mismo código para dedo, mouse y lápiz.
 * - La DEMO también "dibuja" sus pasos de conducción con dibujarDemo().
 */
const VECTOR = { arriba: [0, -1], abajo: [0, 1], izquierda: [-1, 0], derecha: [1, 0] };
const DOMINIO = 1.3;           // el eje dominante debe ser 1.3× el otro (si no, diagonal ambigua)
const VIDA_MS = 650;           // cuánto tarda en desvanecerse cada punto del trazo
const MIN_PX = 36;

export class Tactil {
  /**
   * @param {HTMLElement} base superficie (recibe los eventos)
   * @param {HTMLCanvasElement} lienzo canvas para el trazo
   * @param {{onDeslizar:(dir:string)=>void, onAviso:(txt:string, tipo?:string)=>void, onBloqueado:()=>void}} cb
   */
  constructor(base, lienzo, cb) {
    Object.assign(this, { base, lienzo, cb });
    this.ctx = lienzo.getContext("2d");
    this.habilitado = false;
    this.disponibles = new Set();
    this.trazo = null;           // {id, x0, y0, x, y}
    this.puntos = [];            // {x, y, t, demo}
    this.raf = 0;
    this.timerFlecha = null;

    base.addEventListener("pointerdown", (e) => this._inicio(e));
    base.addEventListener("pointermove", (e) => this._mover(e));
    base.addEventListener("pointerup", (e) => this._fin(e, false));
    base.addEventListener("pointercancel", (e) => this._fin(e, true));
    base.addEventListener("lostpointercapture", (e) => { if (this.trazo?.id === e.pointerId) this._fin(e, true); });
    base.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => this._ajustarLienzo()).observe(base);
  }

  /** @param {boolean} on control listo @param {Set<string>} disponibles direcciones con comando activo */
  configurar(on, disponibles = this.disponibles) {
    this.habilitado = on;
    this.disponibles = disponibles;
    this.base.classList.toggle("deshabilitado", !on);
    this.base.querySelectorAll("[data-dir]").forEach((f) => f.classList.toggle("no-disp", !disponibles.has(f.dataset.dir)));
    if (!on && this.trazo) this._cancelar();
  }

  /** Cancela el trazo en curso (cambio de modo, DETENER). */
  cancelar() { if (this.trazo) this._cancelar(); }

  /** DEMO: dibuja un deslizamiento desde el centro hacia `dir`. */
  dibujarDemo(dir) {
    const [vx, vy] = VECTOR[dir] || [0, 0];
    const { width: w, height: h } = this.base.getBoundingClientRect();
    if (!w || !h) return;
    const largo = Math.min(w, h) * 0.34;
    const cx = w / 2 - vx * largo / 2, cy = h / 2 - vy * largo / 2;
    const t0 = performance.now(), dur = 420;
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      this.puntos.push({ x: cx + vx * largo * e, y: cy + vy * largo * e, t, demo: true });
      this._dibujar();
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  /** Borra trazos y flechas (fin de la DEMO, cambio de modo). */
  limpiar() {
    this.puntos = [];
    this._dibujar();
  }

  /* ----------------------------- Eventos ----------------------------- */

  _pos(e) {
    const r = this.base.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _inicio(e) {
    if (e.button > 0 || this.trazo) return;          // solo botón principal y un dedo a la vez
    if (!this.habilitado) { this.cb.onBloqueado(); return; }
    e.preventDefault();
    this.base.setPointerCapture?.(e.pointerId);
    const p = this._pos(e);
    this.trazo = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
    this.base.classList.add("deslizando");
    this.puntos.push({ ...p, t: performance.now(), vivo: true });
    this._dibujar();
  }

  _mover(e) {
    const tr = this.trazo;
    if (!tr || e.pointerId !== tr.id) return;
    const lista = e.getCoalescedEvents?.() || [e];
    for (const ev of lista) {
      const p = this._pos(ev);
      tr.x = p.x; tr.y = p.y;
      this.puntos.push({ ...p, t: performance.now(), vivo: true });
    }
    this._marcar(this._leer().dir, "previa");
    this._dibujar();
  }

  _fin(e, cancelado) {
    const tr = this.trazo;
    if (!tr || e.pointerId !== tr.id) return;
    this.trazo = null;
    this._soltarTrazo();
    this.base.classList.remove("deslizando");
    try { this.base.releasePointerCapture?.(e.pointerId); } catch { /* ya liberado */ }
    if (cancelado) { this._marcar(null); return; }
    const p = this._pos(e);
    tr.x = p.x; tr.y = p.y;
    const { dir, motivo } = this._leer(tr);
    if (!dir) {
      this._marcar(null);
      if (motivo) this.cb.onAviso(motivo, "aviso");
      return;
    }
    if (!this.disponibles.has(dir)) { this._marcar(null); this.cb.onAviso("Esa dirección no está activa en el catálogo.", "aviso"); return; }
    this._marcar(dir, "enviada");
    this.cb.onDeslizar(dir);
  }

  _cancelar() {
    const id = this.trazo?.id;
    this.trazo = null;
    this._soltarTrazo();
    this.base.classList.remove("deslizando");
    try { if (id != null) this.base.releasePointerCapture?.(id); } catch { /* */ }
    this._marcar(null);
  }

  /** Dirección dominante del trazo actual (o por qué no hay). */
  _leer(tr = this.trazo || {}) {
    const dx = (tr.x ?? 0) - (tr.x0 ?? 0), dy = (tr.y ?? 0) - (tr.y0 ?? 0);
    const { width: w, height: h } = this.base.getBoundingClientRect();
    const umbral = Math.max(MIN_PX, Math.min(w, h) * 0.12);
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < umbral) return { dir: null, motivo: ax + ay < 6 ? "" : "Desliza un poco más largo." };
    if (Math.max(ax, ay) < DOMINIO * Math.min(ax, ay)) return { dir: null, motivo: "Desliza en línea recta: arriba, abajo, izquierda o derecha." };
    return { dir: ax > ay ? (dx > 0 ? "derecha" : "izquierda") : (dy > 0 ? "abajo" : "arriba"), motivo: "" };
  }

  /** Ilumina la flecha: "previa" mientras arrastra, "enviada" al soltar (un momento). */
  _marcar(dir, clase) {
    clearTimeout(this.timerFlecha);
    this.base.querySelectorAll(".tactil-flecha").forEach((f) => {
      f.classList.toggle("previa", clase === "previa" && f.dataset.dir === dir);
      f.classList.toggle("enviada", clase === "enviada" && f.dataset.dir === dir);
    });
    if (clase === "enviada") {
      this.timerFlecha = setTimeout(() => this.base.querySelectorAll(".tactil-flecha.enviada").forEach((f) => f.classList.remove("enviada")), 700);
    }
  }

  /* ----------------------------- Dibujo ----------------------------- */

  /** Al soltar, el trazo se desvanece de la cola a la punta. */
  _soltarTrazo() {
    const vivos = this.puntos.filter((p) => p.vivo);
    const ahora = performance.now();
    vivos.forEach((p, i) => { p.vivo = false; p.t = ahora - VIDA_MS * 0.6 * (1 - (i + 1) / vivos.length); });
    this._dibujar();
  }

  _ajustarLienzo() {
    const r = this.base.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.lienzo.width = Math.round(r.width * dpr);
    this.lienzo.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._dibujar();
  }

  _dibujar() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this._pintar(); });
  }

  _pintar() {
    const ctx = this.ctx;
    const ahora = performance.now();
    // Los puntos del trazo en curso (vivo) no se desvanecen hasta soltar.
    this.puntos = this.puntos.filter((p) => p.vivo || ahora - p.t < VIDA_MS);
    ctx.clearRect(0, 0, this.lienzo.width, this.lienzo.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < this.puntos.length; i++) {
      const a = this.puntos[i - 1], b = this.puntos[i];
      if (a.demo !== b.demo) continue;
      const edad = b.vivo ? 0 : (ahora - b.t) / VIDA_MS;
      const alfa = Math.max(0, 1 - edad);
      const color = b.demo ? "179,168,255" : "70,211,255";
      ctx.strokeStyle = `rgba(${color},${alfa})`;
      ctx.lineWidth = 4 + 10 * alfa;
      ctx.shadowColor = `rgba(${color},${alfa})`;
      ctx.shadowBlur = 18 * alfa;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // Punto de inicio y punta del trazo en curso
    if (this.trazo) {
      const t = this.trazo;
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.beginPath(); ctx.arc(t.x0, t.y0, 6, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(70,211,255,1)";
      ctx.beginPath(); ctx.arc(t.x, t.y, 13, 0, 7); ctx.fill();
    }
    if (this.puntos.length || this.trazo) this._dibujar();
  }
}
