/**
 * Invitado sin cuenta (Etapa 7): catálogo y reserva temporal de la unidad de exhibición.
 *
 * El token de la reserva vive en memoria y en el sessionStorage de ESTA pestaña:
 * así recargar la página (o ir y volver) retoma la reserva en lugar de verla
 * «ocupada» por uno mismo. Cerrar la pestaña lo borra y, sin latido, el servidor
 * detiene la unidad en ~15 s. Nunca va a localStorage ni a cookies, y dura como
 * mucho los 5 minutos de la reserva.
 */
import { CONFIG } from "../config.js";
import { http } from "./vehiculo-api.js";
import * as V from "../core/validadores.js";

const R = CONFIG.rutas;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const LLAVE = "vehiculoIot.invitado";
let token = leerGuardado();

function leerGuardado() {
  try {
    const t = sessionStorage.getItem(LLAVE) || "";
    return FORMATO_TOKEN.test(t) ? t : "";
  } catch { return ""; }
}
function guardar(t) {
  token = t;
  try { if (t) sessionStorage.setItem(LLAVE, t); else sessionStorage.removeItem(LLAVE); } catch { /* modo privado */ }
}

const id = (n) => {
  if (!Number.isInteger(n) || n <= 0) throw new TypeError("Identificador inválido");
  return n;
};
const conToken = () => ({ invitado: token || "x" });          // sin token el servidor responde 401

export const invitado = {
  activo: () => !!token,
  olvidar: () => guardar(""),

  /**
   * Retoma la reserva de esta pestaña tras recargar. Devuelve la reserva (con
   * `id_vehiculo`) o null si no había o ya terminó. Sin red se conserva el token.
   */
  async recuperar() {
    if (!token) return null;
    try {
      return V.fila((await http.get(R.invEstado(), conToken())).data);
    } catch (e) {
      if (e.status === 401 || e.status === 403 || e.status === 404) guardar("");
      return null;
    }
  },

  catalogo: () => http.get(R.invCatalogo()).then((r) => V.filas(r.data)),

  async reservar(idVehiculo) {
    const { data } = await http.post(R.invReservar(), { id_vehiculo: id(idVehiculo) });
    const reserva = V.fila(data);
    if (typeof reserva.token_invitado !== "string" || !FORMATO_TOKEN.test(reserva.token_invitado)) {
      throw new Error("Respuesta de la API con formato inesperado (reserva).");
    }
    guardar(reserva.token_invitado);
    delete reserva.token_invitado;                              // no se guarda en ningún otro objeto
    return reserva;
  },

  estado: () => http.get(R.invEstado(), conToken()).then((r) => V.fila(r.data)),
  /** Ticket del WebSocket de SU unidad reservada (Etapa 8); sin reserva, false (no se conecta). */
  ticketWs: async (v) => {
    if (!token) return false;
    const r = await http.post(R.wsTicket(), { id_vehiculo: id(v) }, conToken());
    return typeof r.data?.ticket === "string" ? r.data.ticket : null;
  },
  latido: () => http.post(R.invLatido(), undefined, conToken()).then((r) => V.fila(r.data)),

  async terminar() {
    try { await http.post(R.invTerminar(), undefined, conToken()); } finally { guardar(""); }
  },

  /* Control de la unidad reservada (rutas de siempre, con la cabecera X-Invitado) */
  /** `origen`: el modo con que se envió (Pulso, Joystick, Voz…) o WEB_INVITADO en la vista sencilla. */
  mover: (v, codigo, origen = "WEB_INVITADO") => http.post(R.movimientos(id(v)), { codigo, origen }, conToken())
    .then((r) => V.movimientoRegistrado(r.data)),
  iniciarDemo: (v, d) => http.post(R.demoIniciar(id(v), id(d)), undefined, conToken()).then((r) => V.demoIniciada(r.data)),
  cancelarDemo: (v) => http.post(R.demoCancelar(id(v)), undefined, conToken()).then((r) => V.demoCancelada(r.data)),
  ejecucion: (v) => http.get(R.demoEjecucion(id(v)), conToken()).then((r) => V.demoEjecucion(r.data)),
};
