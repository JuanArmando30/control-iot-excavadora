/**
 * Sesión WSS real del navegador con reconexión exponencial, latido
 * ("ping" → evento "pong") y detección de conexiones colgadas.
 *
 * Importante: "abierto" significa que ESTE navegador está suscrito al canal
 * del vehículo. No indica que el vehículo físico esté conectado.
 */
import { eventoWs } from "./validadores.js";

export const WS = Object.freeze({
  CONECTANDO: "conectando",
  ABIERTO: "abierto",
  RECONECTANDO: "reconectando",
  ESPERANDO: "esperando",        // cerrado, con reintento programado
  CERRADO: "cerrado",            // cerrado sin reintento (4404, cierre manual)
});

const CIERRE_NO_ENCONTRADO = 4404;
const CIERRE_SIN_PONG = 4000;

export class WsClient extends EventTarget {
  /**
   * @param {{url: string, idVehiculo: number, pingMs: number, pongMaxMs: number,
   *          baseMs: number, maxMs: number}} op
   */
  constructor({ url, idVehiculo, pingMs, pongMaxMs, baseMs, maxMs }) {
    super();
    const u = new URL(url);
    if (u.protocol !== "wss:" && location.protocol === "https:") {
      throw new Error("El WebSocket debe usar WSS en una página HTTPS.");
    }
    Object.assign(this, { url: u.href, idVehiculo, pingMs, pongMaxMs, baseMs, maxMs });
    this.ws = null;
    this.estado = WS.CERRADO;
    this.intentos = 0;
    this.manual = false;
    this.timers = { reconexion: null, ping: null, pong: null };
    this.proximoIntento = null;

    window.addEventListener("online", () => this._reconectarYa("La red volvió"));
    window.addEventListener("offline", () => this.ws?.close(CIERRE_SIN_PONG, "offline"));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && (this.estado === WS.ESPERANDO)) this._reconectarYa("La pestaña volvió a estar visible");
    });
  }

  conectar() {
    this.manual = false;
    this._abrir(this.intentos > 0 ? WS.RECONECTANDO : WS.CONECTANDO);
  }

  cerrar() {
    this.manual = true;
    this._limpiar();
    if (this.ws) { try { this.ws.close(1000, "cierre manual"); } catch { /* ya cerrado */ } }
    this.ws = null;
    this._estado(WS.CERRADO, "Cerrado por el usuario");
  }

  _abrir(estadoInicial) {
    this._limpiar();
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* */ } }

    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this._estado(WS.CERRADO, "URL de WebSocket inválida");
      return;
    }
    this.ws = ws;
    this._estado(estadoInicial, estadoInicial === WS.RECONECTANDO ? `Intento ${this.intentos + 1}` : "");

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.intentos = 0;
      this._estado(WS.ABIERTO, "Suscrito al vehículo " + this.idVehiculo);
      this.timers.ping = setInterval(() => this._ping(), this.pingMs);
    };

    ws.onmessage = (m) => {
      if (ws !== this.ws) return;
      clearTimeout(this.timers.pong);              // cualquier mensaje demuestra que el canal vive
      const ev = eventoWs(m.data, this.idVehiculo);
      if (ev) this.dispatchEvent(new CustomEvent("mensaje", { detail: ev }));
    };

    ws.onerror = () => {
      if (ws !== this.ws) return;
      this.dispatchEvent(new CustomEvent("registro", { detail: "Error en el WebSocket (el navegador no da detalles)." }));
    };

    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      this._limpiar();
      this.ws = null;
      if (this.manual) return;
      if (ev.code === CIERRE_NO_ENCONTRADO) {
        this._estado(WS.CERRADO, "El vehículo no existe (código 4404)");
        return;
      }
      const espera = this._espera();
      this.proximoIntento = Date.now() + espera;
      this._estado(WS.ESPERANDO, `Código ${ev.code || "—"} · reintento en ${Math.ceil(espera / 1000)} s`);
      this.timers.reconexion = setTimeout(() => this._abrir(WS.RECONECTANDO), espera);
    };
  }

  _ping() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send("ping"); } catch { return; }
    clearTimeout(this.timers.pong);
    this.timers.pong = setTimeout(() => {
      this.dispatchEvent(new CustomEvent("registro", { detail: "Sin respuesta al ping: reconectando." }));
      try { this.ws?.close(CIERRE_SIN_PONG, "sin pong"); } catch { /* */ }
    }, this.pongMaxMs);
  }

  _espera() {
    const n = Math.min(this.intentos++, 6);
    const base = Math.min(this.maxMs, this.baseMs * 2 ** n);
    return Math.round(base * (0.8 + Math.random() * 0.4));   // jitter ±20 %
  }

  _reconectarYa(motivo) {
    if (this.manual || this.estado !== WS.ESPERANDO) return;
    this.dispatchEvent(new CustomEvent("registro", { detail: motivo + ": reconectando." }));
    this._abrir(WS.RECONECTANDO);
  }

  _limpiar() {
    clearTimeout(this.timers.reconexion);
    clearInterval(this.timers.ping);
    clearTimeout(this.timers.pong);
  }

  _estado(estado, detalle = "") {
    this.estado = estado;
    this.dispatchEvent(new CustomEvent("estado", { detail: { estado, detalle } }));
  }
}
