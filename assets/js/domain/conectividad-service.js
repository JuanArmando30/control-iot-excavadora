/**
 * Tres indicadores independientes:
 *  - WSS: eventos reales del WebSocket de este navegador.
 *  - API AWS: GET /health (proceso FastAPI vivo; existe en sistema.py).
 *  - Amazon RDS: GET /health/db (el backend ejecuta SELECT 1; 503 si falla).
 *    Si la API no responde, RDS queda "Sin verificar": no se puede concluir.
 * Ninguno equivale a "vehículo físico en línea".
 */
import { WS } from "../core/ws-client.js";
import { salud as esSaludOk } from "../core/validadores.js";

export const NIVEL = Object.freeze({ OK: "ok", MEDIO: "medio", MAL: "mal", NEUTRO: "neutro" });

const hora = () => new Date().toLocaleTimeString("es-MX", { hour12: false });

export class ConectividadService extends EventTarget {
  constructor({ api, intervaloMs }) {
    super();
    this.api = api;
    this.intervaloMs = intervaloMs;
    this.secuencia = 0;
    this.comprobando = false;
    this.timer = null;
    this.estado = {
      ws: { nivel: NIVEL.MAL, texto: "Desconectado", detalle: "Sin abrir" },
      api: { nivel: NIVEL.MEDIO, texto: "Comprobando", detalle: "Primera verificación" },
      rds: { nivel: NIVEL.NEUTRO, texto: "Sin verificar", detalle: "Esperando a la API" },
    };
  }

  iniciar() {
    this.comprobar();
    this.timer = setInterval(() => { if (!document.hidden) this.comprobar(); }, this.intervaloMs);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.comprobar(); });
    window.addEventListener("online", () => this.comprobar());
    window.addEventListener("offline", () => {
      this._set("api", NIVEL.MAL, "No disponible", "El dispositivo no tiene red");
      this._set("rds", NIVEL.NEUTRO, "Sin verificar", "Sin red");
    });
  }

  /** Traduce el estado del WsClient a los tres estados visibles. */
  actualizarWs(estado, detalle) {
    if (estado === WS.ABIERTO) this._set("ws", NIVEL.OK, "En línea", detalle);
    else if (estado === WS.CONECTANDO) this._set("ws", NIVEL.MEDIO, "Conectando", detalle);
    else if (estado === WS.RECONECTANDO) this._set("ws", NIVEL.MEDIO, "Reconectando", detalle);
    else this._set("ws", NIVEL.MAL, "Desconectado", detalle);
  }

  async comprobar({ manual = false } = {}) {
    if (this.comprobando) return;
    this.comprobando = true;
    const id = ++this.secuencia;

    if (manual || this.estado.api.nivel !== NIVEL.OK) {
      this._set("api", NIVEL.MEDIO, "Comprobando", "GET /health");
    }

    const [api, db] = await Promise.allSettled([this.api.salud(), this.api.saludDb()]);
    this.comprobando = false;
    if (id !== this.secuencia) return;          // respuesta tardía de una comprobación anterior

    const apiOk = api.status === "fulfilled" && esSaludOk(api.value.data);
    if (apiOk) this._set("api", NIVEL.OK, "Disponible", "Verificado " + hora());
    else this._set("api", NIVEL.MAL, "No disponible", api.reason?.message || "Respuesta inesperada de /health");

    if (db.status === "fulfilled" && esSaludOk(db.value.data)) {
      this._set("rds", NIVEL.OK, "Disponible", "SELECT 1 correcto · " + hora());
    } else if (db.status === "rejected" && db.reason?.status >= 500) {
      // El backend respondió y reportó la base de datos caída.
      this._set("rds", NIVEL.MAL, "No disponible", `El backend reporta HTTP ${db.reason.status} · ${hora()}`);
    } else {
      this._set("rds", NIVEL.NEUTRO, "Sin verificar", apiOk ? "El diagnóstico no respondió" : "La API no responde");
    }
  }

  _set(clave, nivel, texto, detalle = "") {
    const previo = this.estado[clave];
    const cambio = previo.nivel !== nivel || previo.texto !== texto;
    this.estado[clave] = { nivel, texto, detalle };
    this.dispatchEvent(new CustomEvent("cambio", { detail: { clave, ...this.estado[clave], cambio } }));
  }
}
