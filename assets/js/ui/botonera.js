/**
 * Crucetas (modo Pulso) de los dos mandos y botones centrales generados
 * desde el catálogo.
 * Estados visibles: normal, presionado, enviando, aceptado, error, deshabilitado.
 */
import { CONFIG } from "../config.js";
import { Catalogo, DIRECCIONES, MANDOS } from "../domain/catalogo.js";
import { FASE } from "../domain/comando-service.js";
import { el, icono, vibrar } from "./dom.js";

const ICONO_DIR = { arriba: "i-up", abajo: "i-down", izquierda: "i-left", derecha: "i-right" };
const ICONO_EJE = { conduccion: "i-gamepad", brazo: "i-arm" };
const SIN_COMANDO = {
  conduccion: { arriba: "avanzar", abajo: "retroceder", izquierda: "girar a la izquierda", derecha: "girar a la derecha" },
  brazo: { arriba: "subir el brazo", abajo: "bajar el brazo", izquierda: "girar la pala a la izquierda", derecha: "girar la pala a la derecha" },
};
const DURACION_FLASH = 1300;

export class Botonera {
  /**
   * @param {{crucetas: Object<string, HTMLElement>, secundarios: HTMLElement,
   *          onPulsar: (codigo:number, origenUi:"cruceta"|"boton") => void}} op
   */
  constructor({ crucetas, secundarios, onPulsar }) {
    Object.assign(this, { crucetas, secundarios, onPulsar });
    this.botones = new Map();          // codigo → [botones]
    this.timers = new Map();
    this.habilitado = false;
    this.bloqueoSecundarios = false;
    this.bloqueoBrazo = false;
    this.interruptores = {};           // codigo → true (encendido) / false
  }

  render(catalogo) {
    this.botones.clear();

    // ---- Crucetas: una por mando ----
    for (const [clave, contenedor] of Object.entries(this.crucetas)) {
      if (!contenedor) continue;
      const mando = contenedor.dataset.mando || clave;        // p. ej. botonesGiro → mando "brazo"
      const piezas = DIRECCIONES.map((dir) => this._boton(catalogo.direccion(dir, mando), {
        icono: mando === "conduccion" ? ICONO_DIR[dir] : (CONFIG.iconos[MANDOS[mando][dir]] || ICONO_DIR[dir]),
        clase: `cbtn dir-${dir}`,
        origen: "cruceta",
        sinCatalogo: `Sin comando para ${SIN_COMANDO[mando][dir]}`,
      }));
      const compacta = contenedor.classList.contains("botones-brazo");   // 2×2, sin centro
      const eje = compacta ? null : el("div", { class: "cruceta-eje", attrs: { "aria-hidden": "true" } }, [icono(ICONO_EJE[mando])]);
      contenedor.replaceChildren(...piezas, ...(eje ? [eje] : []));
    }

    // ---- Centro: luz, sonido, encendido y cualquier otro comando activo ----
    const sec = catalogo.secundarios();
    if (!sec.length) {
      this.secundarios.replaceChildren(el("p", { class: "vacio", text: catalogo.cargado
        ? "Sin acciones adicionales activas."
        : "Catálogo no disponible." }));
    } else {
      this.secundarios.replaceChildren(...sec.map((c) =>
        this._boton(c, { icono: CONFIG.iconos[c.codigo] || "i-bolt", clase: "cbtn cbtn-sec", origen: "boton" })));
    }
    this._aplicarHabilitado();
    this._aplicarInterruptores();
  }

