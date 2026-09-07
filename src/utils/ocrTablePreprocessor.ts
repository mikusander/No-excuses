/**
 * ocrTablePreprocessor.ts — Pipeline di pre-processing dell'immagine e ricostruzione del layout tabellare.
 *
 * Risolve la distorsione dell'OCR lineare quando legge schede di allenamento organizzate in griglie/tabelle:
 * 1. Pre-Processing su Canvas: Grayscale + Otsu Thresholding (binarizzazione ottimale tra inchiostro e carta).
 * 2. Spatial Layout Reconstruction: Raggruppamento geometrico dei token parola basato su coordinate Bounding Box (bbox),
 *    clustering verticale (asse Y) e ordinamento orizzontale (asse X) con separazione delle colonne.
 */

export interface WordBoundingBox {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  confidence?: number;
}

/**
 * Calcola la soglia ottimale di binarizzazione globale mediante l'algoritmo di Otsu.
 * Massimizza la varianza inter-classe tra pixel di sfondo (carta) e pixel di primo piano (testo/griglie).
 */
export function computeOtsuThreshold(grayPixels: Uint8Array | Uint8ClampedArray): number {
  const histogram = new Int32Array(256);
  const totalPixels = grayPixels.length;

  if (totalPixels === 0) return 128;

  for (let i = 0; i < totalPixels; i++) {
    histogram[grayPixels[i]]++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) {
    sum += t * histogram[t];
  }

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let optimalThreshold = 128;

  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;

    const weightF = totalPixels - weightB;
    if (weightF === 0) break;

    sumB += t * histogram[t];

    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;

    // Varianza inter-classe (senza divisione costante per N^2 per evitare precision loss)
    const varianceBetween = weightB * weightF * (meanB - meanF) * (meanB - meanF);

    if (varianceBetween > maxVariance) {
      maxVariance = varianceBetween;
      optimalThreshold = t;
    }
  }

  // Clamping di sicurezza: garantisce che documenti con contrasti estremi mantengano il testo
  return Math.max(60, Math.min(200, optimalThreshold));
}

/**
 * Pre-elaborazione su Canvas off-screen dell'immagine prima del passaggio al worker Tesseract:
 * - Caricamento asincrono.
 * - Ridimensionamento proporzionale se l'immagine supera i 2200px (preserva la risoluzione per caratteri piccoli).
 * - Conversione in scala di grigi ad alta precisione (pesi luminanza ITU-R BT.601).
 * - Binarizzazione con Otsu Thresholding per massimizzare il contrasto tra testo e sfondo.
 * - Restituisce un Data URL in formato PNG.
 */
export async function preprocessTableImage(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const MAX_DIMENSION = 2200;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        // Fallback su Data URL originale
        resolve(objectUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      try {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const totalPixels = width * height;

        // 1. Canale scala di grigi
        const gray = new Uint8Array(totalPixels);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        }

        // 2. Calcolo soglia ottima con algoritmo di Otsu
        const threshold = computeOtsuThreshold(gray);

        // 3. Binarizzazione: testo nero (0) e sfondo bianco (255)
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          const val = gray[j] > threshold ? 255 : 0;
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Canvas pre-processing bypass (es. restrizioni memoria o CORS):', err);
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Impossibile caricare l'immagine della tabella."));
    };

    img.src = objectUrl;
  });
}

/**
 * Ricostruisce la disposizione spaziale tabellare partendo dalle Bounding Boxes delle parole.
 * Raggruppa i token riga per riga (clustering Y) e li ordina da sinistra a destra (ordinamento X),
 * rilevando le interruzioni tra colonne.
 */
