/**
 * Editor de pasos de una DEMO (Etapa 6). Lo usan el comprador (sus DEMO
 * privadas) y la empresa (DEMO de fábrica).
 *
 * - Agregar, quitar, editar y reordenar (↑ ↓) pasos; todo con teclado.
 * - Valida mientras se escribe contra los LÍMITES DEL MODELO y muestra los
 *   totales. El servidor vuelve a validar al guardar y al iniciar.
 * - Guarda TODA la secuencia de una vez (el orden es el de la lista).
 */
import { abrirModal } from "./modales.js";
import { el, icono } from "./dom.js";

const seg = (ms) => `${(ms / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} s`;

/**
 * @param {{titulo:string, comandos:Array<{id_comando:number,nombre:string,codigo:number,activo:boolean}>,
 *          limites:{max_paso_ms:number,max_pasos_demo:number,max_demo_ms:number},
 *          movimientos:Array<{id_comando:number,duracion_ms:number,pausa_ms:number}>,
 *          soloLectura?:boolean, nota?:string, guardar?:(pasos:Array)=>Promise<void>}} op
 */
export function abrirEditorDemo({ titulo, comandos, limites, movimientos, soloLectura = false, nota, guardar }) {
  const activos = comandos.filter((c) => c.activo);
  const nombre = new Map(comandos.map((c) => [c.id_comando, `${c.nombre} (#${c.codigo})`]));
  let pasos = movimientos.map((m) => ({ id_comando: m.id_comando, duracion_ms: m.duracion_ms, pausa_ms: m.pausa_ms ?? 0 }));
  const original = JSON.stringify(pasos);
  const max = limites.max_paso_ms;

  const lista = el("ol", { class: "editor-pasos", attrs: { "aria-label": "Pasos de la DEMO" } });
  const resumen = el("p", { class: "editor-resumen", attrs: { "aria-live": "polite" } });
  const agregar = el("button", { class: "btn btn-sm btn-outline-primary", attrs: { type: "button" } },
    [icono("i-plus"), el("span", { text: " Agregar paso" })]);
  let botonGuardar = null;

  const valido = (p) => activos.some((c) => c.id_comando === p.id_comando)
    && Number.isInteger(p.duracion_ms) && p.duracion_ms >= 1 && p.duracion_ms <= max
    && Number.isInteger(p.pausa_ms) && p.pausa_ms >= 0 && p.pausa_ms <= max;

  function estado() {
    const total = pasos.reduce((s, p) => s + (p.duracion_ms || 0) + (p.pausa_ms || 0), 0);
    const problemas = [];
    if (pasos.length > limites.max_pasos_demo) problemas.push(`máximo ${limites.max_pasos_demo} pasos`);
    if (total > limites.max_demo_ms) problemas.push(`la DEMO no puede durar más de ${seg(limites.max_demo_ms)}`);
    if (pasos.some((p) => !valido(p))) problemas.push(`cada paso dura de 1 a ${max} ms y pausa de 0 a ${max} ms`);
    return { total, problemas, cambiado: JSON.stringify(pasos) !== original };
  }

  function pintarResumen() {
    const e = estado();
    // (replaceChildren convertiría un null en el texto «null»: solo se pasan nodos)
    resumen.replaceChildren(...[
      el("span", { text: `${pasos.length} / ${limites.max_pasos_demo} pasos · ${seg(e.total)} / ${seg(limites.max_demo_ms)}` }),
      e.problemas.length ? el("span", { class: "editor-error", text: ` · Corrige: ${e.problemas.join("; ")}.` }) : null,
    ].filter(Boolean));
    resumen.classList.toggle("mal", e.problemas.length > 0);
    agregar.disabled = soloLectura || pasos.length >= limites.max_pasos_demo || !activos.length;
    if (botonGuardar) botonGuardar.disabled = !e.cambiado || e.problemas.length > 0;
  }

  function numero(valor) {
    const n = Number.parseInt(valor, 10);
    return Number.isNaN(n) ? null : n;
  }

  function fila(p, i) {
    const etq = `Paso ${i + 1}`;
    if (soloLectura) {
      return el("li", { class: "editor-paso" }, [
        el("span", { class: "editor-num", text: i + 1 }),
        el("span", { class: "editor-cmd", text: nombre.get(p.id_comando) || `Comando ${p.id_comando}` }),
        el("span", { class: "editor-ms", text: `${p.duracion_ms} ms${p.pausa_ms ? ` + pausa ${p.pausa_ms} ms` : ""}` }),
      ]);
    }
    const sel = el("select", { class: "form-select form-select-sm", attrs: { "aria-label": `${etq}: comando` },
      on: { change: (e) => { p.id_comando = numero(e.target.value); revisar(); } } },
    [...(activos.some((c) => c.id_comando === p.id_comando) ? [] : [el("option", { text: "— elige un comando —", attrs: { value: "" } })]),
      ...activos.map((c) => el("option", { text: `${c.nombre} (#${c.codigo})`, attrs: { value: c.id_comando, selected: c.id_comando === p.id_comando } }))]);
    const entrada = (campo, etiqueta, minimo) => el("input", {
      class: "form-control form-control-sm", attrs: {
        // step 1: con min=1 y step=100 el navegador solo aceptaría 1, 101, 201… y bloquearía el envío.
        type: "number", inputmode: "numeric", min: minimo, max, step: 1, value: p[campo], "aria-label": `${etq}: ${etiqueta} en milisegundos`,
      },
      on: { input: (e) => { p[campo] = numero(e.target.value); revisar(); } },
    });
    const dur = entrada("duracion_ms", "duración", 1);
    const pau = entrada("pausa_ms", "pausa", 0);
    function revisar() {
      sel.classList.toggle("is-invalid", !activos.some((c) => c.id_comando === p.id_comando));
      dur.classList.toggle("is-invalid", !(p.duracion_ms >= 1 && p.duracion_ms <= max));
      pau.classList.toggle("is-invalid", !(p.pausa_ms >= 0 && p.pausa_ms <= max));
      pintarResumen();
    }
    const mover = (delta, ic, texto, deshabilitado) => el("button", {
      class: "btn btn-sm btn-outline-light", attrs: { type: "button", "aria-label": `${texto} ${etq.toLowerCase()}`, title: texto, disabled: deshabilitado },
      on: { click: () => { [pasos[i], pasos[i + delta]] = [pasos[i + delta], pasos[i]]; pintarLista(i + delta, ic); } },
    }, [icono(ic)]);
    const li = el("li", { class: "editor-paso" }, [
      el("span", { class: "editor-num", text: i + 1, attrs: { "aria-hidden": "true" } }),
      el("label", { class: "editor-campo editor-cmd" }, [el("small", { text: "Comando" }), sel]),
      el("label", { class: "editor-campo" }, [el("small", { text: "Duración (ms)" }), dur]),
      el("label", { class: "editor-campo" }, [el("small", { text: "Pausa (ms)" }), pau]),
      el("span", { class: "editor-acc" }, [
        mover(-1, "i-chev-up", "Subir", i === 0),
        mover(1, "i-chev-down", "Bajar", i === pasos.length - 1),
        el("button", { class: "btn btn-sm btn-outline-danger", attrs: { type: "button", "aria-label": `Quitar ${etq.toLowerCase()}`, title: "Quitar" },
          on: { click: () => { pasos.splice(i, 1); pintarLista(Math.min(i, pasos.length - 1), "i-x"); } } }, [icono("i-x")]),
      ]),
    ]);
    revisar();
    return li;
  }

  /** Repinta y devuelve el foco al mismo control tras mover/quitar (accesibilidad de teclado). */
  function pintarLista(enfocar = -1, ic = "") {
    if (!pasos.length) lista.replaceChildren(el("li", { class: "vacio", text: soloLectura ? "Esta DEMO no tiene pasos." : "Sin pasos. Agrega el primero." }));
    else lista.replaceChildren(...pasos.map(fila));
    pintarResumen();
    if (enfocar >= 0 && lista.children[enfocar]) {
      const objetivo = lista.children[enfocar].querySelector(`[aria-label^="${ic === "i-chev-up" ? "Subir" : ic === "i-chev-down" ? "Bajar" : "Quitar"}"]:not([disabled])`)
        || lista.children[enfocar].querySelector("select, button:not([disabled])");
      objetivo?.focus();
    }
  }

  agregar.addEventListener("click", () => {
    const ultimo = pasos[pasos.length - 1];
    pasos.push({ id_comando: ultimo?.id_comando ?? activos[0]?.id_comando ?? null, duracion_ms: Math.min(1000, max), pausa_ms: 0 });
    pintarLista();
    lista.lastElementChild?.querySelector("select")?.focus();
  });

  const cuerpo = [
    nota ? el("p", { class: "alert alert-info py-2 small", text: nota }) : null,
    el("p", { class: "small text-secondary-emphasis mb-2", text:
      `Límites del modelo: cada paso hasta ${seg(max)} (${max} ms), ${limites.max_pasos_demo} pasos y ${seg(limites.max_demo_ms)} en total. ` +
      "DETENER siempre cancela la DEMO en curso." }),
    lista,
    el("div", { class: "editor-pie" }, [soloLectura ? null : agregar, resumen]),
  ].filter(Boolean);

  const ctx = abrirModal({
    titulo,
    tamano: "lg modal-fullscreen-sm-down",
    cuerpo,
    acciones: soloLectura
      ? [{ texto: "Cerrar", clase: "btn-primary" }]
      : [
        { texto: "Descartar", clase: "btn-outline-secondary" },
        { texto: "Guardar pasos", clase: "btn-primary", tipo: "submit",
          alPulsar: async () => { await guardar(pasos.map((p) => ({ ...p }))); } },
      ],
  });
  botonGuardar = ctx.form.querySelector('button[type="submit"]');
  pintarLista();
  return ctx;
}
