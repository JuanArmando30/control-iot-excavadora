/**
 * Arranque compartido por Control y Monitoreo: panel de conectividad,
 * sesión WSS real y nombre del vehículo.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { WsCompartido } from "../core/ws-compartido.js";
import { ConectividadService } from "../domain/conectividad-service.js";
import { ConectividadPanel, EstadoBarra } from "../ui/conectividad-panel.js";
import { $, toast } from "../ui/dom.js";

/**
 * @param {{compacto?: boolean, barra?: boolean}} op `barra`: indicadores
 *   discretos dentro del menú superior (Control) en lugar del panel completo.
 */
export function iniciarConectividad({ compacto = false, barra = false, idVehiculo = CONFIG.vehiculoId,
  obtenerTicket = () => api.ticketWs(idVehiculo), identidad = "anonimo" } = {}) {
  const t = CONFIG.tiempos;
  const conectividad = new ConectividadService({ api, intervaloMs: t.saludCadaMs });
  if (barra) new EstadoBarra($("panelConectividad"), conectividad);
  else new ConectividadPanel($("panelConectividad"), conectividad, { compacto });

  // Una sola conexión WSS por navegador, compartida entre pestañas de Control y Monitoreo.
  const ws = new WsCompartido({
    url: CONFIG.wsUrl(idVehiculo),
    idVehiculo,
    identidad,
    obtenerTicket,                 // Etapa 8: ticket de un solo uso antes de cada conexión
    pingMs: t.wsPingMs,
    pongMaxMs: t.wsPongMaxMs,
    baseMs: t.wsReconexionBaseMs,
    maxMs: t.wsReconexionMaxMs,
  });
  ws.addEventListener("estado", (e) => conectividad.actualizarWs(e.detail.estado, e.detail.detalle));
  conectividad.iniciar();
  return { conectividad, ws };
}

export async function pintarVehiculo(idVehiculo = CONFIG.vehiculoId) {
  const destino = $("vehiculoNombre");
  try {
    const v = await api.vehiculo(idVehiculo);
    destino.textContent = `${v.nombre} · ${v.microcontrolador || "IoT"} · #${v.id_vehiculo}`;
    if (!v.activo) toast("El vehículo está marcado como inactivo en la base de datos.", "error");
    return v;
  } catch (e) {
    destino.textContent = `Vehículo #${idVehiculo}`;
    return null;
  }
}

/** Mensajes de error de WebSocket que no pertenecen a una DEMO. */
export function textoEvento(ev) {
  const d = ev.datos;
  switch (ev.evento) {
    case "estado_inicial": return `Estado inicial: ${ev.comando || "sin comando"}`;
    case "estado_actualizado": return `Estado actualizado: ${ev.comando || "sin comando"}`;
    case "movimiento_individual": return `${ev.comando} (#${ev.codigo}) · origen ${d.origen || "—"} · en historial`;
    case "demo_iniciada": return `${d.nombre || "DEMO"} · ${d.total_movimientos ?? "?"} movimientos · ~${Math.round((d.duracion_estimada_ms || 0) / 1000)} s`;
    case "demo_movimiento": return `${d.orden}/${d.total_movimientos} ${ev.comando} (#${ev.codigo}) · ${d.duracion_ms} ms + ${d.pausa_ms} ms · sin historial`;
    case "demo_finalizada": return `Finalizada · ${d.movimientos_ejecutados ?? "?"} movimientos`;
    case "demo_cancelada": return `Cancelada · ${d.movimientos_ejecutados ?? "?"} movimientos · ${d.detenido_con || "—"}`;
    case "error": return `${d.codigo_error || "ERROR"} · ${d.detalle || "sin detalle"}`;
    case "pong": return "pong";
    default: return ev.evento;
  }
}

/**
 * Selector de unidad en el encabezado (Etapa 8): aparece si hay más de una
 * unidad para elegir. Cambiar de unidad recarga la página con la nueva.
 */
export function montarSelectorUnidad(unidad, elegir) {
  const sel = $("selUnidad");
  if (!sel) return;
  if (unidad.opciones.length < 2) { sel.hidden = true; return; }
  sel.replaceChildren(...unidad.opciones.map((o) => {
    const op = document.createElement("option");
    op.value = String(o.id);
    op.textContent = o.nombre || `Unidad #${o.id}`;
    op.selected = o.id === unidad.id;
    return op;
  }));
  sel.hidden = false;
  sel.addEventListener("change", () => elegir(Number.parseInt(sel.value, 10)));
}
