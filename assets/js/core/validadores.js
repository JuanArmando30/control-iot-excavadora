/**
 * El JSON remoto se trata como NO confiable: cada respuesta se valida y se
 * reduce a los campos documentados en app/models/schemas.py del backend.
 * Nunca se inserta como HTML (la vista usa textContent).
 */
import { ApiError } from "./http-client.js";

const esEntero = (v) => Number.isInteger(v);
const esTexto = (v) => typeof v === "string";
const textoONulo = (v, max = 255) => (v == null ? null : esTexto(v) ? v.slice(0, max) : null);
const enteroONulo = (v) => (esEntero(v) ? v : null);

function fallo(que) {
  return new ApiError(`Respuesta de la API con formato inesperado (${que}).`, { tipo: "RESPUESTA" });
}

function exigirObjeto(o, que) {
  if (!o || typeof o !== "object" || Array.isArray(o)) throw fallo(que);
  return o;
}

function exigirLista(l, que) {
  if (!Array.isArray(l)) throw fallo(que);
  return l;
}

export function comando(o) {
  exigirObjeto(o, "comando");
  if (!esEntero(o.id_comando) || !esEntero(o.codigo) || !esTexto(o.nombre)) throw fallo("comando");
  return {
    id_comando: o.id_comando,
    id_vehiculo: enteroONulo(o.id_vehiculo),
    nombre: o.nombre.slice(0, 60),
    codigo: o.codigo,
    descripcion: textoONulo(o.descripcion),
    activo: o.activo === true,
  };
}
export const comandos = (l) => exigirLista(l, "comandos").map(comando);

export function vehiculo(o) {
  exigirObjeto(o, "vehículo");
  if (!esEntero(o.id_vehiculo) || !esTexto(o.nombre)) throw fallo("vehículo");
  return {
    id_vehiculo: o.id_vehiculo,
    nombre: o.nombre.slice(0, 80),
    modelo: textoONulo(o.modelo, 80),
    descripcion: textoONulo(o.descripcion),
    microcontrolador: textoONulo(o.microcontrolador, 50),
    fecha_registro: textoONulo(o.fecha_registro, 40),
    activo: o.activo === true,
  };
}
export const vehiculos = (l) => exigirLista(l, "vehículos").map(vehiculo);

export function demo(o) {
  exigirObjeto(o, "DEMO");
  if (!esEntero(o.id_demo) || !esTexto(o.nombre)) throw fallo("DEMO");
  return {
    id_demo: o.id_demo,
    id_vehiculo: enteroONulo(o.id_vehiculo),
    nombre: o.nombre.slice(0, 80),
    descripcion: textoONulo(o.descripcion),
    activo: o.activo === true,
  };
}
export const demos = (l) => exigirLista(l, "DEMO").map(demo);

export function movimientoDemo(o) {
  exigirObjeto(o, "movimiento de DEMO");
  if (![o.id_demo_movimiento, o.orden, o.id_comando, o.codigo, o.duracion_ms, o.pausa_ms].every(esEntero)) {
    throw fallo("movimiento de DEMO");
  }
  return {
    id_demo_movimiento: o.id_demo_movimiento,
    orden: o.orden,
    id_comando: o.id_comando,
    comando: esTexto(o.comando) ? o.comando.slice(0, 60) : "—",
    codigo: o.codigo,
    duracion_ms: o.duracion_ms,
    pausa_ms: o.pausa_ms,
  };
}
export const movimientosDemo = (l) => exigirLista(l, "movimientos de DEMO").map(movimientoDemo);

export function estado(o) {
  exigirObjeto(o, "estado");
  if (!esEntero(o.id_vehiculo)) throw fallo("estado");
  return {
    id_vehiculo: o.id_vehiculo,
    vehiculo: textoONulo(o.vehiculo, 80),
    id_comando: enteroONulo(o.id_comando),
    comando: textoONulo(o.comando, 60),
    codigo: enteroONulo(o.codigo),
    conectado: o.conectado === true,
    fecha_actualizacion: textoONulo(o.fecha_actualizacion, 40),
  };
}

export function historial(o) {
  exigirObjeto(o, "historial");
  return {
    total_devueltos: enteroONulo(o.total_devueltos) ?? 0,
    limite: enteroONulo(o.limite),
    movimientos: exigirLista(o.movimientos, "historial").map((m) => {
      exigirObjeto(m, "historial");
      return {
        id_historial: enteroONulo(m.id_historial),
        comando: textoONulo(m.comando, 60),
        codigo: enteroONulo(m.codigo),
        fecha_hora: textoONulo(m.fecha_hora, 40),
        origen: textoONulo(m.origen, 30) ?? "—",
      };
    }),
  };
}

