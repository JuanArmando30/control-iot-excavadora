/**
 * Cruceta (modo Pulso) y botones secundarios generados desde el catálogo.
 * Estados visibles: normal, presionado, enviando, aceptado, error, deshabilitado.
 */
import { CONFIG } from "../config.js";
import { Catalogo, DIRECCIONES } from "../domain/catalogo.js";
import { FASE } from "../domain/comando-service.js";
import { el, icono, vibrar } from "./dom.js";

const ICONO_DIR = { arriba: "i-up", abajo: "i-down", izquierda: "i-left", derecha: "i-right" };
const DURACION_FLASH = 1300;

export class Botonera {
  /**
   * @param {{cruceta: HTMLElement, secundarios: HTMLElement,
   *          onPulsar: (codigo:number, origenUi:string) => void, onDetener: () => void}} op
   */
  constructor({ cruceta, secundarios, onPulsar, onDetener }) {
    Object.assign(this, { cruceta, secundarios, onPulsar, onDetener });
    this.botones = new Map();          // codigo → [botones]
    this.timers = new Map();
    this.habilitado = false;
    this.bloqueoSecundarios = false;
  }

  render(catalogo) {
    this.botones.clear();

    // ---- Cruceta ----
    const piezas = DIRECCIONES.map((dir) => {
      const cmd = catalogo.direccion(dir);
      const b = this._boton(cmd, { icono: ICONO_DIR[dir], clase: `cbtn dir-${dir}`, origen: "cruceta",
        sinCatalogo: `Sin comando para ${dir}` });
      return b;
    });
    const stop = el("button", {
      class: "cbtn-stop", attrs: { type: "button", "aria-label": "Detener" },
      on: {
        pointerdown: (e) => { e.preventDefault(); this.onDetener(); },
        click: (e) => { if (e.detail === 0) this.onDetener(); },
      },
    }, [icono("i-stop")]);
    this.cruceta.replaceChildren(piezas[0], piezas[2], el("div", { class: "cbtn-centro" }, [stop]), piezas[3], piezas[1]);

    // ---- Secundarios ----
    const sec = catalogo.secundarios();
    if (!sec.length) {
      this.secundarios.replaceChildren(el("p", { class: "vacio", text: catalogo.cargado
        ? "El catálogo no tiene comandos adicionales activos."
        : "Catálogo no disponible." }));
    } else {
      this.secundarios.replaceChildren(...sec.map((c) =>
        this._boton(c, { icono: CONFIG.iconos[c.codigo] || "i-bolt", clase: "cbtn cbtn-sec", origen: "boton" })));
    }
    this._aplicarHabilitado();
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
    }, [icono(ic), el("span", { class: "cbtn-txt", text: etiqueta }), el("span", { class: "cbtn-estado", attrs: { "aria-hidden": "true" } })]);

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

  /** @param {boolean} habilitado @param {{bloquearSecundarios?: boolean}} op */
  setHabilitado(habilitado, { bloquearSecundarios = false } = {}) {
    this.habilitado = habilitado;
    this.bloqueoSecundarios = bloquearSecundarios;
    this._aplicarHabilitado();
  }

  _aplicarHabilitado() {
    for (const [, lista] of this.botones) {
      for (const b of lista) {
        const esSec = b.classList.contains("cbtn-sec");
        b.disabled = !this.habilitado || (esSec && this.bloqueoSecundarios);
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

  /** Marca brevemente el comando que el backend reporta por WebSocket. */
  marcarActivo(codigo) {
    for (const [c, lista] of this.botones) for (const b of lista) b.classList.toggle("is-activo", c === codigo);
    clearTimeout(this.timers.get("activo"));
    this.timers.set("activo", setTimeout(() => {
      for (const [, lista] of this.botones) for (const b of lista) b.classList.remove("is-activo");
    }, 2500));
  }
}
