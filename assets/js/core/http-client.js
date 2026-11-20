/**
 * Cliente HTTP único: URL base, métodos permitidos, cabeceras, timeout,
 * parseo JSON y traducción de errores a mensajes comprensibles.
 */

export class ApiError extends Error {
  /**
   * @param {string} mensaje Texto seguro para mostrar al usuario.
   * @param {{status?: number, tipo?: string, detalle?: string}} info
   */
  constructor(mensaje, { status = 0, tipo = "HTTP", detalle = "" } = {}) {
    super(mensaje);
    this.name = "ApiError";
    this.status = status;
    this.tipo = tipo;        // RED | TIMEOUT | CANCELADO | HTTP | SIN_CLAVE | SIN_SESION | RESPUESTA
    this.detalle = detalle;
  }
}

const METODOS = new Set(["GET", "POST"]);
const MAX_DETALLE = 220;

function recortar(texto) {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  return t.length > MAX_DETALLE ? t.slice(0, MAX_DETALLE) + "…" : t;
}

/** FastAPI devuelve {"detail": "texto"} o, en 422, {"detail": [{msg, loc}]}. */
function extraerDetalle(data) {
  if (!data || typeof data !== "object") return "";
  const d = data.detail;
  if (typeof d === "string") return recortar(d);
  if (Array.isArray(d) && d.length && d[0] && typeof d[0].msg === "string") {
    const campo = Array.isArray(d[0].loc) ? d[0].loc.filter((x) => x !== "body").join(".") : "";
    return recortar((campo ? campo + ": " : "") + d[0].msg);
  }
  return "";
}

function mensajePorEstado(status, detalle) {
  switch (status) {
    case 400: return detalle || "La solicitud no es válida.";
    case 401: return detalle || "Sin sesión válida o clave X-API-Key incorrecta.";
    case 403: return detalle || "No tienes permiso para esta acción.";
    case 404: return detalle || "El recurso no existe.";
    case 409: return detalle || "La operación entra en conflicto con el estado actual.";
    case 422: return detalle ? "Datos no válidos · " + detalle : "Datos no válidos.";
    case 429: return detalle || "Demasiados intentos. Espera un momento y vuelve a probar.";
    case 503: return detalle || "Amazon RDS no está disponible en este momento.";
    default:
      if (status >= 500) return "Error interno del servidor.";
      return detalle || `Respuesta inesperada (HTTP ${status}).`;
  }
}

/** Une la señal externa (opcional) con la del timeout sin depender de AbortSignal.any. */
function crearSenal(timeoutMs, externa) {
  const ctrl = new AbortController();
  let porTimeout = false;
  const t = setTimeout(() => { porTimeout = true; ctrl.abort(); }, timeoutMs);
  const alAbortar = () => ctrl.abort();
  if (externa) {
    if (externa.aborted) ctrl.abort();
    else externa.addEventListener("abort", alAbortar, { once: true });
  }
  return {
    signal: ctrl.signal,
    fueTimeout: () => porTimeout,
    limpiar: () => { clearTimeout(t); externa?.removeEventListener("abort", alAbortar); },
  };
}

