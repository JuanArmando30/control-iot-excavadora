/**
 * Panel con los tres indicadores (WSS, API AWS, Amazon RDS).
 * Cada estado se distingue por texto, icono y color (no solo color).
 */
import { el, icono } from "./dom.js";
import { NIVEL } from "../domain/conectividad-service.js";

const ITEMS = [
  { clave: "ws", nombre: "WebSocket WSS", corto: "WSS", mini: "WSS", ic: "i-wifi", sub: "Sesión en vivo de este navegador" },
  { clave: "api", nombre: "Servidor AWS", corto: "AWS API", mini: "AWS", ic: "i-server", sub: "API FastAPI · 21 procedimientos" },
  { clave: "rds", nombre: "Amazon RDS", corto: "RDS", mini: "RDS", ic: "i-db", sub: "Diagnóstico seguro del backend" },
];
const NOTA_FISICO = "Vehículo físico: sin confirmación del ESP32. WSS y API en línea no significan que el carrito esté conectado.";

const ICONO_NIVEL = {
  [NIVEL.OK]: "i-check",
  [NIVEL.MEDIO]: "i-sync",
  [NIVEL.MAL]: "i-x",
  [NIVEL.NEUTRO]: "i-question",
};

export class ConectividadPanel {
  /**
   * @param {HTMLElement} contenedor
   * @param {import("../domain/conectividad-service.js").ConectividadService} servicio
   * @param {{compacto?: boolean}} op
   */
  constructor(contenedor, servicio, { compacto = false } = {}) {
    this.servicio = servicio;
    this.filas = {};
    contenedor.classList.add("conn");
    if (compacto) contenedor.classList.add("conn-compacto");

    const grid = el("div", { class: "conn-grid" });
    for (const it of ITEMS) {
      const ico = el("span", { class: "conn-ico" });
      const estado = el("strong", { class: "conn-estado" });
      const detalle = el("small", { class: "conn-detalle" });
      const fila = el("div", { class: "conn-item", attrs: { role: "group", "aria-label": it.nombre } }, [
        ico,
        el("div", { class: "conn-txt" }, [
          el("span", { class: "conn-nombre" }, [
            icono(it.ic, "ico conn-tipo"),
            el("span", { class: "lbl-largo", text: it.nombre }),
            el("span", { class: "lbl-corto", text: it.corto, attrs: { "aria-hidden": "true" } }),
          ]),
          estado,
          el("small", { class: "conn-sub", text: it.sub }),
          detalle,
        ]),
      ]);
      this.filas[it.clave] = { fila, ico, estado, detalle };
      grid.append(fila);
    }

    this.anuncio = el("p", { class: "visually-hidden", attrs: { "aria-live": "polite" } });
    const boton = el("button", {
      class: "btn btn-sm btn-outline-info conn-btn",
      attrs: { type: "button", "aria-label": "Comprobar conectividad ahora", title: "Comprobar ahora" },
      on: { click: () => servicio.comprobar({ manual: true }) },
    }, [icono("i-sync"), el("span", { class: "lbl-largo", text: "Comprobar" })]);

    const pie = el("div", { class: "conn-pie" }, [
      el("p", { class: "conn-nota" }, [
        icono("i-info"),
        el("span", { class: "lbl-largo", text: NOTA_FISICO }),
        el("span", { class: "lbl-corto", text: "Vehículo físico: sin confirmación del ESP32." }),
      ]),
      boton,
    ]);

    contenedor.replaceChildren(grid, pie, this.anuncio);
    for (const it of ITEMS) this._pintar(it.clave, servicio.estado[it.clave]);
    servicio.addEventListener("cambio", (e) => {
      this._pintar(e.detail.clave, e.detail);
      if (e.detail.cambio) {
        const it = ITEMS.find((x) => x.clave === e.detail.clave);
        this.anuncio.textContent = `${it.nombre}: ${e.detail.texto}`;
      }
    });
  }

  _pintar(clave, { nivel, texto, detalle }) {
    const f = this.filas[clave];
    f.fila.className = `conn-item nivel-${nivel}`;
    f.ico.replaceChildren(icono(ICONO_NIVEL[nivel], nivel === NIVEL.MEDIO ? "ico gira" : "ico"));
    f.estado.textContent = texto;
    f.detalle.textContent = detalle || "";
    f.fila.title = `${texto}${detalle ? " · " + detalle : ""}`;
  }
}

/**
 * Versión discreta para el menú superior del Control: tres chips (icono de
 * estado + nombre corto). Todo el bloque es un botón que comprueba al
 * instante; el estado completo va en aria-label, title y una región aria-live.
 * La forma del icono (✓, ↻, ✕, ?) distingue el estado, no solo el color.
 */
export class EstadoBarra {
  /**
   * @param {HTMLElement} contenedor
   * @param {import("../domain/conectividad-service.js").ConectividadService} servicio
   */
  constructor(contenedor, servicio) {
    this.servicio = servicio;
    this.chips = {};
    const chips = ITEMS.map((it) => {
      const ico = el("span", { class: "estado-ico" });
      const chip = el("span", { class: "estado-chip" }, [ico, el("span", { class: "estado-nombre", text: it.mini })]);
      this.chips[it.clave] = { chip, ico };
      return chip;
    });
    this.boton = el("button", {
      class: "estado-btn", attrs: { type: "button" },
      on: { click: () => servicio.comprobar({ manual: true }) },
    }, chips);
    this.anuncio = el("p", { class: "visually-hidden", attrs: { "aria-live": "polite" } });
    contenedor.replaceChildren(this.boton, this.anuncio);

    for (const it of ITEMS) this._pintar(it.clave, servicio.estado[it.clave]);
    this._resumen();
    servicio.addEventListener("cambio", (e) => {
      this._pintar(e.detail.clave, e.detail);
      this._resumen();
      if (e.detail.cambio) {
        const it = ITEMS.find((x) => x.clave === e.detail.clave);
        this.anuncio.textContent = `${it.nombre}: ${e.detail.texto}`;
      }
    });
  }

  _pintar(clave, { nivel }) {
    const { chip, ico } = this.chips[clave];
    chip.dataset.nivel = nivel;
    ico.replaceChildren(icono(ICONO_NIVEL[nivel], nivel === NIVEL.MEDIO ? "ico gira" : "ico"));
  }

  _resumen() {
    const est = this.servicio.estado;
    const lineas = ITEMS.map((it) => `${it.nombre}: ${est[it.clave].texto}${est[it.clave].detalle ? " · " + est[it.clave].detalle : ""}`);
    this.boton.title = [...lineas, NOTA_FISICO, "Toca para comprobar ahora."].join("\n");
    this.boton.setAttribute("aria-label",
      `Conectividad. ${ITEMS.map((it) => `${it.nombre}: ${est[it.clave].texto}`).join(". ")}. Pulsa para comprobar ahora.`);
  }
}
