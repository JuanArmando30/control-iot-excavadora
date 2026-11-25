/**
 * Rutas /admin del backend (app/api/routes/admin.py). Todas exigen
 * administrador: token de sesión con rol admin o, en transición, la clave
 * X-API-Key de administrador.
 */
import { CONFIG } from "../config.js";
import { http } from "./vehiculo-api.js";
import * as V from "../core/validadores.js";

const R = CONFIG.rutas;
const OP = { auth: "sesion", permitirClave: true };

const id = (n) => {
  if (!Number.isInteger(n) || n <= 0) throw new TypeError("Identificador inválido");
  return n;
};

/** Ruta con parámetros de consulta; omite los vacíos. */
function conFiltros(ruta, filtros = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const txt = q.toString();
  return txt ? `${ruta}?${txt}` : ruta;
}

const get = (ruta) => http.get(ruta, OP).then((r) => r.data);
const post = (ruta, cuerpo) => http.post(ruta, cuerpo, OP).then((r) => r.data);

export const admin = {
  metricas: () => get(R.adminMetricas()).then(V.fila),

  /* ---- Modelos y capacidades ---- */
  modelos: () => get(R.adminModelos()).then(V.filas),
  crearModelo: (c) => post(R.adminModelos(), c).then(V.fila),
  actualizarModelo: (m, c) => post(R.adminModeloActualizar(id(m)), c).then(V.fila),
  capacidades: (m) => get(R.adminCapacidades(id(m))).then(V.filas),
  guardarCapacidad: (m, c) => post(R.adminCapacidades(id(m)), c).then(V.fila),
  eliminarCapacidad: (m, codigo) => post(R.adminCapacidadEliminar(id(m), codigo)),

  /* ---- Unidades ---- */
  unidades: (f) => get(conFiltros(R.adminUnidades(), f)).then(V.pagina),
  crearUnidad: (c) => post(R.adminUnidades(), c).then(V.fila),
  actualizarUnidad: (v, c) => post(R.adminUnidadActualizar(id(v)), c).then(V.fila),
  bajaUnidad: (v) => post(R.adminUnidadBaja(id(v))).then(V.fila),
  /** Solo unidades dadas de baja (V015): borra para siempre la unidad y su historial. */
  eliminarUnidad: (v) => post(R.adminUnidadEliminar(id(v))).then(V.fila),

  /* ---- Usuarios ---- */
  usuarios: (f) => get(conFiltros(R.adminUsuarios(), f)).then(V.pagina),
  crearUsuario: (c) => post(R.adminUsuarios(), c).then(V.fila),
  actualizarUsuario: (u, c) => post(R.adminUsuarioActualizar(id(u)), c).then(V.fila),
  codigoRestablecimiento: (u) => post(R.adminUsuarioCodigo(id(u))).then(V.codigoRestablecimiento),

  /* ---- Asignaciones ---- */
  asignaciones: (f) => get(conFiltros(R.adminAsignaciones(), f)).then(V.pagina),
  asignar: (id_vehiculo, id_usuario) => post(R.adminAsignaciones(), { id_vehiculo, id_usuario }).then(V.fila),
  finalizarAsignacion: (a, c) => post(R.adminAsignacionFinalizar(id(a)), c).then(V.fila),

  /* ---- DEMO de fábrica: editor de pasos (Etapa 6) ---- */
  guardarPasosFabrica: (v, d, pasos) => post(R.adminDemoPasos(id(v), id(d)), { pasos }).then(V.fila),

  /* ---- Exhibición para invitados (Etapa 7) ---- */
  exhibicion: (v) => get(R.adminExhibicion(id(v))).then(V.fila),
  cambiarExhibicion: (v, abierta, horas = 2) => post(R.adminExhibicion(id(v)), { abierta, horas }).then(V.fila),
  terminarReserva: (v) => post(R.adminExhibicionTerminar(id(v))).then(V.fila),

  /* ---- Dispositivo: credencial del ESP32 (Etapa 8) ---- */
  dispositivo: (v) => get(R.adminDispositivo(id(v))).then(V.fila),
  crearCredencial: (v) => post(R.adminDispositivo(id(v))).then(V.fila),
  revocarCredencial: (v) => post(R.adminDispositivoRevocar(id(v))).then(V.fila),

  /* ---- Bloqueo de movimientos: cualquier unidad, sin soporte del cliente ---- */
  bloquearComando: (v, c, bloqueado) => post(R.adminBloqueoComando(id(v), id(c)), { bloqueado }).then(V.fila),

  /* ---- Bitácora ---- */
  auditoria: (f) => get(conFiltros(R.adminAuditoria(), f)).then(V.pagina),
};
