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
    this.tipo = tipo;        // RED | TIMEOUT | CANCELADO | HTTP | SIN_CLAVE | RESPUESTA
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
    case 401: return "Clave X-API-Key faltante o incorrecta.";
    case 403: return "La clave no tiene permiso para esta acción (requiere administrador).";
    case 404: return detalle || "El recurso no existe.";
    case 409: return detalle || "La operación entra en conflicto con el estado actual.";
    case 422: return detalle ? "Datos no válidos · " + detalle : "Datos no válidos.";
    case 503: return "Amazon RDS no está disponible en este momento.";
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
   * @param {{baseUrl: string, timeoutMs: number, obtenerClave: () => string}} opciones
   */
  constructor({ baseUrl, timeoutMs, obtenerClave }) {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:" && location.protocol === "https:") {
      // Una página HTTPS no puede llamar a HTTP (mixed content).
      throw new Error("La URL base de la API debe usar HTTPS.");
    }
    this.base = base;
    this.timeoutMs = timeoutMs;
    this.obtenerClave = obtenerClave;
  }

  /**
   * @param {string} ruta Ruta absoluta del backend, p. ej. "/vehiculos/1/comandos".
   * @param {{method?: string, body?: object, auth?: boolean, signal?: AbortSignal, timeoutMs?: number}} op
   */
  async request(ruta, { method = "GET", body, auth = false, clave: claveExplicita, signal, timeoutMs } = {}) {
    if (!METODOS.has(method)) throw new ApiError("Método HTTP no permitido.", { tipo: "CLIENTE" });
    if (typeof ruta !== "string" || !ruta.startsWith("/")) {
      throw new ApiError("Ruta de API inválida.", { tipo: "CLIENTE" });
    }

    const url = new URL(ruta, this.base);
    if (url.origin !== this.base.origin) throw new ApiError("Destino no permitido.", { tipo: "CLIENTE" });

    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const clave = claveExplicita ?? this.obtenerClave();
      if (!clave) throw new ApiError("Falta la clave de operador (X-API-Key).", { status: 401, tipo: "SIN_CLAVE" });
      headers["X-API-Key"] = clave;
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
