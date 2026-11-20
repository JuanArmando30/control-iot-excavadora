/**
 * Arranque compartido por Control y Monitoreo: panel de conectividad,
 * sesión WSS real y nombre del vehículo.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { WsCompartido } from "../core/ws-compartido.js";
import { WS } from "../core/ws-client.js";
import { sesionStore } from "../core/sesion-store.js";
import { ConectividadService } from "../domain/conectividad-service.js";
import { ConectividadPanel, EstadoBarra } from "../ui/conectividad-panel.js";
import { $, toast } from "../ui/dom.js";

/**
 * Canal WSS de la página con destino reconfigurable (corrección tras la Etapa 9).
 *
 * La identidad (sesión, invitado con reserva) y la unidad pueden cambiar SIN
 * recargar: iniciar o cerrar sesión en Administración, reservar o terminar como
 * invitado. `cambiar()` cierra la conexión anterior y abre otra con el permiso
 * nuevo. Sin destino (`null`) no se conecta y el indicador queda en gris
 * («Sin sesión» / «Sin reserva»), no en rojo: no es una falla.
 * Misma interfaz que WsClient para las páginas: eventos "estado", "mensaje",
 * "registro", conectar(), cerrar() y `estado`.
 */
class CanalWs extends EventTarget {
  constructor(base, destino, textoSinDestino) {
    super();
    this.base = base;
    this.destino = destino;              // {idVehiculo, identidad, obtenerTicket} | null
    this.textoSinDestino = textoSinDestino;
    this.real = null;
    this.activo = false;
    this.estado = WS.SIN_PERMISO;
  }

  get identidad() { return this.destino ? `${this.destino.idVehiculo}-${this.destino.identidad}` : ""; }

  conectar() {
    if (this.activo) return;
    this.activo = true;
    this._crear();
  }

  cerrar() {
    this.activo = false;
    this._soltar();
    this._emitir(WS.CERRADO, "Cerrado");
  }

  /** Cambia el destino; si es el mismo (misma unidad e identidad) no hace nada. */
  cambiar(destino, textoSinDestino = this.textoSinDestino) {
    const antes = this.identidad;
    this.destino = destino;
    this.textoSinDestino = textoSinDestino;
    if (!this.activo || (antes && antes === this.identidad)) return;
    this._soltar();
    this._crear();
  }

  _crear() {
    if (!this.destino) { this._emitir(WS.SIN_PERMISO, this.textoSinDestino); return; }
    const { idVehiculo, identidad, obtenerTicket } = this.destino;
    const real = new WsCompartido({ ...this.base, url: CONFIG.wsUrl(idVehiculo), idVehiculo, identidad, obtenerTicket });
    this.real = real;
    for (const tipo of ["mensaje", "registro"]) {
      real.addEventListener(tipo, (e) => { if (real === this.real) this.dispatchEvent(new CustomEvent(tipo, { detail: e.detail })); });
    }
    real.addEventListener("estado", (e) => { if (real === this.real) this._emitir(e.detail.estado, e.detail.detalle); });
    real.conectar();
  }

  _soltar() {
    const real = this.real;
    this.real = null;                    // primero: sus últimos eventos ya no se reenvían
    real?.cerrar();
  }

  _emitir(estado, detalle = "") {
    this.estado = estado;
    this.dispatchEvent(new CustomEvent("estado", { detail: { estado, detalle } }));
  }
}

/**
 * @param {{compacto?: boolean, barra?: boolean, idVehiculo?: number|null, obtenerTicket?: Function,
 *          identidad?: string, textoSinDestino?: string}} op
 *   `barra`: indicadores discretos dentro del menú superior en lugar del panel completo.
 *   `idVehiculo: null`: la página aún no tiene a qué unidad conectarse (se fija luego con ws.cambiar()).
 */
export function iniciarConectividad({ compacto = false, barra = false, idVehiculo = CONFIG.vehiculoId,
  obtenerTicket = () => api.ticketWs(idVehiculo), identidad = "anonimo",
  textoSinDestino = "Inicia sesión para recibir los eventos en vivo" } = {}) {
  const t = CONFIG.tiempos;
  const conectividad = new ConectividadService({ api, intervaloMs: t.saludCadaMs });
  if (barra) new EstadoBarra($("panelConectividad"), conectividad);
  else new ConectividadPanel($("panelConectividad"), conectividad, { compacto });

  // Una sola conexión WSS por navegador y por identidad, compartida entre pestañas.
  const ws = new CanalWs({
    pingMs: t.wsPingMs,
    pongMaxMs: t.wsPongMaxMs,
    baseMs: t.wsReconexionBaseMs,
    maxMs: t.wsReconexionMaxMs,
  }, idVehiculo ? { idVehiculo, identidad, obtenerTicket } : null, textoSinDestino);
  ws.addEventListener("estado", (e) => conectividad.actualizarWs(e.detail.estado, e.detail.detalle));
  conectividad.iniciar();
  return { conectividad, ws };
}

/** Si la sesión de esta pestaña termina (o caduca), suelta el canal: ya no hay con qué autorizarlo. */
export function soltarAlCerrarSesion(ws) {
  sesionStore.alCambiar(() => {
    if (!sesionStore.activa()) ws.cambiar(null, "Tu sesión terminó: inicia sesión para recibir los eventos en vivo");
  });
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
