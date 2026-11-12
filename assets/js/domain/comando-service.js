/**
 * Servicio ÚNICO de envío de comandos. Lo usan joystick, cruceta, botones
 * secundarios, teclado y voz.
 *
 * Reglas:
 *  - Solo envía códigos ACTIVOS del catálogo.
 *  - Una orden de movimiento en vuelo a la vez; si llega otra, queda como
 *    "pendiente" y reemplaza a cualquier pendiente anterior (gana la última).
 *  - Ignora duplicados (mismo código ya en vuelo o pendiente).
 *  - DETENER tiene prioridad absoluta: descarta lo pendiente, no espera la
 *    cola y se reintenta una vez ante fallo de red.
 *  - Orden tardía: si un movimiento enviado ANTES del paro se confirma
 *    DESPUÉS, no se reenvía DETENER a ciegas (eso duplicaba el paro). Se
 *    comprueba con el WebSocket, que difunde los movimientos en el orden en
 *    que el servidor los procesó: solo si el último evento no es DETENER se
 *    reafirma. Sin WSS no se puede comprobar y se reafirma por seguridad.
 *  - Una respuesta HTTP 201 significa "registrado en la API", NO "ejecutado
 *    por el vehículo".
 */
import { claveStore } from "../core/clave-store.js";

export const FASE = Object.freeze({
  ENVIANDO: "enviando",
  ACEPTADO: "aceptado",
  ERROR: "error",
  DESCARTADO: "descartado",
});

/** Espera para que lleguen por WSS los eventos de la orden tardía y del paro. */
const VERIFICAR_MS = 700;

export class ComandoService extends EventTarget {
  /**
   * @param {{api: object, vehiculoId: number, obtenerCatalogo: () => import("./catalogo.js").Catalogo,
   *          demoActiva: () => boolean, wsActivo?: () => boolean}} op
   */
  constructor({ api, vehiculoId, obtenerCatalogo, demoActiva, wsActivo = () => false }) {
    super();
    Object.assign(this, { api, vehiculoId, obtenerCatalogo, demoActiva, wsActivo });
    this.ultimoServidor = null;   // último código difundido por el servidor (WSS), en su orden real
    this.verificacion = null;     // temporizador de la comprobación de un paro con orden tardía
    this.generacion = 0;
    this.enVuelo = null;        // {codigo, origen, gen}
    this.pendiente = null;      // {codigo, origen, gen, promesa, resolver}
    this.paroEnVuelo = null;    // Promise
    this.paroRepetir = null;    // origen del paro que debe repetirse
  }

  /** Motivo por el que NO se puede enviar un movimiento, o null si es válido. */
  motivoRechazo(codigo) {
    const cat = this.obtenerCatalogo();
    if (!cat.cargado) return "El catálogo de comandos aún no se ha cargado.";
    if (!Number.isInteger(codigo) || !cat.esActivo(codigo)) return "Ese comando no está disponible en el catálogo del vehículo.";
    if (this.demoActiva()) return "Hay una DEMO en ejecución. Usa DETENER para cancelarla.";
    if (!claveStore.puedeControlar()) return "Falta la clave de operador (Ajustes).";
    return null;
  }

  /** Movimiento individual. Si el código es DETENER, se redirige a detener(). */
  enviar(codigo, origen) {
    const det = this.obtenerCatalogo().detener;
    if (det && codigo === det.codigo) return this.detener(origen);

    const motivo = this.motivoRechazo(codigo);
    if (motivo) {
      this._fase(codigo, FASE.ERROR, motivo);
      return Promise.resolve({ ok: false, estado: "rechazado", mensaje: motivo });
    }

    if (this.enVuelo && this.enVuelo.codigo === codigo && this.enVuelo.gen === this.generacion) {
      return Promise.resolve({ ok: true, estado: "duplicado" });
    }
    if (this.pendiente) {
      if (this.pendiente.codigo === codigo) return this.pendiente.promesa;
      this._descartarPendiente("reemplazado");
    }

    this._cancelarVerificacion();          // una orden nueva tras el paro es intencional: no hay que reafirmar nada
    const item = { codigo, origen, gen: this.generacion };
    if (this.enVuelo || this.paroEnVuelo) {
      item.promesa = new Promise((r) => { item.resolver = r; });
      this.pendiente = item;
      this._fase(codigo, FASE.ENVIANDO, "En cola");
      return item.promesa;
    }
    return this._despachar(item);
  }

  /** DETENER con prioridad absoluta. */
  detener(origen) {
    this.generacion++;
    this._descartarPendiente("cancelado");

    const det = this.obtenerCatalogo().detener;
    if (!det) {
      const mensaje = "El catálogo no tiene un comando DETENER activo.";
      this.dispatchEvent(new CustomEvent("paro", { detail: { ok: false, mensaje } }));
      return Promise.resolve({ ok: false, estado: "rechazado", mensaje });
    }
    if (this.paroEnVuelo) {
      this.paroRepetir = origen;
      return this.paroEnVuelo;
    }
    return this._lanzarParo(det, origen);
  }

