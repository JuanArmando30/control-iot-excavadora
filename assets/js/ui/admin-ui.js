/**
 * Piezas de vista compartidas por las secciones de Administración:
 * botones de acción, insignias, filas vacías / de carga, paginador y
 * formularios modales. Todo con textContent (sin innerHTML).
 */
import { abrirModal, campo, leerFormulario } from "./modales.js";
import { el, fechaHora, fechaServidor, icono } from "./dom.js";

export function boton(texto, ic, clase, onClick, etiqueta) {
  return el("button", {
    class: `btn btn-sm ${clase}`, attrs: { type: "button", "aria-label": etiqueta || texto, title: etiqueta || texto },
    on: { click: onClick },
  }, [icono(ic), el("span", { class: "d-none d-md-inline", text: texto })]);
}

export function insignia(activo, si = "Activo", no = "Inactivo") {
  return el("span", { class: `badge ${activo ? "text-bg-success" : "text-bg-secondary"}`, text: activo ? si : no });
}

const ESTADOS = {
  inventario: ["Inventario", "text-bg-info"],
  exhibicion: ["Exhibición", "text-bg-primary"],
  vendida: ["Vendida", "text-bg-success"],
  baja: ["Baja", "text-bg-secondary"],
};
export const NOMBRE_ESTADO = Object.fromEntries(Object.entries(ESTADOS).map(([k, [t]]) => [k, t]));

export function insigniaEstado(estado) {
  const [texto, clase] = ESTADOS[estado] || [estado || "—", "text-bg-secondary"];
  return el("span", { class: `badge ${clase}`, text: texto });
}

export function filaVacia(tbody, columnas, texto, clase = "vacio") {
  tbody.replaceChildren(el("tr", {}, [el("td", { class: clase, text: texto, attrs: { colspan: columnas } })]));
}

export function filaCargando(tbody, columnas) {
  filaVacia(tbody, columnas, "Cargando…", "vacio cargando");
}

/** Fecha del servidor (UTC sin zona) en hora local; "—" si no hay. */
export function fecha(txt) {
  return txt ? fechaHora(fechaServidor(txt)) : "—";
}

/**
 * Paginador «1–25 de 80 · ‹ ›».
 * @param {HTMLElement} destino
 * @param {{total:number, limite:number, desplazamiento:number}} pagina
 * @param {(desplazamiento:number) => void} ir
 */
export function pintarPaginador(destino, { total, limite, desplazamiento }, ir) {
  if (!destino) return;
  const desde = total ? desplazamiento + 1 : 0;
  const hasta = Math.min(desplazamiento + limite, total);
  const anterior = el("button", {
    class: "btn btn-sm btn-outline-light", attrs: { type: "button", "aria-label": "Página anterior", disabled: desplazamiento <= 0 },
    on: { click: () => ir(Math.max(0, desplazamiento - limite)) },
  }, [icono("i-left")]);
  const siguiente = el("button", {
    class: "btn btn-sm btn-outline-light", attrs: { type: "button", "aria-label": "Página siguiente", disabled: hasta >= total },
    on: { click: () => ir(desplazamiento + limite) },
  }, [icono("i-right")]);
  destino.replaceChildren(el("span", { class: "paginador-txt", text: `${desde}–${hasta} de ${total}`, attrs: { "aria-live": "polite" } }), anterior, siguiente);
}

/**
 * Formulario modal. `guardar` recibe los datos leídos (tipos respetados);
 * si lanza error, el mensaje se muestra DENTRO del modal y no se cierra.
 */
export function formulario(titulo, campos, guardar, { textoGuardar = "Guardar", nota } = {}) {
  abrirModal({
    titulo,
    cuerpo: [nota ? el("p", { class: "alert alert-info py-2 small", text: nota }) : null, ...campos.map(campo)].filter(Boolean),
    acciones: [
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      { texto: textoGuardar, clase: "btn-primary", tipo: "submit", alPulsar: ({ form }) => guardar(leerFormulario(form), form) },
    ],
  });
}

/** Debounce simple para los cuadros de búsqueda. */
export function retrasar(f, ms = 350) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); };
}