export function movimientoRegistrado(o) {
  exigirObjeto(o, "movimiento");
  if (!esEntero(o.codigo) || !esTexto(o.comando)) throw fallo("movimiento");
  return {
    id_comando: enteroONulo(o.id_comando),
    comando: o.comando.slice(0, 60),
    codigo: o.codigo,
    origen: textoONulo(o.origen, 30),
    fecha_actualizacion: textoONulo(o.fecha_actualizacion, 40),
    clientes_notificados: enteroONulo(o.clientes_notificados) ?? 0,
    mensaje: textoONulo(o.mensaje, 200) ?? "",
  };
}

export function demoIniciada(o) {
  exigirObjeto(o, "DEMO iniciada");
  if (!esEntero(o.id_demo)) throw fallo("DEMO iniciada");
  return {
    id_demo: o.id_demo,
    nombre: textoONulo(o.nombre, 80) ?? `DEMO ${o.id_demo}`,
    total_movimientos: enteroONulo(o.total_movimientos) ?? 0,
    duracion_estimada_ms: enteroONulo(o.duracion_estimada_ms) ?? 0,
    clientes_websocket: enteroONulo(o.clientes_websocket) ?? 0,
  };
}

export function demoCancelada(o) {
  exigirObjeto(o, "DEMO cancelada");
  return {
    id_demo: enteroONulo(o.id_demo),
    movimientos_emitidos: enteroONulo(o.movimientos_emitidos) ?? 0,
    mensaje: textoONulo(o.mensaje, 200) ?? "",
  };
}

export function demoEjecucion(o) {
  exigirObjeto(o, "ejecución de DEMO");
  return {
    en_ejecucion: o.en_ejecucion === true,
    id_demo: enteroONulo(o.id_demo),
    nombre: textoONulo(o.nombre, 80),
    movimientos_emitidos: enteroONulo(o.movimientos_emitidos) ?? 0,
    total_movimientos: enteroONulo(o.total_movimientos) ?? 0,
    orden_actual: enteroONulo(o.orden_actual),
  };
}

export function salud(o) {
  return !!o && typeof o === "object" && o.estado === "ok";
}

export function sesion(o) {
  exigirObjeto(o, "sesión");
  if (o.rol !== "operador" && o.rol !== "admin") throw fallo("sesión");
  return { rol: o.rol };
}

/* ---------------------------- WebSocket ---------------------------- */

const EVENTOS_WS = new Set([
  "estado_inicial", "estado_actualizado", "movimiento_individual",
  "demo_iniciada", "demo_movimiento", "demo_finalizada", "demo_cancelada",
  "error", "pong",
]);

/**
 * Formato común (app/websocket/eventos.py):
 * {evento, id_vehiculo, comando|null, codigo|null, timestamp, datos:{}}
 * Devuelve null si el mensaje no es válido o es de otro vehículo.
 */
export function eventoWs(texto, idVehiculo) {
  if (typeof texto !== "string" || texto.length > 16384) return null;
  let o;
  try { o = JSON.parse(texto); } catch { return null; }
  if (!o || typeof o !== "object" || !EVENTOS_WS.has(o.evento)) return null;
  if (o.id_vehiculo !== idVehiculo) return null;
  const d = o.datos && typeof o.datos === "object" && !Array.isArray(o.datos) ? o.datos : {};
  return {
    evento: o.evento,
    id_vehiculo: o.id_vehiculo,
    comando: textoONulo(o.comando, 60),
    codigo: enteroONulo(o.codigo),
    timestamp: textoONulo(o.timestamp, 40),
    datos: {
      origen: textoONulo(d.origen, 30),
      conectado: typeof d.conectado === "boolean" ? d.conectado : null,
      fecha_actualizacion: textoONulo(d.fecha_actualizacion, 40),
      registrado_en_historial: typeof d.registrado_en_historial === "boolean" ? d.registrado_en_historial : null,
      id_demo: enteroONulo(d.id_demo),
      nombre: textoONulo(d.nombre, 80),
      orden: enteroONulo(d.orden),
      total_movimientos: enteroONulo(d.total_movimientos),
      duracion_ms: enteroONulo(d.duracion_ms),
      pausa_ms: enteroONulo(d.pausa_ms),
      duracion_estimada_ms: enteroONulo(d.duracion_estimada_ms),
      movimientos_ejecutados: enteroONulo(d.movimientos_ejecutados),
      detenido_con: textoONulo(d.detenido_con, 60),
      codigo_error: textoONulo(d.codigo_error, 40),
      detalle: textoONulo(d.detalle, 220),
      mensaje: textoONulo(d.mensaje, 200),
    },
  };
}
