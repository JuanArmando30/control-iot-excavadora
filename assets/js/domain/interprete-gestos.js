/**
 * Intérprete del modo IA: convierte lo que ve el reconocedor de manos (cuadro
 * a cuadro) en órdenes. No sabe nada de cámaras ni de la página: recibe
 * cuadros y avisa por callbacks, así se puede probar con datos simulados.
 *
 * Esquema "joystick en el aire" (una mano):
 *   ✊ Puño      → agarra el mando de CONDUCCIÓN; mover la mano ↑ ↓ ← → conduce.
 *   ✌️ Victoria  → agarra el mando de BRAZO Y PALA (↑ ↓ brazo, ← → pala).
 *   ✋ Mano abierta, sin mano o gesto dudoso → neutral (la página envía DETENER).
 *   👍 / 🤟 / ☝️ sostenidos → alternan luz / sonido / encendido (una vez;
 *   para repetir hay que abrir la mano antes: "rearme").
 *
 * Reglas de seguridad:
 *  - El centro es donde se cerró el puño (referencia relativa), y la distancia
 *    se mide en "tamaños de mano", así funciona cerca o lejos de la cámara.
 *  - Una forma cuenta solo si se mantiene CONFIRMAR_MS; la mano abierta
 *    detiene más rápido y perder la mano detiene a los PERDIDA_MS.
 *  - Tras bloquear() (DETENER, control bloqueado) no se vuelve a agarrar nada
 *    hasta que se abra la mano o salga de cuadro.
 *  - Zona neutral con histéresis, como el joystick y el giroscopio.
 */

export const FORMA = Object.freeze({
  puno: "Closed_Fist",
  abierta: "Open_Palm",
  victoria: "Victory",
  pulgarArriba: "Thumb_Up",
  pulgarAbajo: "Thumb_Down",
  teQuiero: "ILoveYou",
  indice: "Pointing_Up",
  ninguna: "None",        // mano visible pero sin forma clara (o confianza baja)
  sinMano: "SIN_MANO",
});

/** Forma → mando que agarra. */
export const MANDO_DE_FORMA = Object.freeze({ [FORMA.puno]: "conduccion", [FORMA.victoria]: "brazo" });

export const AJUSTES = Object.freeze({
  CONFIANZA: 0.55,        // por debajo, la forma se toma como "ninguna"
  CONFIRMAR_MS: 200,      // tiempo que debe mantenerse una forma para contar
  ABIERTA_MS: 100,        // la mano abierta detiene antes
  PERDIDA_MS: 300,        // sin mano este tiempo → neutral
  ENTRAR: 0.55,           // desplazamiento (en tamaños de mano) para empezar a mover
  SALIR: 0.35,            // para volver a neutral (histéresis)
  MAXIMO: 1.3,            // desplazamiento que lleva el indicador al borde
  HISTERESIS: 10,         // grados extra para conservar la dirección en la diagonal
  SUAVIZADO: 0.5,         // filtro paso bajo de la posición (1 = sin filtro)
});

const ANGULO = { derecha: 0, abajo: 90, izquierda: 180, arriba: -90 };
const grados = (r) => r * 180 / Math.PI;
const difAngulo = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const REARMAN = new Set([FORMA.abierta, FORMA.sinMano]);

export class InterpreteGestos {
  /**
   * @param {{onDireccion:(mando:string, dir:string|null)=>void, onAccesorio:(codigo:number)=>void}} cb
   * @param {{accesorios?: Object<string,{codigo:number, ms:number}>}} [op]
   */
  constructor(cb, { accesorios = {} } = {}) {
    this.cb = cb;
    this.accesorios = accesorios;
    this.habilitado = false;
    this.disponibles = { conduccion: new Set(), brazo: new Set() };
    this.esActivo = () => true;           // ¿el código del accesorio está activo en el catálogo?
    this.reiniciar();
  }

  reiniciar() {
    this.candidata = null;        // forma que se está viendo
    this.desde = 0;               // desde cuándo
    this.confirmada = null;       // forma que cuenta
    this.mando = null;            // mando agarrado (conduccion | brazo)
    this.dir = null;
    this.origen = null;           // {x, y, escala} donde se agarró
    this.pos = null;              // posición suavizada
    this.rearmado = true;         // un accesorio puede dispararse
    this.trabado = false;         // espera mano abierta tras bloquear()
    this.progreso = null;         // {codigo, p 0..1} del accesorio que se está sosteniendo
  }

  /**
   * @param {boolean} on control listo para mover
   * @param {{conduccion:Set<string>, brazo:Set<string>}} disponibles direcciones con comando activo
   * @param {(codigo:number)=>boolean} [esActivo]
   */
  configurar(on, disponibles = this.disponibles, esActivo = this.esActivo) {
    if (!on && this.habilitado && this.mando) this.trabado = true;    // al volver no sigue moviendo solo
    this.habilitado = on;
    this.disponibles = disponibles;
    this.esActivo = esActivo;
    if (!on) this._soltar();
  }

