/* eslint-disable no-console */

(function () {
    "use strict";

    let stream = null;
    let videoElement = null;
    let canvasElement = null;
    let canvasContext = null;
    let escaneando = false;
    let idAnimacion = null;

    function qs(id) { return document.getElementById(id); }
    function mostrar(el, v) { if (el) el.classList.toggle("escaner-oculto", !v); }
    function estado(m) { const e = qs("estado-escaner"); if (e) e.textContent = m || "Listo."; }
    function resultado(txt) { const c = qs("contenido-resultado"); const p = qs("resultado-escaner"); if (c) c.textContent = txt; if (p) mostrar(p, true); }
    function limpiarR() { const c = qs("contenido-resultado"); const p = qs("resultado-escaner"); if (c) c.textContent = ""; if (p) mostrar(p, false); }

    function detenerCamara() {
        if (idAnimacion) { cancelAnimationFrame(idAnimacion); idAnimacion = null; }
        escaneando = false;
        if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
        if (videoElement && videoElement.srcObject) videoElement.srcObject = null;
        mostrar(qs("btn-encender-camara"), true);
        mostrar(qs("btn-apagar-camara"), false);
        estado("Cámara apagada.");
    }

    function procesarCodigo(codigo) {
        if (!codigo || typeof codigo !== "string") return;
        const limpio = codigo.trim();
        if (limpio.length === 0) return;
        escaneando = false;
        detenerCamara();
        estado("Código detectado.");
        resultado(limpio);
    }

    function frame() {
        if (!escaneando || !videoElement || !videoElement.videoWidth) { if (escaneando) idAnimacion = requestAnimationFrame(frame); return; }
        if (!canvasElement) { canvasElement = document.createElement("canvas"); canvasContext = canvasElement.getContext("2d", { willReadFrequently: true }); }
        if (videoElement.videoWidth !== canvasElement.width || videoElement.videoHeight !== canvasElement.height) {
            canvasElement.width = videoElement.videoWidth; canvasElement.height = videoElement.videoHeight;
        }
        canvasContext.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        const img = canvasContext.getImageData(0, 0, canvasElement.width, canvasElement.height);
        try {
            const qr = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (qr && qr.data) { procesarCodigo(qr.data); return; }
        } catch (e) {}
        idAnimacion = requestAnimationFrame(frame);
    }

    function encenderCamara() {
        limpiarR();
        if (stream) detenerCamara();
        if (!navigator.mediaDevices || !null) {
            estado("El navegador no soporta acceso a cámara. Usar \"Subir foto\" o \"Entrada manual\".");
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } })
            .then(function (s) {
                stream = s;
                videoElement = qs("video-escaner");
                if (videoElement) { videoElement.srcObject = stream; videoElement.setAttribute("playsinline", ""); videoElement.play().catch(function () {}); }
                mostrar(qs("btn-encender-camara"), false);
                mostrar(qs("btn-apagar-camara"), true);
                estado("Buscando código QR...");
                escaneando = true;
                idAnimacion = requestAnimationFrame(frame);
            })
            .catch(function (err) {
                let m = "No se pudo acceder a la cámara.";
                if (err && err.name === "NotAllowedError") m = "Permiso de cámara denegado. Usar \"Subir foto\" o \"Entrada manual\".";
                else if (err && err.name === "NotFoundError") m = "No se encontró cámara trasera. Intentando subir foto.";
                estado(m);
            });
    }

    function cambiarModo(m) {
        if (m === "manual") {
            detenerCamara();
            mostrar(qs("area-camara"), false);
            mostrar(qs("area-manual"), true);
            mostrar(qs("btn-modo-manual"), false);
            mostrar(qs("btn-modo-camara"), true);
            estado("modo manual activado.");
        } else {
            mostrar(qs("area-camara"), true);
            mostrar(qs("area-manual"), false);
            mostrar(qs("btn-modo-manual"), true);
            mostrar(qs("btn-modo-camara"), false);
            estado("Modo cámara listo.");
        }
    }

    function leerImagenDesdeArchivoNO(f) {
        if (!f) return;
        const r = new FileReader();
        r.onload = function (ev) {
            const img = new Image();
            img.onload = function () {
                const c = document.createElement("canvas");
                c.width = img.width; c.height = img.height;
                const ctx = c.getContext("2d", { willReadFrequently: true });
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    const d = ctx.getImageData(0, 0, c.width, c.height);
                    try {
                        const qr = window.jsQR(d.data, d.width, d.height);
                        if (qr && qr.data) { procesarCodigo(qr.data); return; }
                    } catch (e) {}
                }
                estado("No se encontró ningún código QR en la imagen.");
            };
            img.src = ev.target.result;
        };
        r.readAsDataURL(f);
    }

    function inicializar() {
        qs("btn-encender-camara")?.addEventListener("click", encenderCamara);
        qs("btn-apagar-camara")?.addEventListener("click", detenerCamara);
        if (qs("btn-subir-foto") && qs("input-foto")) {
            qs("btn-subir-foto").addEventListener("click", function () { qs("input-foto").click(); });
            qs("input-foto").addEventListener("change", function (e) { const f = e.target.files && e.target.files[0]; if (f) { detenerCamara(); leerImagenDesdeArchivo(f); e.target.value = ""; } });
        }
        qs("btn-modo-manual")?.addEventListener("click", function () { cambiarModo("manual"); });
        qs("btn-modo-camara")?.addEventListener("click", function () { cambiarModo("camara"); });
        if (qs("btn-procesar-manual") && qs("input-manual")) qs("btn-procesar-manual").addEventListener("click", function () { procesarCodigo(qs("input-manual").value); });
        if (qs("btn-limpiar-manual") && qs("input-manual")) qs("btn-limpiar-manual").addEventListener("click", function () { qs("input-manual").value = ""; });
        qs("btn-limpiar-resultado")?.addEventListener("click", limpiarR);
        window.addEventListener("beforeunload", detenerCamara);
        window.addEventListener("pagehide", detenerCamara);
        estado("Listo. El escáner es solo para personal con login.");
    }

    document.addEventListener("DOMContentLoaded", inicializar);
})();