/**
 * Funciones REST del backend FastAPI. Cada una usa la ruta real (config.js),
 * el método real (GET consulta, POST escribe/ejecuta) y valida la respuesta.
 */
import { CONFIG } from "../config.js";
import { HttpClient } from "../core/http-client.js";
import { claveStore } from "../core/clave-store.js";
import * as V from "../core/validadores.js";

const R = CONFIG.rutas;

export const http = new HttpClient({
  baseUrl: CONFIG.apiBaseUrl,
  timeoutMs: CONFIG.tiempos.timeoutMs,
  obtenerClave: claveStore.obtener,
  controlSinClave: claveStore.esAbierto,
});

const datos = (p) => p.then((r) => r.data);
const id = (n) => {
  if (!Number.isInteger(n) || n <= 0) throw new TypeError("Identificador inválido");
  return n;
};

export const api = {
  /* ---------- Sistema ---------- */
  salud: (op) => http.get(R.salud(), op),
  saludDb: (op) => http.get(R.saludDb(), op),
  /** Valida una clave (la guardada o una nueva antes de guardarla) sin modificar datos. */
  sesion: (clave) => datos(http.request(R.sesion(), { method: "GET", auth: true, clave })).then(V.sesion),
  /** GET /sesion SIN clave: 200 {acceso:"abierto"} si el backend tiene CONTROL_ABIERTO=true; si no, 401. */
  sesionSinClave: () => datos(http.request(R.sesion(), { method: "GET" })).then(V.sesion),

  /* ---------- Vehículos ---------- */
  vehiculos: () => datos(http.get(R.vehiculos())).then(V.vehiculos),
  vehiculo: (v) => datos(http.get(R.vehiculo(id(v)))).then(V.vehiculo),
  crearVehiculo: (cuerpo) => datos(http.post(R.vehiculos(), cuerpo, { auth: true })).then(V.vehiculo),
  actualizarVehiculo: (v, cuerpo) => datos(http.post(R.vehiculoActualizar(id(v)), cuerpo, { auth: true })).then(V.vehiculo),
  eliminarVehiculo: (v) => datos(http.post(R.vehiculoEliminar(id(v)), undefined, { auth: true })),

  /* ---------- Catálogo ---------- */
  comandos: (v) => datos(http.get(R.comandos(id(v)))).then(V.comandos),
  crearComando: (v, cuerpo) => datos(http.post(R.comandos(id(v)), cuerpo, { auth: true })).then(V.comando),
  actualizarComando: (v, c, cuerpo) => datos(http.post(R.comandoActualizar(id(v), id(c)), cuerpo, { auth: true })).then(V.comando),
  eliminarComando: (v, c) => datos(http.post(R.comandoEliminar(id(v), id(c)), undefined, { auth: true })),

  /* ---------- Estado e historial ---------- */
  estado: async (v) => {
    try {
      return V.estado((await http.get(R.estado(id(v)))).data);
    } catch (e) {
      if (e.status === 404) return null;           // vehículo sin estado registrado
      throw e;
    }
  },
  historial: (v) => datos(http.get(R.historial(id(v)))).then(V.historial),

  /* ---------- Movimiento individual ---------- */
  moverPorCodigo: (v, codigo, origen) =>
    datos(http.post(R.movimientos(id(v)), { codigo, origen }, { auth: "control" })).then(V.movimientoRegistrado),

  /* ---------- DEMO ---------- */
  demos: (v) => datos(http.get(R.demos(id(v)))).then(V.demos),
  crearDemo: (v, cuerpo) => datos(http.post(R.demos(id(v)), cuerpo, { auth: true })).then(V.demo),
  actualizarDemo: (v, d, cuerpo) => datos(http.post(R.demoActualizar(id(v), id(d)), cuerpo, { auth: true })).then(V.demo),
  eliminarDemo: (v, d) => datos(http.post(R.demoEliminar(id(v), id(d)), undefined, { auth: true })),
  iniciarDemo: (v, d) => datos(http.post(R.demoIniciar(id(v), id(d)), undefined, { auth: "control" })).then(V.demoIniciada),
  cancelarDemo: (v) => datos(http.post(R.demoCancelar(id(v)), undefined, { auth: "control" })).then(V.demoCancelada),
  ejecucionDemo: (v) => datos(http.get(R.demoEjecucion(id(v)))).then(V.demoEjecucion),
  movimientosDemo: (v, d) => datos(http.get(R.demoMovimientos(id(v), id(d)))).then(V.movimientosDemo),
  agregarMovimientoDemo: (v, d, cuerpo) =>
    datos(http.post(R.demoMovimientos(id(v), id(d)), cuerpo, { auth: true })).then(V.movimientoDemo),
  actualizarMovimientoDemo: (v, d, m, cuerpo) =>
    datos(http.post(R.demoMovActualizar(id(v), id(d), id(m)), cuerpo, { auth: true })).then(V.movimientoDemo),
  eliminarMovimientoDemo: (v, d, m) =>
    datos(http.post(R.demoMovEliminar(id(v), id(d), id(m)), undefined, { auth: true })),
};
