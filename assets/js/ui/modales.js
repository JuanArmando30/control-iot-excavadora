/**
 * Ventanas modales accesibles (Bootstrap 5) construidas sin innerHTML.
 * Incluye un generador de formularios con validación nativa.
 */
import { el } from "./dom.js";

let contador = 0;

/**
 * @param {{titulo:string, cuerpo:Node[], acciones:Array<{texto:string, clase?:string,
 *          tipo?:"submit"|"button", alPulsar?:(ctx)=>Promise<boolean|void>|boolean|void}>,
 *          alAbrir?:(ctx)=>void}} op
 * @returns {{cerrar:()=>void, error:(msg:string)=>void, form:HTMLFormElement}}
 */
export function abrirModal({ titulo, cuerpo, acciones, alAbrir }) {
  const id = `modal-${++contador}`;
  const alerta = el("div", { class: "alert alert-danger py-2 small d-none", attrs: { role: "alert" } });
  const form = el("form", { class: "modal-content", attrs: { novalidate: true } });
  const pie = el("div", { class: "modal-footer" });

  const ctx = {
    form,
    cerrar: () => instancia.hide(),
    error: (msg) => { alerta.textContent = msg; alerta.classList.toggle("d-none", !msg); },
    ocupado: (on) => pie.querySelectorAll("button").forEach((b) => { b.disabled = on; }),
  };

  for (const a of acciones) {
    const b = el("button", { class: `btn ${a.clase || "btn-secondary"}`, text: a.texto, attrs: { type: a.tipo || "button" } });
    if (a.tipo !== "submit") {
      b.addEventListener("click", async () => {
        if (!a.alPulsar) return ctx.cerrar();
        if ((await a.alPulsar(ctx)) !== false) ctx.cerrar();
      });
    }
    pie.append(b);
  }
  const enviar = acciones.find((a) => a.tipo === "submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ctx.error("");
    if (!form.checkValidity()) { form.classList.add("was-validated"); return; }
    if (!enviar?.alPulsar) return ctx.cerrar();
    ctx.ocupado(true);
    try {
      if ((await enviar.alPulsar(ctx)) !== false) ctx.cerrar();
    } catch (err) {
      ctx.error(err?.message || "Ocurrió un error.");
    } finally {
      ctx.ocupado(false);
    }
  });

  form.append(
    el("div", { class: "modal-header" }, [
      el("h2", { class: "modal-title fs-5", text: titulo, attrs: { id: `${id}-t` } }),
      el("button", { class: "btn-close", attrs: { type: "button", "data-bs-dismiss": "modal", "aria-label": "Cerrar" } }),
    ]),
    el("div", { class: "modal-body" }, [alerta, ...cuerpo]),
    pie,
  );
  const raiz = el("div", { class: "modal fade", attrs: { id, tabindex: "-1", "aria-labelledby": `${id}-t`, "aria-modal": "true", role: "dialog" } },
    [el("div", { class: "modal-dialog modal-dialog-centered modal-dialog-scrollable" }, [form])]);
  document.body.append(raiz);

  const instancia = new window.bootstrap.Modal(raiz);
  raiz.addEventListener("shown.bs.modal", () => {
    (raiz.querySelector("input:not([type=checkbox]),select,textarea") || raiz.querySelector(".btn-close"))?.focus();
    alAbrir?.(ctx);
  });
  raiz.addEventListener("hidden.bs.modal", () => { instancia.dispose(); raiz.remove(); });
  instancia.show();
  return ctx;
}

/** Confirmación (por ejemplo, antes de eliminar). Resuelve true/false. */
export function confirmar(titulo, mensaje, textoAceptar = "Eliminar") {
  return new Promise((resolve) => {
    let ok = false;
    const ctx = abrirModal({
      titulo,
      cuerpo: [el("p", { class: "mb-0", text: mensaje })],
      acciones: [
        { texto: "Cancelar", clase: "btn-outline-secondary" },
        { texto: textoAceptar, clase: "btn-danger", alPulsar: () => { ok = true; } },
      ],
    });
    ctx.form.closest(".modal").addEventListener("hidden.bs.modal", () => resolve(ok), { once: true });
  });
}

/**
 * Campo de formulario con restricciones del backend (schemas.py).
 * @param {{nombre:string, etiqueta:string, tipo?:string, valor?:any, requerido?:boolean,
 *          max?:number, min?:number, maxLength?:number, opciones?:Array<[string,string]>, ayuda?:string}} c
 */
export function campo(c) {
  const id = `f-${c.nombre}-${contador}`;
  if (c.tipo === "checkbox") {
    return el("div", { class: "form-check form-switch mb-3" }, [
      el("input", { class: "form-check-input", attrs: { type: "checkbox", id, name: c.nombre, role: "switch", checked: !!c.valor } }),
      el("label", { class: "form-check-label", text: c.etiqueta, attrs: { for: id } }),
    ]);
  }
  let control;
  if (c.tipo === "select") {
    control = el("select", { class: "form-select", attrs: { id, name: c.nombre, required: !!c.requerido },
      dataset: c.entero ? { entero: "1" } : {} },
      (c.opciones || []).map(([v, t]) => el("option", { text: t, attrs: { value: v, selected: String(c.valor) === v } })));
  } else {
    control = el("input", {
      class: "form-control",
      attrs: {
        id, name: c.nombre, type: c.tipo || "text", required: !!c.requerido,
        maxlength: c.maxLength, min: c.min, max: c.max, step: c.tipo === "number" ? 1 : undefined,
        autocomplete: "off", spellcheck: "false",
        value: c.valor ?? "",
      },
    });
  }
  return el("div", { class: "mb-3" }, [
    el("label", { class: "form-label", text: c.etiqueta + (c.requerido ? " *" : ""), attrs: { for: id } }),
    control,
    c.ayuda ? el("div", { class: "form-text", text: c.ayuda }) : null,
    el("div", { class: "invalid-feedback", text: "Revisa este campo." }),
  ]);
}

/** Lee el formulario respetando tipos: number → entero, checkbox → booleano, vacío → null. */
export function leerFormulario(form) {
  const salida = {};
  for (const n of form.querySelectorAll("input[name],select[name]")) {
    if (n.type === "checkbox") salida[n.name] = n.checked;
    else if (n.type === "number" || n.dataset.entero) salida[n.name] = n.value === "" ? null : Number.parseInt(n.value, 10);
    else {
      const v = n.value.trim();
      salida[n.name] = v === "" ? null : v;
    }
  }
  return salida;
}
