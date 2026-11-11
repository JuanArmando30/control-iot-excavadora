/**
 * Convierte una frase hablada (o escrita) en una intención. No envía nada:
 * la página valida cada código contra el catálogo y usa el mismo
 * ComandoService que los botones.
 *
 * Cómo entiende "más o menos" lo que se le pide, sin IA ni servicios externos:
 *  1. Normaliza (minúsculas, sin acentos ni signos) y separa en palabras.
 *  2. Cada palabra se busca en un vocabulario amplio de conceptos
 *     (adelante, atrás, izquierda, brazo, pala, luz...). Si no está tal cual,
 *     se le quitan pronombres pegados ("bájale" → "baja", "levántala" →
 *     "levanta") y, si aún no aparece, se acepta una palabra PARECIDA
 *     (errores del reconocedor: "abanza" → "avanza", "isquierda" → "izquierda").
 *  3. La frase se divide en partes con "y", "luego", "después"... y cada parte
 *     se convierte en un comando. Una parte que solo dice una dirección hereda
 *     el sujeto de la anterior ("gira la pala a la izquierda y luego a la derecha").
 *  4. Correcciones ("no, mejor a la izquierda"), repeticiones ("avanza dos
 *     veces") y negaciones ("no avances" no hace nada).
 *
 * Seguridad: las palabras de paro ("alto", "detente", "frena"...) se comparan
 * EXACTAS (nunca por parecido) y ganan siempre sobre cualquier otra orden.
 */
import { CONFIG } from "../config.js";

const D = CONFIG.direcciones;
const B = CONFIG.brazo;
const A = CONFIG.voz;

/* ----------------------------- Vocabulario ----------------------------- */
const VOCAB = {
  adelante: ["avanza", "avanzar", "avance", "avances", "avanzo", "adelante", "delante", "adelanta", "adelantate", "enfrente",
    "frente", "recto", "camina", "caminar", "camine", "sigue", "seguir", "siga", "acelera", "acelerar", "mueve",
    "muevete", "palante", "padelante", "dale", "anda", "vamos", "vete", "marcha"],
  atras: ["atras", "detras", "retrocede", "retroceder", "retroceda", "retrocedas", "reversa", "regresa", "regresar", "regrese",
    "regresate", "recula", "recular", "patras", "echate"],
  izquierda: ["izquierda", "izquierdo", "izq"],
  derecha: ["derecha"],
  derecho: ["derecho"],                      // "sigue derecho" = recto; "lado derecho" = derecha
  lado: ["lado"],
  giro: ["gira", "girar", "gire", "gires", "giro", "voltea", "voltear", "voltee", "dobla", "doblar", "rota", "rotar", "vira",
    "virar", "vuelta"],
  subir: ["sube", "subir", "suba", "subas", "levanta", "levantar", "levante", "alza", "alzar", "eleva", "elevar", "arriba"],
  bajar: ["baja", "bajar", "baje", "bajes", "desciende", "descender", "abajo", "agacha", "agachar"],
  brazo: ["brazo", "pluma", "boom"],
  pala: ["pala", "palas", "bala", "cuchara", "cucharon", "garra", "balde", "cubeta", "bote"],
  luz: ["luz", "luces", "faro", "faros", "lampara", "lamparas", "foco", "focos", "ilumina", "iluminar", "alumbra",
    "alumbrar"],
  sonido: ["sonido", "claxon", "clacson", "bocina", "pito", "pita", "pitar", "suena", "sonar", "toca", "tocar",
    "alarma", "sirena"],
  encender: ["enciende", "encender", "encienda", "prende", "prender", "prenda", "prendas", "apaga", "apagar", "apague", "apagues",
    "arranca", "arrancar", "motor", "encendido", "apagado"],
};

/** Paro: solo coincidencia EXACTA (una palabra parecida nunca detiene ni deja de detener por error). */
const PARO = new Set(["alto", "stop", "detente", "deten", "detener", "detenga", "detengase", "frena", "frenar",
  "frene", "frenale", "basta", "emergencia", "quieto", "quieta", "parate", "parale", "parar", "pare", "paren"]);
const PARO_FRASES = [/\bno te muevas\b/, /\bpara (ya|todo)\b/, /\bya para\b/, /^para$/];

