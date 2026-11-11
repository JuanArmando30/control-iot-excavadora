/**
 * Catálogo de comandos del vehículo (GET /vehiculos/{id}/comandos).
 * Es la única fuente de verdad: un botón o dirección solo existe si su
 * comando está en el catálogo y activo.
 */
import { CONFIG } from "../config.js";

export const DIRECCIONES = Object.freeze(["arriba", "abajo", "izquierda", "derecha"]);

/** Los dos mandos del control: cada uno asigna un código del catálogo a cada dirección. */
export const MANDOS = Object.freeze({ conduccion: CONFIG.direcciones, brazo: CONFIG.brazo });

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

  /**
   * Comando asignado a una dirección de un mando (joystick / cruceta), o null
   * si no está disponible. @param {"conduccion"|"brazo"} mando
   */
  direccion(dir, mando = "conduccion") {
    const codigo = MANDOS[mando]?.[dir];
    const c = this.porCodigo(codigo);
    if (!c || !c.activo) return null;
    if (this.detener && c.codigo === this.detener.codigo) return null;
    return c;
  }

  /** Comandos activos que no pertenecen a ningún mando ni son DETENER (botones centrales). */
  secundarios() {
    const excluidos = new Set(Object.values(MANDOS).flatMap((m) => Object.values(m)));
    const det = this.detener;
    return this.lista.filter((c) => c.activo && !excluidos.has(c.codigo) && (!det || c.codigo !== det.codigo));
  }

  /** Nombre legible: "GIRAR_PALA_IZQ" → "Girar pala izq". */
  static etiqueta(comando) {
    if (!comando) return "—";
    const t = comando.nombre.replace(/[_-]+/g, " ").toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /** Texto para botones pequeños: el corto de la configuración o el nombre legible. */
  static etiquetaCorta(comando) {
    return (comando && CONFIG.etiquetasCortas[comando.codigo]) || Catalogo.etiqueta(comando);
  }
}
