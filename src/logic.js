// Pure functions with no browser APIs, so they can be unit tested with Node.

export const RESULT = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  SKIP: 'skip',
  PENDING: 'pending',
});

// ---------- Touch grid ----------
export function createGrid(cols, rows) {
  return { cols, rows, touched: new Set() };
}

export function cellAt(grid, x, y, width, height) {
  const clamp = (v, max) => Math.min(max - 1, Math.max(0, v));
  const col = clamp(Math.floor((x / width) * grid.cols), grid.cols);
  const row = clamp(Math.floor((y / height) * grid.rows), grid.rows);
  return row * grid.cols + col;
}

export function coverage(grid) {
  return grid.touched.size / (grid.cols * grid.rows);
}

// ---------- Speaker + microphone loopback ----------
// freqData: dB values per bin, as returned by AnalyserNode.getFloatFrequencyData.
export function toneDetected(freqData, sampleRate, fftSize, targetHz, { minDb = -70, minContrastDb = 15 } = {}) {
  const binHz = sampleRate / fftSize;
  const target = Math.round(targetHz / binHz);
  let peak = -Infinity;
  for (let i = target - 1; i <= target + 1; i++) {
    if (i >= 0 && i < freqData.length) peak = Math.max(peak, freqData[i]);
  }
  const others = [];
  for (let i = 0; i < freqData.length; i++) {
    if (Math.abs(i - target) > 8 && Number.isFinite(freqData[i])) others.push(freqData[i]);
  }
  if (others.length === 0) return false;
  others.sort((a, b) => a - b);
  const noiseFloor = others[Math.floor(others.length / 2)];
  return peak > minDb && peak - noiseFloor >= minContrastDb;
}

// ---------- Camera ----------
// rgba: pixel data from a canvas (Uint8ClampedArray). Samples every 4th pixel.
export function frameStats(rgba) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i + 2 < rgba.length; i += 16) {
    const luma = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    sum += luma;
    sumSq += luma * luma;
    n++;
  }
  if (n === 0) return { mean: 0, std: 0 };
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return { mean, std };
}

// A broken camera usually delivers black or flat frames.
export function frameLooksAlive({ mean, std }) {
  return mean > 15 && std > 6;
}

// ---------- Motion sensors ----------
export function motionDetected(magnitudes, threshold = 2) {
  if (magnitudes.length < 10) return false;
  return Math.max(...magnitudes) - Math.min(...magnitudes) >= threshold;
}

// ---------- Results ----------
export function summarize(results) {
  const values = Object.values(results);
  const pass = values.filter((r) => r === RESULT.PASS).length;
  const fail = values.filter((r) => r === RESULT.FAIL).length;
  const skip = values.filter((r) => r === RESULT.SKIP).length;
  const pending = values.filter((r) => r === RESULT.PENDING).length;
  const evaluated = pass + fail;
  const score = evaluated === 0 ? 0 : Math.round((pass / evaluated) * 100);

  let verdict;
  if (evaluated === 0) verdict = 'incomplete';
  else if (fail === 0) verdict = 'ok';
  else if (fail === 1) verdict = 'check';
  else verdict = 'bad';

  return { pass, fail, skip, pending, score, verdict };
}

const ICON = { pass: '✅', fail: '❌', skip: '➖', pending: '⏳' };

export function shareText(tests, results) {
  const { score, verdict } = summarize(results);
  const lines = tests.map((t) => `${ICON[results[t.id] ?? RESULT.PENDING]} ${t.title}`);
  return [`Chequeá el Celu: ${score}% de pruebas OK (${VERDICT_TEXT[verdict].title})`, ...lines].join('\n');
}

export const VERDICT_TEXT = {
  ok: { title: 'Todo funciona', body: 'No encontramos fallas. Igual revisá la parte física antes de pagar.' },
  check: { title: 'Revisá antes de comprar', body: 'Hay una prueba que falló. Puede ser un detalle o un motivo para negociar el precio.' },
  bad: { title: 'Mejor no', body: 'Fallaron varias pruebas. Pedí que te lo arreglen o buscá otro equipo.' },
  incomplete: { title: 'Faltan pruebas', body: 'Hacé al menos una prueba para ver un resultado.' },
};
