/**
 * Unidad que operan Control y Monitoreo (Etapa 8).
 *
 * - Comprador con sesión: SUS unidades (/mis-vehiculos).
 * - Empresa con sesión: su inventario activo (una vendida solo se opera con el
 *   soporte del comprador: el servidor lo decide).
 * - Sin sesión: la unidad de exhibición de config.js, como siempre (clave o
 *   control abierto, hasta la Etapa 9).
 * La elección se recuerda en sessionStorage (solo esta pestaña).
 */
import { CONFIG } from "../config.js";
import { sesionStore } from "./sesion-store.js";
import { auth } from "../api/auth-api.js";
import { admin } from "../api/admin-api.js";

const LLAVE = "vehiculoIot.unidad";

function leer() {
  try { return Number.parseInt(sessionStorage.getItem(LLAVE) || "", 10); } catch { return Number.NaN; }
}

/** @returns {Promise<{usuario: object|null, opciones: Array<{id:number, nombre:string}>, id: number, aviso: string}>} */
export async function resolverUnidad() {
  await auth.recuperar();                         // sesión de la pestaña (token de renovación)
  const usuario = sesionStore.usuario();
  let opciones = [];
  let aviso = "";
  try {
    if (usuario?.rol === "usuario") {
      opciones = (await auth.misVehiculos()).filter((v) => v.activo)
        .map((v) => ({ id: v.id_vehiculo, nombre: v.nombre }));
      if (!opciones.length) aviso = "Tu cuenta no tiene unidades asignadas: ves la unidad de exhibición, sin control.";
    } else if (usuario?.rol === "admin") {
      opciones = (await admin.unidades({ limite: 200 })).elementos
        .filter((u) => u.activo && u.estado_comercial !== "baja")
        .map((u) => ({ id: u.id_vehiculo, nombre: u.estado_comercial === "vendida" ? `${u.nombre} (vendida · requiere soporte)` : u.nombre }));
    }
  } catch (e) {
    aviso = `No se pudieron cargar tus unidades (${e.message}). Se muestra la unidad de exhibición.`;
  }
  if (!opciones.length) opciones = [{ id: CONFIG.vehiculoId, nombre: "" }];
  const guardado = leer();
  const id = opciones.some((o) => o.id === guardado) ? guardado : opciones[0].id;
  return { usuario, opciones, id, aviso };
}

/** Cambia de unidad: se guarda y se recarga la página (todo se vuelve a iniciar con la nueva). */
export function elegirUnidad(id) {
  try { sessionStorage.setItem(LLAVE, String(id)); } catch { /* modo privado */ }
  location.reload();
}

/** Identidad para no compartir la conexión WSS entre pestañas de personas distintas. */
export function identidadWs() {
  const u = sesionStore.usuario();
  return u ? `u${u.id_usuario}` : "anonimo";
}