const RX_CANCELAR = /\b(cancela|cancelar|aborta|abortar)\b/;
const RX_DEMO = /\b(demo|demostracion|rutina)\b/;
const RX_REPETIR = /^(otra vez|otra|de nuevo|repite|repitelo|repetir|igual|lo mismo)$/;
const RX_CORRECCION = /\b(mejor|perdon|digo|corrijo)\b/g;
const RX_SEPARADOR = /\b(?:y luego|y despues|y entonces|y ahora|luego|despues|entonces|tambien|ademas|y)\b/;

const NUMEROS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
/** Conceptos que son una ACCIÓN: "no" delante de ellos la niega ("no avances", "no prendas la luz"). */
const ACCIONES = new Set(["adelante", "atras", "giro", "subir", "bajar", "encender"]);

/* ------------------------- Índice y parecido --------------------------- */
const INDICE = new Map();
for (const [concepto, palabras] of Object.entries(VOCAB)) for (const p of palabras) INDICE.set(p, concepto);
const PALABRAS = [...INDICE.keys()];

/** Distancia de edición con salida temprana si supera `max`. */
function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < minFila) minFila = cur[j];
    }
    if (minFila > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Quita pronombres pegados: bájale → baja, levántala → levanta, regrésate → regresa. */
function sinEnclitico(p) {
  const m = /^(.{3,}?)(le|les|la|las|lo|los|te|me)$/.exec(p);
  return m ? m[1] : null;
}

/** Concepto de una palabra: exacta → sin enclítico → parecida (solo palabras de 5+ letras). */
function concepto(p) {
  if (INDICE.has(p)) return INDICE.get(p);
  const base = sinEnclitico(p);
  if (base && INDICE.has(base)) return INDICE.get(base);
  for (const cand of [p, base]) {
    if (!cand || cand.length < 5) continue;
    const max = cand.length >= 8 ? 2 : 1;
    let mejor = null, dMin = max + 1, empate = false;
    for (const w of PALABRAS) {
      if (w.length < 4) continue;
      const d = distancia(cand, w, max);
      if (d < dMin) { dMin = d; mejor = w; empate = false; }
      else if (d === dMin && INDICE.get(w) !== INDICE.get(mejor)) empate = true;
    }
    if (mejor && dMin <= max && !empate) return INDICE.get(mejor);
  }
  return null;
}

/* ------------------------------ Público ------------------------------- */
export const FRASES_EJEMPLO = [
  "avanza", "regresa", "voltea a la izquierda", "dale a la derecha", "sube el brazo", "bájale a la pala",
  "gira la pala a la izquierda", "prende la luz", "toca el claxon", "enciende el motor",
  "avanza y luego gira a la derecha", "avanza dos veces", "alto",
];

export function normalizar(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\bpa'?\s?(tras|atras)\b/g, "patras").replace(/\bpa'?\s?(delante|adelante)\b/g, "padelante")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** ¿La frase pide detener? Solo palabras exactas: sirve también con resultados parciales. */
export function esParo(texto) {
  const t = normalizar(texto);
  if (!t) return false;
  if (PARO_FRASES.some((rx) => rx.test(t))) return true;
  return t.split(" ").some((p) => PARO.has(p) || PARO.has(sinEnclitico(p) || ""));
}

/** El reconocedor a veces parte una palabra: "retro sede" → "retrosede" (→ retrocede). */
function unirPartidas(palabras) {
  const out = [];
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i], q = palabras[i + 1];
    if (q && !concepto(p) && !concepto(q) && concepto(p + q)) { out.push(p + q); i++; }
    else out.push(p);
  }
  return out;
}

