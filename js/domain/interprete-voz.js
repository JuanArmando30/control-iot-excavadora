/**
 * Convierte una frase en una intención. No envía nada: la página valida el
 * código contra el catálogo y usa el mismo ComandoService que los botones.
 * Los códigos son los del catálogo actual del vehículo 1 (control anterior).
 */
import { CONFIG } from "../config.js";

const D = CONFIG.direcciones;

const RX = {
  stop: /\b(alto|stop|deten|detente|detener|parar|pare|frena|frenar|basta|emergencia)\b/,
  cancelar: /\b(cancela|cancelar|aborta|abortar)\b/,
  demo: /\b(demo|demostracion)\b/,
  luz: /\b(luz|luces|faro|faros)\b/,
  sonido: /\b(sonido|claxon|bocina|pito)\b/,
  encendido: /\b(enciende|encender|prende|prender|apaga|apagar)\b/,
  pala: /\b(pala|garra)\b/,
  izquierda: /\b(izquierda|izquierdo)\b/,
  derecha: /\b(derecha)\b/,          // "derecho" en México suele significar "recto"
};

const MOVIMIENTOS = [
  [D.arriba, /\b(avanza|avanzar|adelante|frente|recto)\b/],
  [D.abajo, /\b(retrocede|retroceder|atras|reversa)\b/],
  [D.izquierda, RX.izquierda],
  [D.derecha, RX.derecha],
  [5, /\b(sube|subir|levanta|levantar|alza|arriba|eleva)\b/],
  [6, /\b(baja|bajar|abajo|desciende)\b/],
];

export const FRASES_EJEMPLO = [
  "avanza", "atrás", "izquierda", "derecha", "sube el brazo", "baja el brazo",
  "pala a la izquierda", "pala a la derecha", "luz", "sonido", "inicia la demo", "alto",
];

export function normalizar(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export const esParo = (texto) => RX.stop.test(normalizar(texto));

/** @returns {{tipo:"stop"|"cancelar"|"demo"}|{tipo:"mov", codigo:number}|null} */
export function interpretar(texto) {
  const t = normalizar(texto);
  if (!t) return null;
  if (RX.stop.test(t)) return { tipo: "stop" };              // "alto" gana siempre
  if (RX.cancelar.test(t)) return { tipo: "cancelar" };
  if (RX.demo.test(t)) return { tipo: "demo" };
  if (RX.luz.test(t)) return { tipo: "mov", codigo: 10 };
  if (RX.sonido.test(t)) return { tipo: "mov", codigo: 11 };
  if (RX.encendido.test(t)) return { tipo: "mov", codigo: 12 };
  if (RX.pala.test(t)) {
    const iz = RX.izquierda.exec(t), de = RX.derecha.exec(t);
    if (iz && (!de || iz.index < de.index)) return { tipo: "mov", codigo: 7 };
    if (de) return { tipo: "mov", codigo: 8 };
  }
  let mejor = null, pos = Infinity;
  for (const [codigo, rx] of MOVIMIENTOS) {                    // gana la primera palabra dicha
    const m = rx.exec(t);
    if (m && m.index < pos) { pos = m.index; mejor = codigo; }
  }
  return mejor != null ? { tipo: "mov", codigo: mejor } : null;
}