  /** Suelta el mando y no vuelve a agarrar hasta que se abra la mano (DETENER, pausa). */
  bloquear() {
    this.trabado = true;
    this.progreso = null;
    this._soltar();
  }

  /**
   * Procesa un cuadro.
   * @param {null|{forma:string, confianza:number, x:number, y:number, escala:number}} f
   *        x, y: centro de la palma en píxeles (x ya en el sentido del usuario: + = su derecha);
   *        escala: tamaño de la mano en píxeles. null = no hay mano.
   * @param {number} t tiempo en ms
   * @returns {{forma:string|null, mando:string|null, dir:string|null, vector:{x:number,y:number}|null,
   *            progreso:{codigo:number,p:number}|null, trabado:boolean}}
   */
  procesar(f, t) {
    const forma = !f ? FORMA.sinMano : (f.confianza < AJUSTES.CONFIANZA ? FORMA.ninguna : f.forma || FORMA.ninguna);
    if (forma !== this.candidata) { this.candidata = forma; this.desde = t; }
    const espera = forma === FORMA.sinMano ? AJUSTES.PERDIDA_MS : forma === FORMA.abierta ? AJUSTES.ABIERTA_MS : AJUSTES.CONFIRMAR_MS;
    if (forma !== this.confirmada && t - this.desde >= espera) this._confirmar(forma, f);

    // Mando agarrado: la posición de la mano decide la dirección (solo si la forma sigue siendo la misma).
    let vector = null;
    if (this.mando && f && forma === this.confirmada) {
      this.pos = this.pos
        ? { x: this.pos.x + AJUSTES.SUAVIZADO * (f.x - this.pos.x), y: this.pos.y + AJUSTES.SUAVIZADO * (f.y - this.pos.y) }
        : { x: f.x, y: f.y };
      vector = { x: (this.pos.x - this.origen.x) / this.origen.escala, y: (this.pos.y - this.origen.y) / this.origen.escala };
      this._cambiar(this._direccion(vector.x, vector.y));
    } else if (this.mando && this.origen && this.pos) {
      vector = { x: (this.pos.x - this.origen.x) / this.origen.escala, y: (this.pos.y - this.origen.y) / this.origen.escala };
    }

    // Accesorio sostenido.
    this.progreso = null;
    const acc = this.accesorios[forma];
    if (acc && forma === this.candidata && !this.mando && !this.trabado && this.rearmado && this.habilitado && this.esActivo(acc.codigo)) {
      const p = Math.min(1, (t - this.desde) / acc.ms);
      this.progreso = { codigo: acc.codigo, p };
      if (p >= 1) {
        this.rearmado = false;
        this.progreso = null;
        this.cb.onAccesorio(acc.codigo);
      }
    }
    return { forma: this.confirmada, mando: this.mando, dir: this.dir, vector, progreso: this.progreso, trabado: this.trabado };
  }

  _confirmar(forma, f) {
    this.confirmada = forma;
    if (REARMAN.has(forma)) { this.rearmado = true; this.trabado = false; }
    const nuevo = MANDO_DE_FORMA[forma] || null;
    if (this.mando && this.mando !== nuevo) this._soltar();
    if (nuevo && !this.mando && !this.trabado && this.habilitado && f) {
      this.mando = nuevo;
      this.dir = null;
      this.origen = { x: f.x, y: f.y, escala: Math.max(1, f.escala) };
      this.pos = { x: f.x, y: f.y };
    }
  }

  _soltar() {
    const { mando } = this;
    const teniaDir = !!this.dir;
    this.mando = null;
    this.dir = null;
    this.origen = null;
    this.pos = null;
    if (mando && teniaDir) this.cb.onDireccion(mando, null);
  }

  _direccion(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < (this.dir ? AJUSTES.SALIR : AJUSTES.ENTRAR)) return null;
    const ang = grados(Math.atan2(y, x));
    if (this.dir && difAngulo(ang, ANGULO[this.dir]) <= 45 + AJUSTES.HISTERESIS) return this.dir;
    let mejor = null, min = 999;
    for (const [dir, a] of Object.entries(ANGULO)) {
      const d = difAngulo(ang, a);
      if (d < min) { min = d; mejor = dir; }
    }
    return this.disponibles[this.mando]?.has(mejor) ? mejor : null;
  }

  _cambiar(dir) {
    if (!this.habilitado) dir = null;
    if (dir === this.dir) return;
    this.dir = dir;
    this.cb.onDireccion(this.mando, dir);
  }
}