export class HttpClient {
  /**
   * @param {{baseUrl: string, timeoutMs: number, obtenerClave: () => string, controlSinClave?: () => boolean,
   *          sesion?: {token: () => string, recuperable: () => boolean, renovar: () => Promise<any>}}} opciones
   */
  constructor({ baseUrl, timeoutMs, obtenerClave, controlSinClave, sesion }) {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:" && location.protocol === "https:") {
      // Una página HTTPS no puede llamar a HTTP (mixed content).
      throw new Error("La URL base de la API debe usar HTTPS.");
    }
    this.base = base;
    this.timeoutMs = timeoutMs;
    this.obtenerClave = obtenerClave;
    this.controlSinClave = controlSinClave;
    this.sesion = sesion;
  }

  /** Token de acceso vigente; si caducó pero hay token de renovación, lo renueva antes. */
  async tokenVigente() {
    if (!this.sesion) return "";
    let t = this.sesion.token();
    if (!t && this.sesion.recuperable()) {
      try { await this.sesion.renovar(); } catch { return ""; }
      t = this.sesion.token();
    }
    return t;
  }

  /**
   * @param {string} ruta Ruta absoluta del backend, p. ej. "/vehiculos/1/comandos".
   * @param {{method?: string, body?: object, auth?: boolean|"control"|"sesion", signal?: AbortSignal, timeoutMs?: number}} op
   *   auth:
   *   - false: sin credenciales.
   *   - "sesion": token Bearer obligatorio (rutas /auth, /mis-vehiculos, /admin).
   *     En /admin, si no hay sesión pero sí clave, se usa la clave (transición).
   *   - true: clave X-API-Key; si no hay clave, el token de un administrador (Etapa 5).
   *   - "control": clave, o nada si el backend tiene el control abierto (sin token:
   *     Control y Monitoreo no cambian en esta etapa).
   */
  async request(ruta, op = {}) {
    const { auth = false, _reintento = false } = op;
    const usaToken = { valor: false };
    try {
      return await this.enviar(ruta, op, usaToken);
    } catch (e) {
      // Token vencido o revocado en el servidor: se renueva UNA vez y se repite la petición.
      if (e.status === 401 && usaToken.valor && !_reintento && this.sesion?.recuperable()) {
        try { await this.sesion.renovar(); } catch { throw e; }
        return this.request(ruta, { ...op, _reintento: true });
      }
      if (e.status === 401 && auth === "sesion" && !usaToken.valor && !this.obtenerClave()) {
        throw new ApiError("Inicia sesión para continuar.", { status: 401, tipo: "SIN_SESION" });
      }
      throw e;
    }
  }

  async enviar(ruta, { method = "GET", body, auth = false, clave: claveExplicita, signal, timeoutMs, permitirClave = false, invitado } = {}, usaToken = {}) {
    if (!METODOS.has(method)) throw new ApiError("Método HTTP no permitido.", { tipo: "CLIENTE" });
    if (typeof ruta !== "string" || !ruta.startsWith("/")) {
      throw new ApiError("Ruta de API inválida.", { tipo: "CLIENTE" });
    }

    const url = new URL(ruta, this.base);
    if (url.origin !== this.base.origin) throw new ApiError("Destino no permitido.", { tipo: "CLIENTE" });

    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // Invitado (Etapa 7): token de la reserva (solo de esta pestaña), en su propia cabecera.
    if (invitado) headers["X-Invitado"] = invitado;
    // Lecturas sin credencial explícita: si hay sesión se identifica (con LECTURA_ABIERTA=false el
    // servidor lo exige; con true no cambia nada). Nunca para el invitado ni el inicio de sesión.
    if (!auth && !invitado && method === "GET" && this.sesion?.token?.()) {
      headers.Authorization = `Bearer ${this.sesion.token()}`;
      usaToken.valor = true;
    }
    if (auth === "sesion") {
      const token = await this.tokenVigente();
      const clave = permitirClave ? this.obtenerClave() : "";
      if (token) { headers.Authorization = `Bearer ${token}`; usaToken.valor = true; }
      else if (clave) headers["X-API-Key"] = clave;
      else throw new ApiError("Inicia sesión para continuar.", { status: 401, tipo: "SIN_SESION" });
    } else if (auth) {
      const clave = claveExplicita ?? this.obtenerClave();
      // auth "control": sin clave se permite si el backend tiene el control abierto (lo decide el backend).
      const sinClaveValido = auth === "control" && this.controlSinClave?.();
      // Con sesión manda el token: el servidor decide por unidad y queda auditado quién fue.
      // Sin sesión: la clave (transición) o, en control, nada si el backend tiene el control abierto.
      const token = !claveExplicita ? await this.tokenVigente() : "";
      if (token) { headers.Authorization = `Bearer ${token}`; usaToken.valor = true; }
      else if (clave) headers["X-API-Key"] = clave;
      else if (!sinClaveValido) {
        throw new ApiError("Inicia sesión como administrador o escribe la clave X-API-Key.", { status: 401, tipo: "SIN_CLAVE" });
      }
    }

    const senal = crearSenal(timeoutMs ?? this.timeoutMs, signal);
    let resp;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        mode: "cors",
        credentials: "omit",          // la API no usa cookies
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: senal.signal,
      });
    } catch (e) {
      if (senal.fueTimeout()) {
        throw new ApiError("La API no respondió a tiempo.", { tipo: "TIMEOUT" });
      }
      if (e?.name === "AbortError") throw new ApiError("Solicitud cancelada.", { tipo: "CANCELADO" });
      // El navegador no distingue "sin red" de "bloqueado por CORS".
      throw new ApiError("Sin respuesta de la API (red caída, servidor apagado o CORS no autorizado).", { tipo: "RED" });
    } finally {
      senal.limpiar();
    }

    let data = null;
    const tipo = resp.headers.get("content-type") || "";
    if (tipo.includes("application/json")) {
      try { data = await resp.json(); } catch { data = null; }
    }

    if (!resp.ok) {
      const detalle = extraerDetalle(data);
      throw new ApiError(mensajePorEstado(resp.status, detalle), { status: resp.status, tipo: "HTTP", detalle });
    }
    return { status: resp.status, data };
  }

  get(ruta, op = {}) { return this.request(ruta, { ...op, method: "GET" }); }
  post(ruta, body, op = {}) { return this.request(ruta, { ...op, method: "POST", body }); }
}
