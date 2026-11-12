/**
 * UNA sola conexión WSS por navegador, compartida por Control y Monitoreo.
 *
 * El sitio tiene varias páginas (GitHub Pages, sin servidor propio), así que
 * cada pestaña tiene su propio JavaScript. Para no abrir una conexión por
 * pestaña:
 *  - Las pestañas compiten por un candado (Web Locks API). La que lo obtiene
 *    es la "líder": abre la conexión WSS real (WsClient, con reconexión
 *    exponencial y latido) y retransmite su estado y sus eventos a las demás
 *    pestañas por un BroadcastChannel.
 *  - Las demás son "seguidoras": no abren conexión; reciben el estado real de
 *    la líder (En línea / Reconectando / Desconectado) y los mismos eventos.
 *  - Si la líder se cierra, el navegador libera el candado y otra pestaña
 *    toma el relevo abriendo su propia conexión (reconexión + resincronización).
 *    Si la líder queda congelada (teléfono en segundo plano) y deja de enviar
 *    latidos, una pestaña visible le quita el candado.
 * Al navegar DENTRO de la misma pestaña (Control → Monitoreo) la página se
 * descarga y la conexión se vuelve a abrir: es inevitable en un sitio de
 * varias páginas. Sin Web Locks o BroadcastChannel, cada pestaña usa su
 * propia conexión como antes.
 *
 * Interfaz idéntica a WsClient: eventos "estado", "mensaje" y "registro",
 * y los métodos conectar() / cerrar() y la propiedad `estado`.
 */
import { WsClient, WS } from "./ws-client.js";

const LATIDO_MS = 2000;
const LIDER_PERDIDO_MS = 7000;

export const compartirPosible = () => "locks" in navigator && typeof BroadcastChannel === "function";

export class WsCompartido extends EventTarget {
  /** @param {ConstructorParameters<typeof WsClient>[0]} opciones */
  constructor(opciones) {
    super();
    this.opciones = opciones;
    this.estado = WS.CERRADO;
    this.detalle = "";
    this.lider = false;
    this.real = null;              // WsClient (solo en la pestaña líder)
    this.canal = null;
    this.ultimoLatido = 0;
    this.espera = null;            // AbortController de la petición del candado en cola
    this.timers = { latido: null, vigia: null };
    this.nombre = `vehiculoIot-ws-${opciones.idVehiculo}`;
  }

  get rol() { return this.lider ? "líder" : "compartida"; }

  conectar() {
    if (!compartirPosible()) { this._serLider(); return; }
    if (this.canal) return;
    this.canal = new BroadcastChannel(this.nombre);
    this.canal.onmessage = (m) => this._recibir(m.data);
    this._estado(WS.CONECTANDO, "Buscando la conexión compartida…");
    this._pedirCandado(false);
    this.canal.postMessage({ tipo: "hola" });
    this.timers.vigia = setInterval(() => this._vigilarLider(), 1000);
    if (!this.escuchaPagina) {
      this.escuchaPagina = true;
      window.addEventListener("pagehide", () => this._soltar());
      // Vuelta desde la caché atrás/adelante: la conexión se soltó al salir, se pide de nuevo.
      window.addEventListener("pageshow", (e) => { if (e.persisted && !this.canal) this.conectar(); });
    }
  }

  cerrar() {
    this._soltar();
    this._estado(WS.CERRADO, "Cerrado");
  }

  /* --------------------------- Candado --------------------------- */

  _pedirCandado(robar) {
    this.espera?.abort();
    const ctl = robar ? null : new AbortController();
    this.espera = ctl;
    navigator.locks.request(this.nombre, robar ? { steal: true } : { signal: ctl.signal }, () => {
      this.espera = null;
      this._serLider();
      return new Promise((liberar) => { this._liberar = liberar; });        // se mantiene mientras la pestaña viva
    }).catch((e) => {
      if (e?.name !== "AbortError") return;
      // Otra pestaña nos quitó el candado (estábamos congelados) o se canceló la espera para robarlo.
      if (this.lider) {
        this._dejarDeSerLider();
        this._pedirCandado(false);
      }
    });
  }

  _vigilarLider() {
    if (this.lider || document.hidden) return;
    if (this.ultimoLatido && Date.now() - this.ultimoLatido > LIDER_PERDIDO_MS) {
      this.ultimoLatido = 0;
      this._registro("La pestaña con la conexión dejó de responder: esta pestaña toma la conexión.");
      this._pedirCandado(true);
    } else if (!this.ultimoLatido && this.estado === WS.CONECTANDO && Date.now() - (this.inicioEspera ??= Date.now()) > LIDER_PERDIDO_MS) {
      this._pedirCandado(true);                    // nadie contestó y el candado sigue ocupado
    }
  }

  /* --------------------------- Líder --------------------------- */

  _serLider() {
    if (this.lider) return;
    this.lider = true;
    this.real = new WsClient(this.opciones);
    this.real.addEventListener("estado", (e) => {
      this._estado(e.detail.estado, e.detail.detalle);
      this._difundir({ tipo: "estado", estado: e.detail.estado, detalle: e.detail.detalle });
    });
    this.real.addEventListener("mensaje", (e) => {
      this.dispatchEvent(new CustomEvent("mensaje", { detail: e.detail }));
      if (e.detail.evento !== "pong") this._difundir({ tipo: "mensaje", ev: e.detail });
    });
    this.real.addEventListener("registro", (e) => this._registro(e.detail));
    clearInterval(this.timers.latido);
    this.timers.latido = setInterval(() => this._difundir({ tipo: "latido", estado: this.estado, detalle: this.detalle }), LATIDO_MS);
    this.real.conectar();
  }

  _dejarDeSerLider() {
    this.lider = false;
    clearInterval(this.timers.latido);
    this.real?.cerrar();
    this.real = null;
    this.ultimoLatido = Date.now();               // da tiempo a la nueva líder
    this._estado(WS.RECONECTANDO, "Otra pestaña tomó la conexión");
  }

  _soltar() {
    clearInterval(this.timers.latido);
    clearInterval(this.timers.vigia);
    this.espera?.abort();
    this.real?.cerrar();
    this.real = null;
    this.lider = false;
    this._liberar?.();
    this.canal?.close();
    this.canal = null;
  }

  _difundir(msg) {
    try { this.canal?.postMessage(msg); } catch { /* canal cerrado */ }
  }

  /* --------------------------- Seguidora --------------------------- */

  _recibir(msg) {
    if (!msg || typeof msg !== "object") return;
    if (this.lider) {
      if (msg.tipo === "hola") this._difundir({ tipo: "estado", estado: this.estado, detalle: this.detalle });
      return;
    }
    if (msg.tipo === "estado" || msg.tipo === "latido") {
      this.ultimoLatido = Date.now();
      const detalle = `${msg.detalle || ""}${msg.detalle ? " · " : ""}conexión compartida con otra pestaña`;
      if (msg.estado !== this.estado || msg.tipo === "estado") this._estado(msg.estado, detalle);
    } else if (msg.tipo === "mensaje" && msg.ev) {
      this.ultimoLatido = Date.now();
      this.dispatchEvent(new CustomEvent("mensaje", { detail: msg.ev }));
    }
  }

  /* --------------------------- Común --------------------------- */

  _estado(estado, detalle = "") {
    const cambio = estado !== this.estado || detalle !== this.detalle;
    this.estado = estado;
    this.detalle = detalle;
    if (cambio) this.dispatchEvent(new CustomEvent("estado", { detail: { estado, detalle } }));
  }

  _registro(txt) {
    this.dispatchEvent(new CustomEvent("registro", { detail: txt }));
  }
}
