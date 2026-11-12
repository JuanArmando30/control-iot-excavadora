/**
 * Reglas de MONITOREO, sin DOM (se prueban con datos simulados).
 *
 * UltimoMovimiento — tarjeta "último movimiento REPORTADO":
 *  - Fuentes: GET /estado (al entrar y al reconectar) y eventos WSS del mismo
 *    vehículo (movimiento_individual, estado_inicial, estado_actualizado y
 *    demo_movimiento), vengan de esta sesión o de otra.
 *  - Solo se acepta un dato MÁS NUEVO que el que se muestra, comparando la
 *    marca temporal del servidor. Así una respuesta REST lenta no pisa un
 *    evento WSS más reciente, y un evento repetido o retrasado se ignora.
 *  - Sin marca temporal no se inventa ninguna: se muestra «—».
 *
 * HistorialReciente — tabla de los diez movimientos PERSISTIDOS:
 *  - Solo datos de GET /historial (nunca filas fabricadas ni pasos de DEMO).
 *  - Cada respuesta lleva un número de solicitud; una respuesta más vieja que
 *    la última aplicada se descarta (respuestas fuera de orden).
 *  - Sin duplicados (por id_historial), del más reciente al más antiguo,
 *    máximo 10. Informa qué filas son nuevas para resaltarlas.
 */

/** Convierte la fecha del servidor a milisegundos. MySQL entrega TIMESTAMP sin zona: el servidor trabaja en UTC. */
export function msServidor(txt) {
  if (!txt || typeof txt !== "string") return null;
  const iso = /Z|[+-]\d\d:?\d\d$/.test(txt) ? txt : txt.replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export const FUENTE = Object.freeze({ REST: "rest", WSS: "wss" });

export class UltimoMovimiento {
  constructor() {
    /** @type {null|{comando:string|null, codigo:number|null, ms:number|null, origen:string|null,
     *               fuente:string, evento:string, demo:null|{orden:number|null,total:number|null}}} */
    this.actual = null;
    this.firmas = new Set();
  }

  /** Respuesta de GET /estado (puede ser null: el vehículo aún no tiene estado). */
  desdeEstado(e) {
    if (!e) return false;
    return this._aplicar({
      comando: e.comando, codigo: e.codigo, ms: msServidor(e.fecha_actualizacion), origen: null,
      fuente: FUENTE.REST, evento: "GET /estado", demo: null,
    });
  }

  /** Evento WSS ya validado (mismo vehículo). Devuelve true si cambió la tarjeta. */
  desdeEvento(ev) {
    const ms = msServidor(ev.timestamp) ?? msServidor(ev.datos?.fecha_actualizacion);
    switch (ev.evento) {
      case "movimiento_individual":
        return this._aplicar({ comando: ev.comando, codigo: ev.codigo, ms, origen: ev.datos.origen, fuente: FUENTE.WSS, evento: ev.evento, demo: null });
      case "estado_inicial":
      case "estado_actualizado":
        if (!ev.comando && ev.codigo == null) return false;
        return this._aplicar({ comando: ev.comando, codigo: ev.codigo, ms: msServidor(ev.datos.fecha_actualizacion) ?? ms, origen: null, fuente: FUENTE.WSS, evento: ev.evento, demo: null });
      case "demo_movimiento":
        return this._aplicar({ comando: ev.comando, codigo: ev.codigo, ms, origen: null, fuente: FUENTE.WSS, evento: ev.evento,
          demo: { orden: ev.datos.orden, total: ev.datos.total_movimientos } });
      default:
        return false;
    }
  }

  _aplicar(c) {
    if (!c.comando && c.codigo == null) return false;
    const firma = `${c.evento}|${c.codigo}|${c.ms}|${c.demo?.orden ?? ""}`;
    if (c.ms != null && this.firmas.has(firma)) return false;               // evento repetido
    const a = this.actual;
    if (a) {
      if (c.ms == null) return false;                                         // sin fecha no desplaza a un dato fechado
      if (a.ms != null && c.ms < a.ms) return false;                          // retrasado o REST viejo
      // Mismo instante: un evento WSS del movimiento es más completo que el estado REST (trae origen).
      if (a.ms != null && c.ms === a.ms && !(c.fuente === FUENTE.WSS && a.fuente === FUENTE.REST)) return false;
    }
    if (c.ms != null) {
      this.firmas.add(firma);
      if (this.firmas.size > 200) this.firmas = new Set([...this.firmas].slice(-100));
    }
    this.actual = c;
    return true;
  }
}

export class HistorialReciente {
  constructor(max = 10) {
    this.max = max;
    this.filas = [];             // movimientos ya ordenados
    this.solicitudes = 0;
    this.aplicada = 0;
    this.cargado = false;
  }

  /** Número para la próxima consulta (se pasa a aplicar()). */
  nuevaSolicitud() { return ++this.solicitudes; }

  /**
   * @param {number} n número de la solicitud que devolvió estos datos
   * @param {Array<{id_historial:number|null, comando:string|null, codigo:number|null, fecha_hora:string|null, origen:string}>} movimientos
   * @returns {null | {filas: any[], nuevas: Set<string>}} null si la respuesta es vieja y se descartó
   */
  aplicar(n, movimientos) {
    if (n < this.aplicada) return null;
    this.aplicada = n;
    const vistas = new Set();
    const filas = [];
    for (const m of movimientos) {
      const clave = m.id_historial != null ? `id:${m.id_historial}` : `f:${m.fecha_hora}|${m.codigo}|${m.origen}`;
      if (vistas.has(clave)) continue;                                        // duplicado en la respuesta
      vistas.add(clave);
      filas.push({ ...m, clave, ms: msServidor(m.fecha_hora) });
    }
    // Del más reciente al más antiguo: fecha del servidor y, a igual fecha, id (autoincremental).
    filas.sort((a, b) => (b.ms ?? -Infinity) - (a.ms ?? -Infinity) || (b.id_historial ?? 0) - (a.id_historial ?? 0));
    const antes = new Set(this.filas.map((f) => f.clave));
    this.filas = filas.slice(0, this.max);
    const nuevas = new Set(this.cargado ? this.filas.filter((f) => !antes.has(f.clave)).map((f) => f.clave) : []);
    this.cargado = true;
    return { filas: this.filas, nuevas };
  }
}
