/* Script/script.js - versión con debug y show progress fijo
   Reemplaza todo el script actual con este archivo.
   IDs esperados en Inicio.html:
   #file-input, #drop-area, #analyze-button, #file-preview-container,
   #preview-filename, #delete-file-btn, #progress-container, #progress-bar,
   #progress-percent, #upload-message, #file-info
*/

(function () {
  'use strict';

  /* ===== showToast (simple) ===== */
  function showToast(message, type = 'success') {
    const containerId = 'toast-container';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.setAttribute('aria-live', 'polite');
      container.style.position = 'fixed';
      container.style.top = '20px';
      container.style.right = '20px';
      container.style.zIndex = '2147483647';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.alignItems = 'flex-end';
      container.style.gap = '10px';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-success');
    toast.textContent = message;
    toast.style.minWidth = '260px';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '8px';
    toast.style.color = '#fff';
    toast.style.fontWeight = '700';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.16)';
    toast.style.pointerEvents = 'auto';
    toast.style.opacity = '1';
    toast.style.transition = 'opacity 300ms ease, transform 300ms ease';
    toast.style.background = type === 'error'
      ? 'linear-gradient(90deg,#ff5f6d,#ff3b30)'
      : 'linear-gradient(90deg,#20c997,#18a86b)';

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => { try { toast.remove(); } catch(e){} }, 320);
    }, 3500);
  }

  /* ===== Query DOM ===== */
  const fileInput = document.getElementById('file-input');
  const dropArea = document.getElementById('drop-area');
  const analyzeBtn = document.getElementById('analyze-button');
  const previewContainer = document.getElementById('file-preview-container');
  const previewFilename = document.getElementById('preview-filename');
  const deleteBtn = document.getElementById('delete-file-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressPercent = document.getElementById('progress-percent');
  const uploadMessage = document.getElementById('upload-message');
  const fileInfo = document.getElementById('file-info');

  if (!fileInput || !dropArea || !analyzeBtn) {
    console.warn('Upload widget incomplete: missing #file-input, #drop-area or #analyze-button. Upload handler disabled.');
    return;
  }

  /* ===== State ===== */
  let selectedFile = null;
  let openingDialog = false;
  let uploading = false;

  /* ===== Helpers UI ===== */
  function enableAnalyze(flag) { if (analyzeBtn) analyzeBtn.disabled = !flag; }

  function showPreview(file) {
    selectedFile = file;
    if (previewContainer) previewContainer.classList.remove('hidden');
    if (previewFilename) previewFilename.textContent = file.name;
    if (fileInfo) fileInfo.textContent = `${file.type || 'desconocido'} · ${Math.round(file.size / 1024)} KB`;
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    enableAnalyze(true);
    if (uploadMessage) uploadMessage.textContent = '';
  }

  function resetSelection(keepValue = false) {
    selectedFile = null;
    if (previewContainer) previewContainer.classList.add('hidden');
    if (previewFilename) previewFilename.textContent = '';
    if (fileInfo) fileInfo.textContent = '';
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    enableAnalyze(false);
    if (uploadMessage) uploadMessage.textContent = '';
    if (!keepValue && fileInput) { try { fileInput.value = ''; } catch(e){} }
  }

function resetAfterUpload(success = false) {
  uploading = false;

  try {
    if (success && fileInput) fileInput.value = '';
    if (fileInput) fileInput.blur();
  } catch (e) {}

  // Si éxito, mostrará 100% y esperará N ms antes de limpiar completamente.
  const HIDE_MS = 3000; // tiempo en ms que se quedará el 100% visible (ajusta si quieres)

  if (progressContainer) {
    if (success) {
      // asegurar 100%
      if (progressBar) progressBar.style.width = '100%';
      if (progressPercent) progressPercent.textContent = '100%';

      // esperar un momento y luego ocultar la barra y limpiar preview
      setTimeout(() => {
        try {
          progressContainer.classList.add('hidden');
          if (progressBar) progressBar.style.width = '0%';
          if (progressPercent) progressPercent.textContent = '0%';
        } catch (e) {}
      }, HIDE_MS);
    } else {
      // en fallo, dejamos la barra visible para reintento (no la ocultamos)
    }
  }

  // bloquear temporalmente para evitar re-open accidental
  if (dropArea) {
    dropArea.style.pointerEvents = 'none';
    setTimeout(() => { if (dropArea) dropArea.style.pointerEvents = 'auto'; }, 500);
  }

  // si fue exitoso, limpiamos la preview y form (usuario ya subió)
  if (success) {
    // limpiar preview después de la misma espera (sin borrar inmediatamente para dar feedback)
    setTimeout(() => resetSelection(true), HIDE_MS);
  } else {
    enableAnalyze(selectedFile !== null);
  }
}


  /* ===== Drag & Drop (prevent default on document) ===== */
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt =>
    document.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }, false)
  );

  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('dragover'); });
  dropArea.addEventListener('dragleave', (e) => { e.preventDefault(); dropArea.classList.remove('dragover'); });

  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
    const dt = e.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) return;
    handleFile(dt.files[0]);
  });

  /* ===== Click open selector (with real lock) ===== */
  dropArea.addEventListener('click', () => {
    if (openingDialog || uploading) return;
    openingDialog = true;
    dropArea.style.pointerEvents = 'none';
    try { fileInput.click(); } catch (err) { console.warn('open selector err', err); openingDialog = false; dropArea.style.pointerEvents = 'auto'; }
  });

  dropArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!openingDialog && !uploading) {
        openingDialog = true;
        dropArea.style.pointerEvents = 'none';
        try { fileInput.click(); } catch (err) { openingDialog = false; dropArea.style.pointerEvents = 'auto'; }
      }
    }
  });

  /* ===== fileInput change ===== */
  fileInput.addEventListener('change', (e) => {
    openingDialog = false;
    if (dropArea) dropArea.style.pointerEvents = 'auto';
    const files = e.target.files;
    if (!files || files.length === 0) return; // cancel
    handleFile(files[0]);
  });

  window.addEventListener('focus', () => { openingDialog = false; if (dropArea) dropArea.style.pointerEvents = 'auto'; });

  /* ===== delete button ===== */
  if (deleteBtn) deleteBtn.addEventListener('click', (ev) => { ev.preventDefault(); resetSelection(); try{fileInput.value='';}catch(e){} });

  /* ===== handleFile ===== */
  function handleFile(file) {
    const allowed = ['csv', 'xlsx', 'xls', 'zip', 'rar'];
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!allowed.includes(ext)) { showToast('Tipo de archivo no permitido: ' + file.name, 'error'); return; }
    showPreview(file);
  }

  /* ===== Upload with XHR (progress) ===== */
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!selectedFile) { showToast('Selecciona un archivo primero.', 'error'); return; }
      if (uploading) { showToast('Ya hay una subida en curso.', 'error'); return; }

      uploading = true;
      analyzeBtn.disabled = true;
      showToast('Iniciando subida...', 'success');

      const fd = new FormData();
      fd.append('files', selectedFile, selectedFile.name);

      // show progress container BEFORE sending
      if (progressContainer) progressContainer.classList.remove('hidden');
      if (fileInfo && selectedFile) fileInfo.textContent = `${selectedFile.name} · ${Math.round(selectedFile.size/1024)} KB`;

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/upload', true);
      xhr.withCredentials = true;

      // DEBUG: log start
      console.log('[upload] start', selectedFile.name, selectedFile.size);

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          if (progressBar) progressBar.style.width = pct + '%';
          if (progressPercent) progressPercent.textContent = pct + '%';
          // DEBUG: progress
          console.log('[upload] progress', pct, e.loaded, e.total);
        } else {
          console.log('[upload] progress not computable', e);
        }
      };

      xhr.onload = function () {
        analyzeBtn.disabled = false;
        uploading = false;
        try {
          const ct = xhr.getResponseHeader('Content-Type') || '';
          if (ct.indexOf('text/html') !== -1) {
            showToast('Sesión expirada. Inicia sesión nuevamente.', 'error');
            resetAfterUpload(false);
            return;
          }
          let res;
          try { res = JSON.parse(xhr.responseText); } catch (parseErr) {
            showToast('Respuesta inválida del servidor. Revisa logs.', 'error');
            console.error('[upload] parse error', xhr.responseText);
            resetAfterUpload(false);
            return;
          }
          if (res && res.ok) {
            showToast(res.msg || 'Archivo cargado correctamente.', 'success');
            showToast(res.msg1 || 'Pasar a Power BI.', 'success');
            resetAfterUpload(true);
            console.log('[upload] success', res);
          } else {
            const msg = (res && res.msg) ? res.msg : ('Error ' + (xhr.status || '') + '. Contacte soporte.');
            showToast(msg, 'error');
            resetAfterUpload(false);
            console.log('[upload] server error', res);
          }
        } catch (err) {
          console.error('Upload onload error', err);
          showToast('Error interno al procesar la respuesta.', 'error');
          resetAfterUpload(false);
        }
      };

      xhr.onerror = function () {
        uploading = false;
        analyzeBtn.disabled = false;
        showToast('Error de red durante la subida. Intenta de nuevo.', 'error');
        console.error('[upload] network error');
      };

      xhr.onabort = function () {
        uploading = false;
        analyzeBtn.disabled = false;
        showToast('Subida cancelada.', 'error');
      };

      xhr.send(fd);
    });
  }

  /* ===== init ===== */
  resetSelection();
})();
