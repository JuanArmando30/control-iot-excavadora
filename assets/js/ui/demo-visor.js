/**
 * Reproduce en el mando lo que está haciendo la DEMO, paso a paso.
 *
 * Cada evento `demo_movimiento` del WebSocket trae el comando y cuánto dura.
 * Durante ese tiempo "brilla" lo que corresponde en TODAS las vistas a la vez
 * (solo se ve la del modo abierto, y si se cambia de modo a mitad también se ve):
 *  - Pulso:     el botón de la cruceta se hunde y brilla.
 *  - Joystick:  la perilla se desplaza hacia la dirección y brilla.
 *  - Giro:      el teléfono dibujado se inclina y se ilumina la etiqueta;
 *               los pasos de brazo/pala brillan en la botonera 2×2.
 *  - Voz:       una tarjeta grande con icono, acción y número de paso.
 *  - Luz, sonido, On/Off: brilla su botón. DETENER: destella el botón DETENER.
 * El resto del mando sigue atenuado (bloqueado). Es solo visual: no envía nada.
 */
import { Catalogo, MANDOS } from "../domain/catalogo.js";
import { CONFIG } from "../config.js";
import { icono } from "./dom.js";

const VECTOR = { arriba: [0, -1], abajo: [0, 1], izquierda: [-1, 0], derecha: [1, 0] };
const ICONO_DIR = { arriba: "i-up", abajo: "i-down", izquierda: "i-left", derecha: "i-right" };
const INCLINACION = 22;        // grados que se inclina el teléfono dibujado en Giro
const RECORRIDO = 88;          // % del tamaño de la perilla (= hasta el borde del recorrido del joystick)

/** codigo → {mando, dir} para los 8 comandos de los dos mandos. */
const POR_CODIGO = new Map();
for (const [mando, mapa] of Object.entries(MANDOS)) for (const [dir, c] of Object.entries(mapa)) POR_CODIGO.set(c, { mando, dir });

export class DemoVisor {
  /**
   * @param {{botonera: import("./botonera.js").Botonera,
   *          joysticks: Object<string, {base: HTMLElement, perilla: HTMLElement}>,
   *          nivel: HTMLElement, tarjeta: HTMLElement, stop: HTMLElement,
   *          obtenerCatalogo: () => import("../domain/catalogo.js").Catalogo}} op
   */
  constructor({ botonera, joysticks, nivel, tarjeta, stop, obtenerCatalogo }) {
    Object.assign(this, { botonera, joysticks, nivel, tarjeta, stop, obtenerCatalogo });
    this.timer = null;
    this.activos = [];
  }

  /** La DEMO arrancó: tarjeta de voz en «Iniciando…». */
  inicio(nombre, total) {
    this._tarjeta({ ic: "i-play", accion: "Iniciando…", detalle: `DEMO «${nombre || "en curso"}»${total ? ` · ${total} pasos` : ""}` });
  }

  /**
   * @param {{codigo:number, comando?:string|null, orden?:number, total?:number, duracionMs?:number}} p
   */
  paso({ codigo, comando, orden, total, duracionMs }) {
    this._apagar();
    const cat = this.obtenerCatalogo();
    const cmd = cat.porCodigo(codigo);
    const accion = cmd ? Catalogo.etiqueta(cmd) : Catalogo.etiqueta({ nombre: comando || `Código ${codigo}` });
    const esParo = cat.detener && codigo === cat.detener.codigo;
    const d = POR_CODIGO.get(codigo);

    // Botones con ese código (crucetas de Pulso, botonera 2×2 de Giro, accesorios).
    for (const b of this.botonera.botones.get(codigo) || []) this._encender(b);

    if (d) {
      const [vx, vy] = VECTOR[d.dir];
      const j = this.joysticks[d.mando];
      if (j) {
        j.perilla.style.transform = `translate(${vx * RECORRIDO}%, ${vy * RECORRIDO}%)`;
        this._encender(j.base);
        j.base.querySelector(`[data-dir="${d.dir}"]`)?.classList.add("on");
      }
      if (d.mando === "conduccion") {
        this.nivel.style.setProperty("--gx", String(vx * INCLINACION));
        this.nivel.style.setProperty("--gy", String(vy * INCLINACION));
        this._encender(this.nivel);
        this.nivel.querySelector(`[data-dir="${d.dir}"]`)?.classList.add("on");
      }
    }
    if (esParo) this._encender(this.stop, "demo-paro");

    this._tarjeta({
      ic: esParo ? "i-stop" : d && d.mando === "conduccion" ? ICONO_DIR[d.dir] : CONFIG.iconos[codigo] || "i-bolt",
      accion,
      detalle: orden ? `Paso ${orden}${total ? ` de ${total}` : ""}` : "",
    });
    this.timer = setTimeout(() => this._apagar(), Math.max(350, duracionMs || 600));
  }

  /** La DEMO terminó o se canceló: todo a reposo y sin tarjeta. */
  fin() {
    this._apagar();
    if (this.tarjeta) this.tarjeta.hidden = true;
  }

  _encender(n, clase = "demo-activo") {
    n.classList.add(clase);
    this.activos.push([n, clase]);
  }

  /** Vuelve a reposo lo que encendió el paso anterior (la tarjeta de voz se queda hasta el siguiente). */
  _apagar() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const [n, clase] of this.activos) n.classList.remove(clase);
    this.activos = [];
    for (const j of Object.values(this.joysticks)) {
      j.perilla.style.transform = "";
      j.base.querySelectorAll("[data-dir].on").forEach((m) => m.classList.remove("on"));
    }
    this.nivel.style.setProperty("--gx", "0");
    this.nivel.style.setProperty("--gy", "0");
    this.nivel.querySelectorAll("[data-dir].on").forEach((m) => m.classList.remove("on"));
  }

  _tarjeta({ ic, accion, detalle }) {
    const t = this.tarjeta;
    if (!t) return;
    t.querySelector(".demo-paso-ico").replaceChildren(icono(ic));
    t.querySelector(".demo-paso-accion").textContent = accion;
    t.querySelector(".demo-paso-num").textContent = detalle || "DEMO";
    t.hidden = false;
    t.classList.remove("latido");
    void t.offsetWidth;                 // reinicia la animación en cada paso
    t.classList.add("latido");
  }
}
