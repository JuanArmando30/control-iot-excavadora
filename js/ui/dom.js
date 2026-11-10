/**
 * Utilidades de vista. Todo el texto se inserta con textContent: ningún dato
 * remoto se interpreta como HTML (sin innerHTML).
 */

const SPRITE = "assets/icons/sprite.svg";
const SVG_NS = "http://www.w3.org/2000/svg";

export const $ = (id) => document.getElementById(id);

/**
 * Crea un elemento. `props` admite: class, text, attrs, dataset, on (eventos).
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, hijos = []) {
  const n = document.createElement(tag);
  if (props.class) n.className = props.class;
  if (props.text != null) n.textContent = String(props.text);
  for (const [k, v] of Object.entries(props.attrs || {})) {
    if (v === false || v == null) continue;
    n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const [k, v] of Object.entries(props.dataset || {})) n.dataset[k] = String(v);
  for (const [k, f] of Object.entries(props.on || {})) n.addEventListener(k, f);
  for (const h of [].concat(hijos)) if (h != null) n.append(h);
  return n;
}

/** Icono del sprite SVG local (ruta relativa: funciona en subrutas de GitHub Pages). */
export function icono(nombre, clase = "ico") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", clase);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `${SPRITE}#${nombre}`);
  svg.append(use);
  return svg;
}

export function hora(fecha) {
  const d = fecha ? new Date(fecha) : new Date();
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("es-MX", { hour12: false });
}

export function fechaHora(fecha) {
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-MX", { hour12: false });
}

/** MySQL devuelve TIMESTAMP sin zona; el servidor trabaja en UTC. */
export function fechaServidor(txt) {
  if (!txt) return null;
  return /Z|[+-]\d\d:?\d\d$/.test(txt) ? txt : txt + "Z";
}

export function vibrar(ms = 15) {
  try { navigator.vibrate?.(ms); } catch { /* no soportado */ }
}

/* ------------------------------ Avisos ------------------------------ */

let contenedorToasts = null;

/** Mensaje breve no bloqueante. tipo: "" | "ok" | "error" | "info" */
export function toast(mensaje, tipo = "") {
  if (!contenedorToasts) {
    contenedorToasts = el("div", { class: "toasts", attrs: { "aria-live": "polite", role: "status" } });
    document.body.append(contenedorToasts);
  }
  const t = el("div", { class: `toast-msg ${tipo}`, text: mensaje });
  contenedorToasts.append(t);
  while (contenedorToasts.children.length > 4) contenedorToasts.firstChild.remove();
  setTimeout(() => t.remove(), tipo === "error" ? 6500 : 3500);
}

/** Lista de registro con límite de elementos (más reciente arriba). */
export function registrar(lista, etiqueta, texto, max = 60) {
  if (!lista) return;
  const li = el("li", {}, [
    el("time", { text: hora() }),
    el("span", { class: "reg-etq", text: etiqueta }),
    el("span", { class: "reg-txt", text: texto }),
  ]);
  lista.prepend(li);
  while (lista.children.length > max) lista.lastChild.remove();
}
