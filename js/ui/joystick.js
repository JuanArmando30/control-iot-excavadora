/**
 * Joystick circular con Pointer Events (mouse, táctil y lápiz).
 * - Zona neutral con histéresis (entrar cuesta más que salir).
 * - Solo notifica CAMBIOS de dirección (nunca por píxel o fotograma).
 * - Al soltar, cancelar o perder el puntero vuelve al centro y notifica null.
 * - Teclado: con el joystick enfocado, las flechas lo mueven y al soltar vuelve.
 */

const ANGULO = { derecha: 0, abajo: 90, izquierda: 180, arriba: -90 };   // eje Y hacia abajo
const HISTERESIS = 12;
const TECLAS = { ArrowUp: "arriba", ArrowDown: "abajo", ArrowLeft: "izquierda", ArrowRight: "derecha" };

const difAngulo = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export class Joystick {
  /**
   * @param {HTMLElement} base Elemento circular.
   * @param {HTMLElement} perilla Elemento que se desplaza.
   * @param {{onDireccion: (dir: string|null) => void}} op
   */
  constructor(base, perilla, { onDireccion }) {
    Object.assign(this, { base, perilla, onDireccion });
    this.pid = null;
    this.dir = null;
    this.habilitado = false;
    this.disponibles = new Set();
    this.frame = 0;
    this.ultimoPunto = null;
    this.teclaActiva = null;

    base.addEventListener("pointerdown", (e) => this._down(e));
    base.addEventListener("pointermove", (e) => this._move(e));
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) {
      base.addEventListener(t, (e) => { if (e.pointerId === this.pid) this.soltar(); });
    }
    base.addEventListener("contextmenu", (e) => e.preventDefault());
    base.addEventListener("keydown", (e) => this._tecla(e, true));
    base.addEventListener("keyup", (e) => this._tecla(e, false));
    base.addEventListener("blur", () => { if (this.teclaActiva) this.soltar(); });
    window.addEventListener("blur", () => this.soltar());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.soltar(); });
  }

  /** @param {boolean} on @param {Set<string>} disponibles direcciones con comando activo */
  configurar(on, disponibles = this.disponibles) {
    this.habilitado = on;
    this.disponibles = disponibles;
    this.base.classList.toggle("deshabilitado", !on);
    this.base.setAttribute("aria-disabled", String(!on));
    this.base.querySelectorAll("[data-dir]").forEach((m) => {
      m.classList.toggle("no-disp", !disponibles.has(m.dataset.dir));
    });
    if (!on) this.soltar();
  }

  get activo() { return this.pid !== null || this.teclaActiva !== null; }

  soltar() {
    const habia = this.activo || this.dir !== null;
    if (this.pid !== null) { try { this.base.releasePointerCapture(this.pid); } catch { /* */ } }
    this.pid = null;
    this.teclaActiva = null;
    cancelAnimationFrame(this.frame);
    this.base.classList.remove("arrastrando");
    this.perilla.style.transform = "";
    if (habia) this._cambiar(null);
  }

  _down(e) {
    if (!this.habilitado || this.pid !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    this.pid = e.pointerId;
    try { this.base.setPointerCapture(e.pointerId); } catch { /* */ }
    this.base.classList.add("arrastrando");
    this._procesar(e.clientX, e.clientY);
  }

  _move(e) {
    if (e.pointerId !== this.pid) return;
    this.ultimoPunto = [e.clientX, e.clientY];
    if (this.frame) return;                          // un cálculo por fotograma como máximo
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.pid !== null && this.ultimoPunto) this._procesar(...this.ultimoPunto);
    });
  }

  _procesar(x, y) {
    const r = this.base.getBoundingClientRect();
    const radio = r.width / 2;
    const recorrido = radio * 0.58;
    let dx = x - (r.left + radio), dy = y - (r.top + radio);
    const dist = Math.hypot(dx, dy);
    if (dist > recorrido) { dx *= recorrido / dist; dy *= recorrido / dist; }
    this.perilla.style.transform = `translate(${dx}px, ${dy}px)`;
    this._cambiar(this._direccion(dx, dy, recorrido));
  }

  _direccion(dx, dy, recorrido) {
    const zona = recorrido * (this.dir ? 0.24 : 0.36);
    if (Math.hypot(dx, dy) < zona) return null;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    if (this.dir && difAngulo(ang, ANGULO[this.dir]) <= 45 + HISTERESIS) return this.dir;
    let mejor = null, min = 999;
    for (const [dir, a] of Object.entries(ANGULO)) {
      const d = difAngulo(ang, a);
      if (d < min) { min = d; mejor = dir; }
    }
    return this.disponibles.has(mejor) ? mejor : null;   // dirección sin comando = neutral
  }

  _tecla(e, abajo) {
    const dir = TECLAS[e.key];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    if (abajo) {
      if (!this.habilitado || e.repeat || this.teclaActiva === dir) return;
      if (!this.disponibles.has(dir)) return;
      this.teclaActiva = dir;
      const desp = { arriba: [0, -1], abajo: [0, 1], izquierda: [-1, 0], derecha: [1, 0] }[dir];
      const r = this.base.getBoundingClientRect().width / 2 * 0.58;
      this.perilla.style.transform = `translate(${desp[0] * r}px, ${desp[1] * r}px)`;
      this._cambiar(dir);
    } else if (this.teclaActiva === dir) {
      this.soltar();
    }
  }

  _cambiar(dir) {
    if (dir === this.dir) return;
    this.dir = dir;
    this.base.querySelectorAll("[data-dir]").forEach((m) => m.classList.toggle("on", m.dataset.dir === dir));
    this.onDireccion(dir);
  }
}
