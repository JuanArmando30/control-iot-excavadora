/**
 * Reconocimiento de voz (Web Speech API). Solo captura texto: la decisión
 * de qué enviar la toma la página con el mismo servicio de comandos.
 * Entrega TODAS las alternativas que propone el reconocedor (hasta 3), para
 * que el intérprete use la primera que tenga sentido.
 * Cada sesión usa un reconocedor nuevo (Chrome Android falla al reutilizarlo).
 */
import { esParo } from "../domain/interprete-voz.js";

const MENSAJES_ERROR = {
  "not-allowed": "Permiso de micrófono denegado. Actívalo desde el candado de la barra de direcciones.",
  "service-not-allowed": "Este navegador no ofrece reconocimiento de voz. Usa Chrome o escribe la orden.",
  "audio-capture": "No se detecta un micrófono.",
  network: "El reconocimiento de voz necesita internet.",
  "no-speech": "No se oyó nada. Inténtalo de nuevo.",
  "language-not-supported": "El español no está disponible para voz en este navegador.",
};

export const vozSoportada = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export class ControlVoz {
  /**
   * @param {{onFrase:(alternativas:string[])=>void, onParoInmediato:()=>void,
   *          onEstado:(txt:string)=>void, onTexto:(txt:string, final:boolean)=>void,
   *          onCambio:(escuchando:boolean)=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.activa = false;
    this.manosLibres = false;
    this.rec = null;
    this.ultimoParo = 0;
  }

  alternar() { this.activa ? this.detener() : this.iniciar(); }

  iniciar() {
    if (!vozSoportada()) { this.cb.onEstado("Reconocimiento de voz no disponible en este navegador."); return; }
    if (!window.isSecureContext) { this.cb.onEstado("La voz solo funciona en páginas HTTPS."); return; }
    this.activa = true;
    this._sesion();
  }

  detener() {
    this.activa = false;
    const rec = this.rec;
    this.rec = null;
    try { rec?.abort(); } catch { /* */ }
    this.cb.onCambio(false);
  }

  _sesion() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "es-MX";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 3;
    this.rec = rec;
    const vigente = () => this.rec === rec;

    rec.onstart = () => { if (vigente()) { this.cb.onCambio(true); this.cb.onEstado("Escuchando… habla ahora."); } };
    rec.onresult = (e) => {
      if (!vigente()) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0].transcript;
        this.cb.onTexto(txt, res.isFinal);
        if (!res.isFinal) {
          if (esParo(txt)) this._paro();              // "alto" sin esperar el resultado final
          continue;
        }
        const alternativas = Array.from(res, (a) => a.transcript).filter((t) => t && t.trim());
        if (alternativas.some(esParo)) { this._paro(); continue; }   // "alto" en cualquier alternativa
        this.cb.onFrase(alternativas);
        if (!this.manosLibres) { try { rec.stop(); } catch { /* */ } }
      }
    };
    rec.onerror = (e) => {
      if (!vigente() || e.error === "aborted") return;
      this.cb.onEstado(MENSAJES_ERROR[e.error] || "Error de voz: " + e.error);
      if (e.error !== "no-speech") this.activa = false;
    };
    rec.onend = () => {
      if (!vigente()) return;
      this.cb.onCambio(false);
      if (this.activa && this.manosLibres && !document.hidden) {
        setTimeout(() => { if (this.activa) this._sesion(); }, 400);
      } else {
        this.activa = false;
      }
    };
    try { rec.start(); } catch (err) {
      this.activa = false;
      this.cb.onEstado("No se pudo iniciar el micrófono.");
      this.cb.onCambio(false);
    }
  }

  _paro() {
    const ahora = Date.now();
    if (ahora - this.ultimoParo < 1500) return;       // parcial + final = un solo paro
    this.ultimoParo = ahora;
    this.cb.onParoInmediato();
  }
}
