/**
 * Conducción por inclinación del teléfono (evento `deviceorientation`).
 *
 * - Funciona sostenido en vertical u horizontal, plano o casi de pie: con
 *   beta/gamma se calcula hacia dónde apunta "arriba" en coordenadas de la
 *   PANTALLA (corrigiendo el giro de pantalla), y de ahí dos ángulos:
 *     lado     = inclinar a izquierda/derecha (como un volante o una bandeja)
 *     adelante = inclinar el borde superior lejos de ti / hacia ti
 * - «Centrar» toma la postura actual como neutral; al activar se centra solo.
 * - Igual que el joystick: zona neutral con histéresis y solo notifica
 *   CAMBIOS de dirección (null = neutral → la página envía DETENER).
 * - Seguridad: se pausa (y notifica null) al ocultar la pestaña, perder el
 *   foco, girar la pantalla, si el sensor deja de enviar datos o si la
 *   inclinación es exagerada (teléfono soltado o volteado); en ese caso no
 *   vuelve a conducir hasta que el teléfono regrese a la postura neutral.
 */

const ANGULO = { derecha: 0, abajo: 90, izquierda: 180, arriba: -90 };   // eje Y hacia abajo = atrás
const ENTRAR = 12;          // grados de inclinación para empezar a mover
const SALIR = 7;            // grados para volver a neutral (histéresis)
const MAXIMO = 30;          // inclinación que lleva la burbuja al borde
const EXCESIVO = 65;        // más que esto = teléfono soltado o volteado → neutral
const HISTERESIS = 8;       // grados extra para conservar la dirección en la diagonal
const SUAVIZADO = 0.35;     // filtro paso bajo (0 = nada, 1 = sin filtro)
const SIN_DATOS_MS = 700;

const rad = (g) => g * Math.PI / 180;
const grados = (r) => r * 180 / Math.PI;
const difAngulo = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const envolver = (g) => ((g + 540) % 360) - 180;

function anguloPantalla() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return ((Number(a) % 360) + 360) % 360;
}

export const giroscopioPosible = () => "DeviceOrientationEvent" in window;

export class Giroscopio {
  /**
   * @param {HTMLElement} base indicador; recibe --gx/--gy (grados, ±MAXIMO) y CSS dibuja el teléfono inclinado
   * @param {{onDireccion:(dir:string|null)=>void, onEstado:(txt:string, tipo?:string)=>void,
   *          onCambio:(activo:boolean)=>void}} cb
   */
  constructor(base, cb) {
    Object.assign(this, { base, cb });
    this.activo = false;
    this.habilitado = false;
    this.disponibles = new Set();
    this.dir = null;
    this.cero = null;            // {lado, pitch} de la postura neutral
    this.filtro = null;          // {x, y} suavizado, en grados
    this.trabado = false;        // tras una inclinación excesiva: no conduce hasta volver a neutral
    this.ultimo = 0;
    this.recibio = false;
    this.vigia = null;
    this._evento = (e) => this._leer(e);

    const pausarPor = (motivo) => { if (this.activo) this.pausar(motivo); };
    document.addEventListener("visibilitychange", () => { if (document.hidden) pausarPor("Pausado: la página quedó en segundo plano."); });
    window.addEventListener("blur", () => pausarPor("Pausado: la ventana perdió el foco."));
    const alGirar = () => {
      if (!this.activo) return;
      this._cambiar(null);
      this.cero = null;           // la siguiente lectura será la nueva postura neutral
      this.cb.onEstado("Pantalla girada: posición neutral tomada de nuevo.");
    };
    screen.orientation?.addEventListener?.("change", alGirar);
    window.addEventListener("orientationchange", alGirar);
  }

  /** @param {boolean} on control listo @param {Set<string>} disponibles direcciones con comando activo */
  configurar(on, disponibles = this.disponibles) {
    this.habilitado = on;
    this.disponibles = disponibles;
    this.base.classList.toggle("deshabilitado", !on);
    this.base.querySelectorAll("[data-dir]").forEach((m) => m.classList.toggle("no-disp", !disponibles.has(m.dataset.dir)));
    if (!on && this.dir) this._cambiar(null);
  }

  /** Debe llamarse desde un toque del usuario (iOS pide permiso en ese momento). */
  async activar() {
    if (!giroscopioPosible()) { this.cb.onEstado("Este navegador no ofrece el sensor de orientación.", "error"); return false; }
    if (!window.isSecureContext) { this.cb.onEstado("El giroscopio solo funciona en páginas HTTPS.", "error"); return false; }
    const pedir = window.DeviceOrientationEvent?.requestPermission;
    if (typeof pedir === "function") {
      try {
        if (await pedir.call(DeviceOrientationEvent) !== "granted") {
          this.cb.onEstado("Permiso de movimiento denegado. Actívalo en Ajustes del navegador.", "error");
          return false;
        }
      } catch {
        this.cb.onEstado("No se pudo pedir permiso para el sensor de movimiento.", "error");
        return false;
      }
    }
    this.cero = null;
    this.filtro = null;
    this.trabado = false;
    this.recibio = false;
    this.ultimo = performance.now();
    this.activo = true;
    window.addEventListener("deviceorientation", this._evento);
    clearInterval(this.vigia);
    this.vigia = setInterval(() => this._vigilar(), 250);
    this.base.classList.add("activo");
    this.cb.onCambio(true);
    this.cb.onEstado("Sostén el teléfono cómodo; inclínalo para conducir.");
    return true;
  }

