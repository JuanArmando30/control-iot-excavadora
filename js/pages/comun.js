/**
 * Arranque compartido por Control y Monitoreo: panel de conectividad,
 * sesión WSS real y nombre del vehículo.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { WsClient } from "../core/ws-client.js";
import { ConectividadService } from "../domain/conectividad-service.js";
import { ConectividadPanel } from "../ui/conectividad-panel.js";
import { $, toast } from "../ui/dom.js";

export function iniciarConectividad({ compacto = false } = {}) {
  const t = CONFIG.tiempos;
  const conectividad = new ConectividadService({ api, intervaloMs: t.saludCadaMs });
  new ConectividadPanel($("panelConectividad"), conectividad, { compacto });

  const ws = new WsClient({
    url: CONFIG.wsUrl(CONFIG.vehiculoId),
    idVehiculo: CONFIG.vehiculoId,
    pingMs: t.wsPingMs,
    pongMaxMs: t.wsPongMaxMs,
    baseMs: t.wsReconexionBaseMs,
    maxMs: t.wsReconexionMaxMs,
  });
  ws.addEventListener("estado", (e) => conectividad.actualizarWs(e.detail.estado, e.detail.detalle));
  conectividad.iniciar();
  return { conectividad, ws };
}

export async function pintarVehiculo() {
  const destino = $("vehiculoNombre");
  try {
    const v = await api.vehiculo(CONFIG.vehiculoId);
    destino.textContent = `${v.nombre} · ${v.microcontrolador || "IoT"} · #${v.id_vehiculo}`;
    if (!v.activo) toast("El vehículo está marcado como inactivo en la base de datos.", "error");
    return v;
  } catch (e) {
    destino.textContent = `Vehículo #${CONFIG.vehiculoId}`;
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
