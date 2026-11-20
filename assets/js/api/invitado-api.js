/**
 * Invitado sin cuenta (Etapa 7): catálogo y reserva temporal de la unidad de exhibición.
 *
 * El token de la reserva vive SOLO en esta variable (memoria): recargar o cerrar
 * la pestaña lo pierde y, sin latido, el servidor detiene la unidad en ~15 s.
 * Nunca va a localStorage, sessionStorage ni cookies.
 */
import { CONFIG } from "../config.js";
import { http } from "./vehiculo-api.js";
import * as V from "../core/validadores.js";

const R = CONFIG.rutas;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
let token = "";

const id = (n) => {
  if (!Number.isInteger(n) || n <= 0) throw new TypeError("Identificador inválido");
  return n;
};
const conToken = () => ({ invitado: token || "x" });          // sin token el servidor responde 401

export const invitado = {
  activo: () => !!token,
  olvidar: () => { token = ""; },

  catalogo: () => http.get(R.invCatalogo()).then((r) => V.filas(r.data)),

  async reservar(idVehiculo) {
    const { data } = await http.post(R.invReservar(), { id_vehiculo: id(idVehiculo) });
    const reserva = V.fila(data);
    if (typeof reserva.token_invitado !== "string" || !FORMATO_TOKEN.test(reserva.token_invitado)) {
      throw new Error("Respuesta de la API con formato inesperado (reserva).");
    }
    token = reserva.token_invitado;
    delete reserva.token_invitado;                              // no se guarda en ningún otro objeto
    return reserva;
  },

  estado: () => http.get(R.invEstado(), conToken()).then((r) => V.fila(r.data)),
  latido: () => http.post(R.invLatido(), undefined, conToken()).then((r) => V.fila(r.data)),

  async terminar() {
    try { await http.post(R.invTerminar(), undefined, conToken()); } finally { token = ""; }
  },

  /* Control de la unidad reservada (rutas de siempre, con la cabecera X-Invitado) */
  mover: (v, codigo) => http.post(R.movimientos(id(v)), { codigo, origen: "WEB_INVITADO" }, conToken())
    .then((r) => V.movimientoRegistrado(r.data)),
  iniciarDemo: (v, d) => http.post(R.demoIniciar(id(v), id(d)), undefined, conToken()).then((r) => V.demoIniciada(r.data)),
  cancelarDemo: (v) => http.post(R.demoCancelar(id(v)), undefined, conToken()).then((r) => V.demoCancelada(r.data)),
  ejecucion: (v) => http.get(R.demoEjecucion(id(v))).then((r) => V.demoEjecucion(r.data)),
};
