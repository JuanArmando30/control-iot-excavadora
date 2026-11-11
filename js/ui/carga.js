/**
 * Pantalla de carga (solo animación; el CSS la oculta sola).
 * Se carga de forma síncrona en <head> para decidir ANTES de pintar:
 *  - Completa (~3.5 s) al entrar al sitio o al recargar la página.
 *  - Corta (~1.8 s) con el nombre de la sección al navegar entre
 *    Control, Monitoreo y Administración.
 */
(function () {
  var raiz = document.documentElement;
  try {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    var recarga = nav && nav.type === "reload";
    var vista = sessionStorage.getItem("vehiculoIot.cargaVista");
    if (vista && !recarga) raiz.classList.add("carga-corta");
    sessionStorage.setItem("vehiculoIot.cargaVista", "1");
  } catch (e) { /* almacenamiento bloqueado: se muestra la completa, y el CSS la oculta sola */ }
})();
