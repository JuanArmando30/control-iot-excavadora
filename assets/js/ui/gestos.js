/**
 * Modo IA: cámara + MediaPipe Gesture Recognizer, todo dentro del navegador.
 *
 * - Funciona en teléfonos, tabletas y computadoras (cámara frontal o webcam).
 * - La librería (~0.3 MB + ~11 MB de WebAssembly) y el modelo (~8 MB) se
 *   descargan SOLO al pulsar «Activar» la primera vez; luego quedan en caché.
 * - El video nunca sale del dispositivo: no se graba ni se envía.
 * - Se analizan ~15 cuadros por segundo; el dibujo (esqueleto de la mano,
 *   centro y dirección) va en un <canvas> encima del video, en espejo.
 * - Seguridad: se pausa al ocultar la pestaña; si el análisis se atasca o la
 *   cámara deja de dar cuadros, se suelta el mando (la página envía DETENER).
 */
import { CONFIG } from "../config.js";
import { InterpreteGestos, AJUSTES, FORMA } from "../domain/interprete-gestos.js";

/** Conexiones de los 21 puntos de la mano (para dibujar el esqueleto). */
const HUESOS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const PALMA = [0, 5, 9, 13, 17];
const VIGIA_MS = 700;

export const NOMBRE_FORMA = Object.freeze({
  [FORMA.puno]: "✊ Puño", [FORMA.victoria]: "✌️ Victoria", [FORMA.abierta]: "✋ Mano abierta",
  [FORMA.pulgarArriba]: "👍 Pulgar arriba", [FORMA.pulgarAbajo]: "👎 Pulgar abajo", [FORMA.teQuiero]: "🤟 Te quiero",
  [FORMA.indice]: "☝️ Índice arriba", [FORMA.ninguna]: "Mano sin gesto claro", [FORMA.sinMano]: "Sin mano",
});

export const gestosPosibles = () => !!navigator.mediaDevices?.getUserMedia;

/** El reconocedor se crea una sola vez por página (cuesta varios segundos). */
let reconocedorPromesa = null;
function cargarReconocedor(onAvance) {
  reconocedorPromesa ??= (async () => {
    onAvance("Descargando la IA (solo la primera vez, ~20 MB)…");
    const { FilesetResolver, GestureRecognizer } = await import(CONFIG.ia.libreria);
    const archivos = await FilesetResolver.forVisionTasks(CONFIG.ia.wasm);
    onAvance("Preparando el modelo de gestos…");
    const opciones = (delegate) => ({
      baseOptions: { modelAssetPath: CONFIG.ia.modelo, delegate },
      runningMode: "VIDEO", numHands: 1,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
    });
    try { return await GestureRecognizer.createFromOptions(archivos, opciones("GPU")); }
    catch { return GestureRecognizer.createFromOptions(archivos, opciones("CPU")); }      // sin WebGL utilizable
  })();
  reconocedorPromesa.catch(() => { reconocedorPromesa = null; });      // permite reintentar
  return reconocedorPromesa;
}