  _lanzarParo(det, origen) {
    const p = this._postParo(det, origen).finally(() => {
      if (this.paroEnVuelo !== p) return;
      this.paroEnVuelo = null;
      if (this.paroRepetir) {
        const o = this.paroRepetir;
        this.paroRepetir = null;
        this._lanzarParo(det, o);
      } else {
        this._siguiente();
      }
    });
    this.paroEnVuelo = p;
    return p;
  }

  async _postParo(det, origen) {
    this._fase(det.codigo, FASE.ENVIANDO);
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const r = await this.api.moverPorCodigo(this.vehiculoId, det.codigo, origen);
        this._fase(det.codigo, FASE.ACEPTADO, "", r);
        this.dispatchEvent(new CustomEvent("paro", { detail: { ok: true, respuesta: r } }));
        return { ok: true, estado: "aceptado", respuesta: r };
      } catch (e) {
        const reintentable = e.tipo === "RED" || e.tipo === "TIMEOUT";
        if (intento === 1 && reintentable) continue;
        this._fase(det.codigo, FASE.ERROR, e.message);
        this.dispatchEvent(new CustomEvent("paro", { detail: { ok: false, mensaje: e.message, error: e } }));
        this.dispatchEvent(new CustomEvent("fallo", { detail: { codigo: det.codigo, error: e } }));
        return { ok: false, estado: "error", mensaje: e.message, error: e };
      }
    }
    return { ok: false, estado: "error" };
  }

  async _despachar(item) {
    this.enVuelo = item;
    this._fase(item.codigo, FASE.ENVIANDO);
    let res;
    try {
      const r = await this.api.moverPorCodigo(this.vehiculoId, item.codigo, item.origen);
      if (item.gen !== this.generacion) {
        // Se pidió DETENER mientras esta orden viajaba: el servidor pudo
        // aplicarla después del paro, así que se reafirma DETENER.
        this._fase(item.codigo, FASE.DESCARTADO);
        res = { ok: true, estado: "tardio", respuesta: r };
        this.enVuelo = null;
        this._verificarParo(item.origen);
      } else {
        this._fase(item.codigo, FASE.ACEPTADO, "", r);
        res = { ok: true, estado: "aceptado", respuesta: r };
      }
    } catch (e) {
      const vigente = item.gen === this.generacion;
      this._fase(item.codigo, vigente ? FASE.ERROR : FASE.DESCARTADO, e.message);
      if (vigente) this.dispatchEvent(new CustomEvent("fallo", { detail: { codigo: item.codigo, error: e } }));
      res = { ok: false, estado: "error", mensaje: e.message, error: e };
    } finally {
      if (this.enVuelo === item) this.enVuelo = null;
    }
    this._siguiente();
    return res;
  }

  /** La página informa cada movimiento que difunde el servidor por WSS (en su orden real). */
  registrarEventoServidor(codigo) {
    this.ultimoServidor = codigo;
  }

  /**
   * Hubo una orden tardía: ¿el servidor la aplicó antes o después del paro?
   * Se espera un momento a que lleguen los eventos WSS y se mira el último.
   */
  _verificarParo(origen) {
    if (!this.wsActivo()) { this._reafirmarParo(origen); return; }   // sin WSS no se puede saber: por seguridad
    this._cancelarVerificacion();
    this.verificacion = setTimeout(() => {
      this.verificacion = null;
      const det = this.obtenerCatalogo().detener;
      if (!det) return;
      if (this.paroEnVuelo) { this._verificarParo(origen); return; }  // aún no responde el paro: volver a mirar
      if (this.ultimoServidor !== det.codigo) this._reafirmarParo(origen);
    }, VERIFICAR_MS);
  }

  _cancelarVerificacion() {
    clearTimeout(this.verificacion);
    this.verificacion = null;
  }

  _reafirmarParo(origen) {
    const det = this.obtenerCatalogo().detener;
    if (!det) return;
    if (this.paroEnVuelo) { this.paroRepetir = origen; return; }
    this._lanzarParo(det, origen);
  }

  _siguiente() {
    if (this.enVuelo || this.paroEnVuelo || !this.pendiente) return;
    const sig = this.pendiente;
    this.pendiente = null;
    if (sig.gen === this.generacion && !this.motivoRechazo(sig.codigo)) {
      this._despachar(sig).then(sig.resolver);
    } else {
      this._fase(sig.codigo, FASE.DESCARTADO);
      sig.resolver({ ok: false, estado: "cancelado" });
    }
  }

  _descartarPendiente(estado) {
    if (!this.pendiente) return;
    const p = this.pendiente;
    this.pendiente = null;
    this._fase(p.codigo, FASE.DESCARTADO);
    p.resolver({ ok: false, estado });
  }

  _fase(codigo, fase, mensaje = "", respuesta = null) {
    this.dispatchEvent(new CustomEvent("fase", { detail: { codigo, fase, mensaje, respuesta } }));
  }
}