  pausar(motivo = "Giroscopio en pausa.") {
    const estaba = this.activo;
    this.activo = false;
    window.removeEventListener("deviceorientation", this._evento);
    clearInterval(this.vigia);
    this.vigia = null;
    this.base.classList.remove("activo");
    this._pintar(0, 0);
    this._cambiar(null);
    if (estaba) { this.cb.onCambio(false); this.cb.onEstado(motivo); }
  }

  /** La postura actual pasa a ser la neutral. */
  centrar() {
    this.cero = null;
    this.filtro = null;
    this.trabado = false;
    this._cambiar(null);
    if (this.activo) this.cb.onEstado("Centrado: esta postura es la neutral.");
  }

  _vigilar() {
    if (!this.activo) return;
    if (performance.now() - this.ultimo > SIN_DATOS_MS) {
      if (this.dir) this._cambiar(null);
      this.cb.onEstado(this.recibio
        ? "El sensor dejó de enviar datos: carrito detenido."
        : "No llegan datos del sensor. ¿Este dispositivo tiene giroscopio?", "error");
    }
  }

  _leer(e) {
    if (e.beta == null || e.gamma == null) return;
    const ahora = performance.now();
    const volvio = this.recibio && ahora - this.ultimo > SIN_DATOS_MS;
    this.ultimo = ahora;
    if (!this.recibio || volvio) { this.recibio = true; this.cb.onEstado("Sensor en línea: inclina para conducir."); }

    // Vector "arriba" en coordenadas del dispositivo (x derecha, y hacia el borde superior, z fuera de la pantalla).
    const b = rad(e.beta), g = rad(e.gamma);
    const ux = -Math.sin(g) * Math.cos(b), uy = Math.sin(b), uz = Math.cos(g) * Math.cos(b);
    // ... y en coordenadas de la PANTALLA, según cómo esté girada.
    const a = rad(anguloPantalla());
    const sx = ux * Math.cos(a) - uy * Math.sin(a);
    const sy = ux * Math.sin(a) + uy * Math.cos(a);
    const lado = grados(Math.asin(Math.max(-1, Math.min(1, -sx))));     // + = borde derecho abajo
    const pitch = grados(Math.atan2(sy, uz));                          // baja al alejar el borde superior

    if (!this.cero) this.cero = { lado, pitch };
    const x = lado - this.cero.lado;                                   // + = derecha
    const y = envolver(pitch - this.cero.pitch);                       // + = hacia ti = atrás

    // Exceso medido SIN suavizar: paro inmediato, sin pasar por direcciones intermedias.
    if (Math.hypot(x, y) > EXCESIVO) {
      if (!this.trabado) this.cb.onEstado("Inclinación excesiva: carrito detenido. Vuelve a la postura neutral.", "error");
      this.trabado = true;
      this._cambiar(null);
    }
    this.filtro = this.filtro
      ? { x: this.filtro.x + SUAVIZADO * (x - this.filtro.x), y: this.filtro.y + SUAVIZADO * (y - this.filtro.y) }
      : { x, y };
    this._procesar(this.filtro.x, this.filtro.y);
  }

  _procesar(x, y) {
    const mag = Math.hypot(x, y);
    const k = Math.min(mag, MAXIMO) / (mag || 1);
    this._pintar(x * k, y * k);

    if (this.trabado) {
      if (mag > SALIR) return;                          // espera a que el teléfono vuelva a neutral
      this.trabado = false;
      this.cb.onEstado("De vuelta en neutral: inclina para conducir.");
    }
    if (!this.habilitado) return;
    this._cambiar(this._direccion(x, y, mag));
  }

  _pintar(x, y) {
    this.base.style.setProperty("--gx", x.toFixed(1));
    this.base.style.setProperty("--gy", y.toFixed(1));
  }

  _direccion(x, y, mag) {
    if (mag < (this.dir ? SALIR : ENTRAR)) return null;
    const ang = grados(Math.atan2(y, x));
    if (this.dir && difAngulo(ang, ANGULO[this.dir]) <= 45 + HISTERESIS) return this.dir;
    let mejor = null, min = 999;
    for (const [dir, a] of Object.entries(ANGULO)) {
      const d = difAngulo(ang, a);
      if (d < min) { min = d; mejor = dir; }
    }
    return this.disponibles.has(mejor) ? mejor : null;
  }

  _cambiar(dir) {
    if (dir === this.dir) return;
    this.dir = dir;
    this.base.querySelectorAll("[data-dir]").forEach((m) => m.classList.toggle("on", m.dataset.dir === dir));
    this.cb.onDireccion(dir);
  }
}