export class ControlGestos {
  /**
   * @param {{escena:HTMLElement, video:HTMLVideoElement, lienzo:HTMLCanvasElement, etiqueta:HTMLElement,
   *          carga:HTMLElement, guia:HTMLElement}} vista
   * @param {{onDireccion:(mando:string, dir:string|null)=>void, onAccesorio:(codigo:number)=>void,
   *          onEstado:(txt:string, tipo?:string)=>void, onCambio:(activo:boolean)=>void}} cb
   */
  constructor(vista, cb) {
    Object.assign(this, vista, { cb });
    this.activo = false;
    this.cargando = false;
    this.flujo = null;
    this.reconocedor = null;
    this.ultimoAnalisis = 0;
    this.ultimoCuadro = 0;
    this.ultimoTiempoVideo = -1;
    this.raf = 0;
    this.vigia = null;
    this.vista = null;                     // último estado del intérprete (para no repintar de más)
    this.interprete = new InterpreteGestos({
      onDireccion: (mando, dir) => cb.onDireccion(mando, dir),
      onAccesorio: (codigo) => cb.onAccesorio(codigo),
    }, { accesorios: CONFIG.ia.accesorios });
    this.ctx = this.lienzo.getContext("2d");

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.activo) this.pausar("Pausado: la página quedó en segundo plano.");
    });
  }

  configurar(on, disponibles, esActivo) {
    this.interprete.configurar(on, disponibles, esActivo);
    this.escena.classList.toggle("deshabilitado", !on);
    for (const [mando, dirs] of Object.entries(disponibles || {})) {
      this.guia.querySelectorAll(`[data-mando="${mando}"][data-dir]`).forEach((c) => c.classList.toggle("no-disp", !dirs.has(c.dataset.dir)));
    }
  }

  /** DETENER: suelta y no vuelve a mover hasta que se abra la mano. */
  bloquear() { this.interprete.bloquear(); }

  async activar() {
    if (this.activo || this.cargando) return false;
    if (!window.isSecureContext) { this.cb.onEstado("La cámara solo funciona en páginas HTTPS.", "error"); return false; }
    if (!gestosPosibles()) { this.cb.onEstado("Este navegador no permite usar la cámara.", "error"); return false; }
    this.cargando = true;
    this.escena.classList.add("cargando");
    this.cb.onCambio(true);
    try {
      // La cámara se pide primero (dentro del toque del usuario) y el modelo se descarga en paralelo.
      this.cb.onEstado("Pidiendo permiso para la cámara…");
      const modelo = cargarReconocedor((txt) => { if (this.cargando) this._carga(txt); });
      this.flujo = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      });
      this.video.srcObject = this.flujo;
      await this.video.play();
      this._carga("Descargando la IA (solo la primera vez, ~20 MB)…");
      this.reconocedor = await modelo;
      if (!this.cargando) return false;            // se pausó mientras cargaba
    } catch (e) {
      const txt = e?.name === "NotAllowedError" ? "Permiso de cámara denegado. Actívalo en los ajustes del navegador."
        : e?.name === "NotFoundError" ? "No se encontró ninguna cámara en este dispositivo."
        : e?.name === "NotReadableError" ? "La cámara está ocupada por otra aplicación."
        : "No se pudo iniciar el modo IA: " + (e?.message || "error desconocido");
      this._apagarCamara();
      this.cargando = false;
      this.escena.classList.remove("cargando");
      this._carga("");
      this.cb.onCambio(false);
      this.cb.onEstado(txt, "error");
      return false;
    }
    this.cargando = false;
    this.escena.classList.remove("cargando");
    this._carga("");
    this.activo = true;
    this.interprete.reiniciar();
    this.interprete.bloquear();                    // empieza en neutral: abre la mano para comenzar
    this.ultimoCuadro = performance.now();
    this.atascado = false;
    this.escena.classList.add("activo");
    this.cb.onEstado("Muestra la mano abierta ✋ y luego cierra el puño ✊ para conducir.");
    this.raf = requestAnimationFrame((t) => this._bucle(t));
    clearInterval(this.vigia);
    this.vigia = setInterval(() => this._vigilar(), 250);
    return true;
  }

  pausar(motivo = "Modo IA en pausa.") {
    const estaba = this.activo || this.cargando;
    this.activo = false;
    this.cargando = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.vigia);
    this.vigia = null;
    this.interprete.bloquear();
    this._apagarCamara();
    this.escena.classList.remove("activo", "cargando");
    this._carga("");
    this._pintar(null, null);
    if (estaba) { this.cb.onCambio(false); this.cb.onEstado(motivo); }
  }

  _apagarCamara() {
    this.flujo?.getTracks().forEach((t) => t.stop());
    this.flujo = null;
    this.video.srcObject = null;
  }

  _carga(txt) {
    this.carga.textContent = txt;
    this.carga.hidden = !txt;
  }

  _vigilar() {
    if (!this.activo) return;
    const atascado = performance.now() - this.ultimoCuadro > VIGIA_MS;
    if (atascado && !this.atascado) {
      this.interprete.bloquear();                 // suelta ya (DETENER) y espera la mano abierta
      this._pintar(null, null);
      this.cb.onEstado("La cámara dejó de enviar imagen: carrito detenido.", "error");
    } else if (!atascado && this.atascado) {
      this.cb.onEstado("Imagen de nuevo en línea: abre la mano ✋ para seguir.");
    }
    this.atascado = atascado;
  }

  _bucle(t) {
    if (!this.activo) return;
    this.raf = requestAnimationFrame((x) => this._bucle(x));
    if (t - this.ultimoAnalisis < 1000 / CONFIG.ia.fps - 4) return;
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.ultimoTiempoVideo) return;     // sin cuadro nuevo
    this.ultimoAnalisis = t;
    this.ultimoTiempoVideo = v.currentTime;
    let res;
    try { res = this.reconocedor.recognizeForVideo(v, t); }
    catch (e) { this.pausar("Error del reconocedor: " + (e?.message || e)); return; }
    this.ultimoCuadro = performance.now();

    const w = v.videoWidth, h = v.videoHeight;
    const puntos = res.landmarks?.[0];
    let cuadro = null;
    if (puntos?.length === 21) {
      const g = res.gestures?.[0]?.[0];
      // Centro de la palma en píxeles; x en el sentido del usuario (la imagen se muestra en espejo).
      const cx = PALMA.reduce((s, i) => s + puntos[i].x, 0) / PALMA.length;
      const cy = PALMA.reduce((s, i) => s + puntos[i].y, 0) / PALMA.length;
      const escala = Math.hypot((puntos[0].x - puntos[9].x) * w, (puntos[0].y - puntos[9].y) * h);
      cuadro = { forma: g?.categoryName || FORMA.ninguna, confianza: g?.score ?? 0, x: (1 - cx) * w, y: cy * h, escala };
    }
    const r = this.interprete.procesar(cuadro, t);
    this._pintar(r, puntos, w, h, cuadro);
  }

  /** Dibuja la mano y actualiza etiqueta, guía y anillo de progreso. */
  _pintar(r, puntos, w = 0, h = 0, cuadro = null) {
    const c = this.lienzo, ctx = this.ctx;
    if (w && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    ctx.clearRect(0, 0, c.width, c.height);
    if (puntos && w) {
      const color = r?.mando === "conduccion" ? "#46d3ff" : r?.mando === "brazo" ? "#ffb02e" : "#9fb2ee";
      // El lienzo está en espejo por CSS, igual que el video: se dibuja en coordenadas de la imagen.
      ctx.lineWidth = Math.max(2, w / 220);
      ctx.strokeStyle = color + "cc";
      ctx.beginPath();
      for (const [a, b] of HUESOS) { ctx.moveTo(puntos[a].x * w, puntos[a].y * h); ctx.lineTo(puntos[b].x * w, puntos[b].y * h); }
      ctx.stroke();
      ctx.fillStyle = color;
      for (const p of puntos) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, Math.max(2.5, w / 160), 0, 7); ctx.fill(); }

      // Joystick en el aire: zona neutral alrededor del centro y línea hasta la mano.
      const o = this.interprete.origen;
      if (r?.mando && o) {
        const ox = w - o.x, oy = o.y;                      // de vuelta a coordenadas de la imagen
        ctx.lineWidth = Math.max(2, w / 260);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "#ffffff88";
        ctx.beginPath(); ctx.arc(ox, oy, o.escala * AJUSTES.ENTRAR, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
        if (cuadro) {
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(3, w / 160);
          ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(w - cuadro.x, cuadro.y); ctx.stroke();
        }
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(ox, oy, Math.max(4, w / 110), 0, 7); ctx.fill();
      }
    }

    // Etiqueta, flechas y guía: solo si algo cambió.
    const clave = r ? `${r.forma}|${r.mando}|${r.dir}|${r.trabado}|${r.progreso?.codigo}` : "";
    const progreso = r?.progreso;
    this.escena.style.setProperty("--ia-progreso", progreso ? String(progreso.p) : "0");
    this.escena.classList.toggle("sosteniendo", !!progreso);
    if (clave === this.vista) return;
    this.vista = clave;
    if (r && this.activo && this.trabadoAntes && !r.trabado) {
      this.cb.onEstado("Listo: ✊ conduce · ✌️ brazo y pala · ✋ detiene.");
    }
    this.trabadoAntes = !!r?.trabado;

    let txt = "";
    if (r && this.activo) {
      if (r.trabado) txt = "✋ Abre la mano para empezar";
      else if (r.mando) txt = `${r.mando === "conduccion" ? "✊ Conducción" : "✌️ Brazo y pala"} · ${r.dir ? ETIQUETA[r.mando][r.dir] : "neutral"}`;
      else if (progreso) txt = `Sostén… ${NOMBRE_ACC[progreso.codigo] || ""}`;
      else txt = NOMBRE_FORMA[r.forma] || "Buscando la mano…";
    }
    this.etiqueta.textContent = txt;
    this.etiqueta.hidden = !txt;
    this.escena.dataset.mando = r?.mando || "";
    this.escena.querySelectorAll(".ia-flecha").forEach((f) => f.classList.toggle("on", r?.mando === "conduccion" && f.dataset.dir === r.dir));

    this.guia.querySelectorAll(".ia-fila").forEach((f) => f.classList.toggle("on", !!r && f.dataset.forma === r.forma && !r.trabado));
    this.guia.querySelectorAll(".ia-chip").forEach((ch) => ch.classList.toggle("on", !!r && (
      (ch.dataset.mando && ch.dataset.mando === r.mando && ch.dataset.dir === r.dir)
      || (progreso && Number(ch.dataset.codigo) === progreso.codigo))));
  }
}

const ETIQUETA = {
  conduccion: { arriba: "Avanzar", abajo: "Retroceder", izquierda: "Girar izq.", derecha: "Girar der." },
  brazo: { arriba: "Subir brazo", abajo: "Bajar brazo", izquierda: "Pala izq.", derecha: "Pala der." },
};
const NOMBRE_ACC = { 10: "Luz", 11: "Sonido", 12: "Encender/Apagar" };