  _boton(cmd, { icono: ic, clase, origen, sinCatalogo = "" }) {
    const etiqueta = cmd ? Catalogo.etiqueta(cmd) : "No disponible";
    const b = el("button", {
      class: clase,
      attrs: {
        type: "button",
        title: cmd ? `${cmd.nombre} · código ${cmd.codigo}${cmd.descripcion ? " · " + cmd.descripcion : ""}` : sinCatalogo,
        "aria-label": cmd ? etiqueta : sinCatalogo,
      },
      dataset: cmd ? { codigo: cmd.codigo } : {},
    }, [
      icono(ic),
      el("span", { class: "cbtn-txt", text: cmd ? Catalogo.etiquetaCorta(cmd) : etiqueta }),
      el("span", { class: "cbtn-estado", attrs: { "aria-hidden": "true" } }),
    ]);

    if (!cmd) { b.disabled = true; b.classList.add("sin-catalogo"); return b; }

    const lista = this.botones.get(cmd.codigo) || [];
    lista.push(b);
    this.botones.set(cmd.codigo, lista);

    const pulsar = () => { if (!b.disabled) { vibrar(); this.onPulsar(cmd.codigo, origen); } };
    b.addEventListener("pointerdown", (e) => {
      if (b.disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();                       // respuesta inmediata en táctil
      b.classList.add("is-pressed");
      pulsar();
    });
    const soltar = () => b.classList.remove("is-pressed");
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(t, soltar);
    b.addEventListener("click", (e) => { if (e.detail === 0) pulsar(); });   // Enter / Espacio
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }

  /** @param {boolean} habilitado @param {{bloquearSecundarios?: boolean, bloquearBrazo?: boolean}} op */
  setHabilitado(habilitado, { bloquearSecundarios = false, bloquearBrazo = false } = {}) {
    this.habilitado = habilitado;
    this.bloqueoSecundarios = bloquearSecundarios;
    this.bloqueoBrazo = bloquearBrazo;
    this._aplicarHabilitado();
  }

  _aplicarHabilitado() {
    for (const [, lista] of this.botones) {
      for (const b of lista) {
        const esSec = b.classList.contains("cbtn-sec");
        const esBrazo = Object.values(this.crucetas).some((c) => c && (c.dataset.mando || "") === "brazo" && c.contains(b))
          || !!this.crucetas.brazo?.contains(b);
        b.disabled = !this.habilitado || (esSec && this.bloqueoSecundarios) || (esBrazo && this.bloqueoBrazo);
        if (b.disabled) b.classList.remove("is-pressed");
      }
    }
  }

  aplicarFase({ codigo, fase, mensaje }) {
    const lista = this.botones.get(codigo);
    if (!lista) return;
    clearTimeout(this.timers.get(codigo));
    for (const b of lista) {
      b.classList.remove("is-sending", "is-ok", "is-error");
      const est = b.querySelector(".cbtn-estado");
      if (fase === FASE.ENVIANDO) { b.classList.add("is-sending"); est.textContent = "Enviando"; }
      else if (fase === FASE.ACEPTADO) { b.classList.add("is-ok"); est.textContent = "Aceptado"; }
      else if (fase === FASE.ERROR) { b.classList.add("is-error"); est.textContent = "Error"; b.dataset.error = mensaje || ""; }
      else est.textContent = "";
    }
    if (fase === FASE.ACEPTADO || fase === FASE.ERROR) {
      this.timers.set(codigo, setTimeout(() => {
        for (const b of lista) { b.classList.remove("is-ok", "is-error"); b.querySelector(".cbtn-estado").textContent = ""; }
      }, DURACION_FLASH));
    }
  }

  /** Estado de los accesorios interruptor (luz, sonido, encendido): el botón queda marcado mientras sigan encendidos. */
  setInterruptor(codigo, encendido) {
    this.interruptores[codigo] = !!encendido;
    this._aplicarInterruptores();
  }

  _aplicarInterruptores() {
    for (const [codigo, txt] of Object.entries(CONFIG.interruptores)) {
      const on = !!this.interruptores[codigo];
      for (const b of this.botones.get(Number(codigo)) || []) {
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
        b.dataset.estado = on ? "ON" : "";
        b.title = `${b.title.split(" · Estado:")[0]} · Estado: ${on ? txt.on : txt.off}`;
      }
    }
  }

  /** Marca brevemente el comando que el backend reporta por WebSocket. */
  marcarActivo(codigo) {
    for (const [c, lista] of this.botones) for (const b of lista) b.classList.toggle("is-activo", c === codigo);
    clearTimeout(this.timers.get("activo"));
    this.timers.set("activo", setTimeout(() => {
      for (const [, lista] of this.botones) for (const b of lista) b.classList.remove("is-activo");
    }, 2500));
  }
}
