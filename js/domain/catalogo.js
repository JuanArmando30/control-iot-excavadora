/**
 * Catálogo de comandos del vehículo (GET /vehiculos/{id}/comandos).
 * Es la única fuente de verdad: un botón o dirección solo existe si su
 * comando está en el catálogo y activo.
 */
import { CONFIG } from "../config.js";

export const DIRECCIONES = Object.freeze(["arriba", "abajo", "izquierda", "derecha"]);

export class Catalogo {
  /** @param {Array<{id_comando:number,nombre:string,codigo:number,descripcion:string|null,activo:boolean}>} comandos */
  constructor(comandos = []) {
    this.lista = comandos.slice().sort((a, b) => a.codigo - b.codigo);
    this.porCodigoMap = new Map(this.lista.map((c) => [c.codigo, c]));
    this.cargado = comandos.length > 0;
  }

  porCodigo(codigo) { return this.porCodigoMap.get(codigo) || null; }

  esActivo(codigo) {
    const c = this.porCodigo(codigo);
    return !!(c && c.activo);
  }

  /** Comando DETENER activo (mismo criterio que el backend). */
  get detener() {
    const nombre = CONFIG.nombreDetener.toUpperCase();
    return this.lista.find((c) => c.activo && c.nombre.toUpperCase() === nombre) || null;
  }

  /** Comando asignado a una dirección del joystick / cruceta, o null si no está disponible. */
  direccion(dir) {
    const codigo = CONFIG.direcciones[dir];
    const c = this.porCodigo(codigo);
    if (!c || !c.activo) return null;
    if (this.detener && c.codigo === this.detener.codigo) return null;
    return c;
  }

  /** Comandos activos que no son direcciones ni DETENER (botones secundarios). */
  secundarios() {
    const excluidos = new Set(Object.values(CONFIG.direcciones));
    const det = this.detener;
    return this.lista.filter((c) => c.activo && !excluidos.has(c.codigo) && (!det || c.codigo !== det.codigo));
  }

  /** Nombre legible: "GIRAR_PALA_IZQ" → "Girar pala izq". */
  static etiqueta(comando) {
    if (!comando) return "—";
    const t = comando.nombre.replace(/[_-]+/g, " ").toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
}
