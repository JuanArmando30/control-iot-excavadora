/**
 * Vista de DEMO: lista (solo lectura de la API), progreso reportado por
 * WebSocket y botones de iniciar/cancelar (opcionales en Monitoreo).
 */
import { el } from "./dom.js";

export class DemoPanel {
  /**
   * @param {{select?:HTMLSelectElement, barra:HTMLElement, barraPaso:HTMLElement, texto:HTMLElement}} nodos
   */
  constructor({ select, barra, barraPaso, texto }) {
    Object.assign(this, { select, barra, barraPaso, texto });
  }

  pintarLista(demos) {
    if (!this.select) return;
    const previo = this.select.value;
    const opciones = demos.length
      ? demos.map((d) => el("option", { text: d.nombre, attrs: { value: d.id_demo, title: d.descripcion || "" } }))
      : [el("option", { text: "No hay DEMO activas", attrs: { value: "" } })];
    this.select.replaceChildren(...opciones);
    if (demos.some((d) => String(d.id_demo) === previo)) this.select.value = previo;
  }

  get seleccion() {
    const n = Number.parseInt(this.select?.value ?? "", 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  pintar(e) {
    const pct = e.total ? Math.min(100, Math.round((e.orden / e.total) * 100)) : 0;
    this._barra(this.barra, e.activa || e.fin ? pct : 0);
    if (e.activa) {
      this.texto.textContent = e.orden
        ? `${e.nombre || "DEMO"} · paso ${e.orden}/${e.total}: ${e.comando || "—"} (${e.duracionMs} ms)`
        : `${e.nombre || "DEMO"} · iniciando (${e.total} movimientos)…`;
    } else {
      this.texto.textContent = e.fin || "Sin DEMO en ejecución.";
    }
    if (e.evento === "demo_movimiento" && e.duracionMs) this._animarPaso(e.duracionMs);
    if (!e.activa) this._animarPaso(0);
  }

  _barra(n, pct) {
    n.style.width = pct + "%";
    n.parentElement.setAttribute("aria-valuenow", String(pct));
  }

  _animarPaso(ms) {
    const b = this.barraPaso;
    b.style.transition = "none";
    b.style.width = "0";
    if (!ms) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      b.style.transition = `width ${ms}ms linear`;
      b.style.width = "100%";
    }));
  }
}
