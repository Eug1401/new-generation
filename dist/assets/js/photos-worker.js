// =============================================================
// New Generation — Photo Compression Worker (v104)
// =============================================================
// Comprime immagini off-main-thread.
// Riceve: {id, file, maxDim, quality, progressive}
// Risponde: {id, ok:true, blob} oppure {id, ok:false, error}
//
// NOTA su JPEG PROGRESSIVO:
//   OffscreenCanvas.convertToBlob() di default produce JPEG "baseline" (sequenziale).
//   Il flag `progressive` esiste solo in alcuni browser tramite la libreria nativa.
//   Per garantire compatibilità wide, usiamo l'approccio standard. Il caricamento
//   appare comunque immediato grazie a:
//   - cacheControl HTTP che mette i byte in cache browser dopo la prima visita
//   - decoding="async" + loading="lazy" gestiti correttamente lato client
//   - dimensione ridotta (200-400KB) che permette caricamento veloce
// =============================================================

self.onmessage = async (e) => {
  const { id, file, maxDim = 1600, quality = 0.85 } = e.data || {};
  try {
    if (!file) throw new Error('File mancante');
    if (file.type === 'image/gif') {
      self.postMessage({ id, ok: true, blob: file });
      return;
    }

    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close && bitmap.close();

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (!blob) throw new Error('Compressione fallita');

    if (blob.size > file.size && file.size < 2 * 1024 * 1024) {
      self.postMessage({ id, ok: true, blob: file });
      return;
    }

    self.postMessage({ id, ok: true, blob });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
