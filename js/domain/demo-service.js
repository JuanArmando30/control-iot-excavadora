/**
 * DEMO: el backend decide orden y tiempos. El navegador solo pide iniciar o
 * cancelar y refleja el avance que llega por WebSocket. No hay CRUD aquí ni
 * se reproduce la secuencia en el cliente.
 */

export class DemoService extends EventTarget {
  constructor({ api, vehiculoId }) {
    super();
    Object.assign(this, { api, vehiculoId });
    this.demos = [];
    this.estado = this._vacio();
    this.solicitando = false;     // POST iniciar/cancelar en curso
  }

  _vacio() {
    return { activa: false, idDemo: null, nombre: "", total: 0, orden: 0, comando: null, duracionMs: 0, fin: "" };
  }

  get activa() { return this.estado.activa; }

  async cargar() {
    this.demos = (await this.api.demos(this.vehiculoId)).filter((d) => d.activo);
    this._emitir();
    return this.demos;
  }

  /** Recupera el estado real tras cargar la página o reconectar el WSS. */
  async sincronizar() {
    const e = await this.api.ejecucionDemo(this.vehiculoId);
    if (e.en_ejecucion) {
      Object.assign(this.estado, {
        activa: true, idDemo: e.id_demo, nombre: e.nombre || "", total: e.total_movimientos,
        orden: e.movimientos_emitidos, fin: "",
      });
    } else if (this.estado.activa) {
      this.estado = { ...this._vacio(), fin: "La DEMO ya no está en ejecución." };
    }
    this._emitir();
  }

  async iniciar(idDemo) {
    if (this.estado.activa) throw new Error("Ya hay una DEMO en ejecución.");
    if (this.solicitando) throw new Error("Espera la respuesta de la solicitud anterior.");
    if (!this.demos.some((d) => d.id_demo === idDemo)) throw new Error("Selecciona una DEMO válida.");
    this.solicitando = true;
    this._emitir();
    try {
      const r = await this.api.iniciarDemo(this.vehiculoId, idDemo);
      // 202: aceptada; el avance real llegará por WebSocket.
      if (!this.estado.activa) {
        Object.assign(this.estado, { activa: true, idDemo: r.id_demo, nombre: r.nombre, total: r.total_movimientos, orden: 0, fin: "" });
      }
      return r;
    } catch (e) {
      if (e.status === 409) await this.sincronizar().catch(() => {});
      throw e;
    } finally {
      this.solicitando = false;
      this._emitir();
    }
  }

  async cancelar() {
    this.solicitando = true;
    this._emitir();
    try {
      const r = await this.api.cancelarDemo(this.vehiculoId);
      this.estado = { ...this._vacio(), fin: "DEMO cancelada." };
      return r;
    } catch (e) {
      if (e.status === 409) this.estado = { ...this._vacio(), fin: "No había DEMO en ejecución." };
      throw e;
    } finally {
      this.solicitando = false;
      this._emitir();
    }
  }

  /** Aplica los eventos WebSocket de DEMO. Devuelve true si el evento era de DEMO. */
  procesarEvento(ev) {
    const d = ev.datos;
    switch (ev.evento) {
      case "demo_iniciada":
        this.estado = { ...this._vacio(), activa: true, idDemo: d.id_demo, nombre: d.nombre || "", total: d.total_movimientos || 0 };
        break;
      case "demo_movimiento":
        Object.assign(this.estado, {
          activa: true, idDemo: d.id_demo, orden: d.orden || 0,
          total: d.total_movimientos || this.estado.total, comando: ev.comando, duracionMs: d.duracion_ms || 0,
        });
        break;
      case "demo_finalizada":
        this.estado = { ...this._vacio(), total: this.estado.total, orden: d.movimientos_ejecutados ?? this.estado.total, fin: "DEMO finalizada." };
        break;
      case "demo_cancelada":
        this.estado = { ...this._vacio(), total: this.estado.total, orden: d.movimientos_ejecutados ?? 0,
          fin: `DEMO cancelada${d.detenido_con ? " · estado: " + d.detenido_con : ""}.` };
        break;
      case "error":
        if (d.id_demo == null) return false;          // error no relacionado con la DEMO
        this.estado = { ...this._vacio(), fin: "La DEMO terminó por un error del servidor." };
        break;
      default:
        return false;
    }
    this._emitir(ev.evento);
    return true;
  }

  _emitir(evento = "") {
    this.dispatchEvent(new CustomEvent("cambio", { detail: { ...this.estado, solicitando: this.solicitando, evento } }));
  }
}