export function reconstructTableLayout(words: WordBoundingBox[]): string[] {
  if (!words || words.length === 0) return [];

  // 1. Filtra token spuri o vuoti
  const validWords = words.filter(w => {
    const txt = (w.text || '').trim();
    if (txt.length === 0) return false;
    // Se la confidenza è esplicitata ed è inferiore a 10, è quasi certamente artefatto OCR
    if (w.confidence !== undefined && w.confidence < 10 && txt.length <= 1) return false;
    return true;
  });

  if (validWords.length === 0) return [];

  // 2. Calcola l'altezza mediana dei token per calibrare la tolleranza verticale e orizzontale
  const heights = validWords
    .map(w => Math.abs(w.bbox.y1 - w.bbox.y0))
    .filter(h => h > 4 && h < 400)
    .sort((a, b) => a - b);

  const medianHeight = heights.length > 0
    ? heights[Math.floor(heights.length / 2)]
    : 20;

  // Tolleranza verticale Y: permette a parole sulla stessa linea ma con leggero skew di raggrupparsi
  const yTolerance = Math.max(8, Math.round(medianHeight * 0.65));

  // Tolleranza per gap colonna (spazio tra celle adiacenti)
  const columnGapThreshold = Math.max(24, Math.round(medianHeight * 1.25));

  // 3. Ordina inizialmente tutti i token per coordinata Y del centro
  const sortedWords = [...validWords].sort((a, b) => {
    const yCenterA = (a.bbox.y0 + a.bbox.y1) / 2;
    const yCenterB = (b.bbox.y0 + b.bbox.y1) / 2;
    return yCenterA - yCenterB;
  });

  // 4. Clustering in righe orizzontali
  interface RowCluster {
    words: WordBoundingBox[];
    yMidMean: number;
    yMin: number;
    yMax: number;
  }

  const rows: RowCluster[] = [];

  for (const word of sortedWords) {
    const wYMid = (word.bbox.y0 + word.bbox.y1) / 2;
    const wHeight = Math.max(1, word.bbox.y1 - word.bbox.y0);

    let bestRow: RowCluster | null = null;
    let minDiff = Infinity;

    for (const row of rows) {
      const diff = Math.abs(wYMid - row.yMidMean);
      const overlap = Math.min(word.bbox.y1, row.yMax) - Math.max(word.bbox.y0, row.yMin);
      const rowHeight = Math.max(1, row.yMax - row.yMin);
      const minH = Math.min(wHeight, rowHeight);

      // Criterio 1: vicinanza del centro verticale
      // Criterio 2: sovrapposizione verticale consistente (> 40% dell'altezza minima)
      if (diff <= yTolerance || (overlap > 0 && overlap / minH >= 0.4)) {
        if (diff < minDiff) {
          minDiff = diff;
          bestRow = row;
        }
      }
    }

    if (bestRow) {
      bestRow.words.push(word);
      const count = bestRow.words.length;
      bestRow.yMidMean = ((bestRow.yMidMean * (count - 1)) + wYMid) / count;
      bestRow.yMin = Math.min(bestRow.yMin, word.bbox.y0);
      bestRow.yMax = Math.max(bestRow.yMax, word.bbox.y1);
    } else {
      rows.push({
        words: [word],
        yMidMean: wYMid,
        yMin: word.bbox.y0,
        yMax: word.bbox.y1,
      });
    }
  }

  // 5. Ordina le righe dall'alto verso il basso
  rows.sort((a, b) => a.yMidMean - b.yMidMean);

  // 6. All'interno di ciascuna riga, ordina le parole da sinistra a destra (asse X)
  const resultLines: string[] = [];

  for (const row of rows) {
    row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);

    let lineStr = '';
    for (let i = 0; i < row.words.length; i++) {
      const curr = row.words[i];
      const currText = curr.text.trim();

      if (i === 0) {
        lineStr = currText;
        continue;
      }

      const prev = row.words[i - 1];
      const gap = curr.bbox.x0 - prev.bbox.x1;

      // Se la distanza tra due parole supera la soglia di colonna, inserisci il separatore di cella "|"
      if (gap >= columnGapThreshold) {
        lineStr += ` | ${currText}`;
      } else {
        lineStr += ` ${currText}`;
      }
    }

    const cleanLine = lineStr.trim();
    // Escludi righe vuote o artefatti composti solo da linee tratteggiate o caratteri non alfanumerici
    if (cleanLine.length > 0 && !/^[\s\|\-\_\=\.\:\+]+$/.test(cleanLine)) {
      resultLines.push(cleanLine);
    }
  }

  return resultLines;
}