/** Convierte una parte de la frase en {codigo, veces} o null. */
function resolverParte(texto, ctx) {
  let palabras = unirPartidas(texto.split(" ").filter(Boolean));
  if (!palabras.length) return { vacia: true };
  if (palabras[0] === "no") {
    const sig = ["lo", "la", "le", "los", "las", "te", "se"].includes(palabras[1]) ? palabras[2] : palabras[1];
    if (sig && ACCIONES.has(concepto(sig))) return { negada: true };
    palabras = palabras.slice(1);                       // "no, a la izquierda" → corrección
  }

  let veces = 1;
  const pos = new Map();
  palabras.forEach((p, i) => {
    if ((p === "veces" || p === "vez") && i > 0) {
      const n = NUMEROS[palabras[i - 1]] ?? Number(palabras[i - 1]);
      if (n >= 1) veces = Math.min(n, A.maxPasos);
      return;
    }
    const c = concepto(p);
    if (c && !pos.has(c)) pos.set(c, i);
  });
  const tiene = (c) => pos.has(c);
  if (!pos.size) return null;

  // Accesorios: el sustantivo manda sobre el verbo ("prende la luz" es LUZ, no encender).
  if (tiene("luz")) return { codigo: A.luz, veces };
  if (tiene("sonido")) return { codigo: A.sonido, veces };
  if (tiene("encender")) return { codigo: A.encender, veces };

  const derechaLado = tiene("derecho") && tiene("lado");
  const izq = tiene("izquierda"), der = tiene("derecha") || derechaLado;
  const lateral = izq && der ? (pos.get("izquierda") < (pos.get("derecha") ?? pos.get("derecho")) ? "izq" : "der")
    : izq ? "izq" : der ? "der" : null;
  const vertical = tiene("subir") && tiene("bajar") ? (pos.get("subir") < pos.get("bajar") ? "sube" : "baja")
    : tiene("subir") ? "sube" : tiene("bajar") ? "baja" : null;
  const avance = tiene("atras") ? "atras" : (tiene("adelante") || (tiene("derecho") && !derechaLado)) ? "adelante" : null;

  // ¿A qué se refiere? pala, brazo o el vehículo. Una parte sin sujeto ni verbo propio lo hereda.
  let sujeto = tiene("pala") ? "pala" : tiene("brazo") ? "brazo" : null;
  if (!sujeto && !avance && !tiene("giro") && ctx.sujeto && (lateral || vertical)) sujeto = ctx.sujeto;
  if (!sujeto && vertical && !avance) sujeto = "brazo";            // "sube" a secas = subir brazo
  ctx.sujeto = sujeto || "vehiculo";

  if (sujeto === "pala") {
    if (lateral) return { codigo: lateral === "izq" ? B.izquierda : B.derecha, veces };
    if (vertical) return { codigo: vertical === "sube" ? B.arriba : B.abajo, veces };
    return null;                                                     // "mueve la pala" sin dirección
  }
  if (sujeto === "brazo") {
    if (vertical) return { codigo: vertical === "sube" ? B.arriba : B.abajo, veces };
    return null;
  }
  if (lateral) return { codigo: lateral === "izq" ? D.izquierda : D.derecha, veces };
  if (avance) return { codigo: avance === "atras" ? D.abajo : D.arriba, veces };
  return null;
}

/**
 * @returns {{tipo:"stop"|"cancelar"|"demo"|"repetir"}
 *   | {tipo:"secuencia", pasos:number[], partes:{texto:string, codigo:number|null, veces?:number, negada?:boolean}[]}
 *   | null}
 *   `pasos` ya viene expandido (repeticiones) y limitado a CONFIG.voz.maxPasos.
 */
export function interpretar(texto) {
  let t = normalizar(texto);
  if (!t) return null;
  if (esParo(t)) return { tipo: "stop" };                          // "alto" gana siempre
  if (RX_CANCELAR.test(t)) return { tipo: "cancelar" };
  if (RX_DEMO.test(t)) return { tipo: "demo" };
  if (RX_REPETIR.test(t)) return { tipo: "repetir" };

  // Corrección: se queda con lo dicho después del último "mejor / perdón / digo".
  const marcas = [...t.matchAll(RX_CORRECCION)];
  if (marcas.length) {
    const ultima = marcas[marcas.length - 1];
    const resto = t.slice(ultima.index + ultima[0].length).trim();
    if (resto) t = resto;
  }

  const ctx = { sujeto: null };
  const partes = [];
  const pasos = [];
  for (const trozo of t.split(RX_SEPARADOR).map((s) => s.trim()).filter(Boolean)) {
    const r = resolverParte(trozo, ctx);
    if (r?.vacia) continue;
    partes.push({ texto: trozo, codigo: r?.codigo ?? null, veces: r?.veces, negada: !!r?.negada });
    if (r?.codigo != null) for (let i = 0; i < r.veces && pasos.length < A.maxPasos; i++) pasos.push(r.codigo);
  }
  if (!partes.length) return null;
  return { tipo: "secuencia", pasos, partes };
}
