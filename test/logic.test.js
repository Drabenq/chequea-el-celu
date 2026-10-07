import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESULT, createGrid, cellAt, coverage, toneDetected, frameStats,
  frameLooksAlive, motionDetected, summarize, shareText,
} from '../src/logic.js';

test('cellAt maps coordinates to cells and clamps the edges', () => {
  const grid = createGrid(4, 2);
  assert.equal(cellAt(grid, 0, 0, 400, 200), 0);
  assert.equal(cellAt(grid, 399, 199, 400, 200), 7);
  assert.equal(cellAt(grid, 500, 300, 400, 200), 7, 'outside the screen clamps to last cell');
  assert.equal(cellAt(grid, -10, -10, 400, 200), 0);
});

test('coverage reaches 1 only when every cell is touched', () => {
  const grid = createGrid(2, 2);
  grid.touched.add(0).add(1).add(2);
  assert.equal(coverage(grid), 0.75);
  grid.touched.add(3);
  assert.equal(coverage(grid), 1);
});

function spectrum(bins, floor, peakBin, peakDb) {
  const data = new Float32Array(bins).fill(floor);
  if (peakBin !== undefined) data[peakBin] = peakDb;
  return data;
}

test('toneDetected finds a clear tone over the noise floor', () => {
  // 48 kHz / 2048 = 23.4 Hz per bin; 1800 Hz -> bin 77
  const data = spectrum(1024, -100, 77, -40);
  assert.equal(toneDetected(data, 48000, 2048, 1800), true);
});

test('toneDetected ignores silence and loud broadband noise', () => {
  assert.equal(toneDetected(spectrum(1024, -100), 48000, 2048, 1800), false);
  assert.equal(toneDetected(spectrum(1024, -45, 77, -40), 48000, 2048, 1800), false);
});

test('toneDetected handles -Infinity bins from a silent analyser', () => {
  assert.equal(toneDetected(new Float32Array(1024).fill(-Infinity), 48000, 2048, 1800), false);
});

test('frameStats and frameLooksAlive reject black and flat frames', () => {
  const black = new Uint8ClampedArray(4 * 1000);
  assert.equal(frameLooksAlive(frameStats(black)), false);

  const gray = new Uint8ClampedArray(4 * 1000).fill(128);
  assert.equal(frameLooksAlive(frameStats(gray)), false, 'flat frame has no detail');

  const scene = new Uint8ClampedArray(4 * 1000);
  // frameStats samples every 4th pixel; build a pattern that varies at that stride.
  for (let p = 0; p < 1000; p++) {
    const v = Math.floor(p / 4) % 2 === 0 ? 40 : 200;
    scene[p * 4] = scene[p * 4 + 1] = scene[p * 4 + 2] = v;
  }
  assert.equal(frameLooksAlive(frameStats(scene)), true);
});

test('motionDetected needs enough samples and real variation', () => {
  assert.equal(motionDetected([9.8, 12, 7]), false, 'too few samples');
  assert.equal(motionDetected(Array(20).fill(9.8)), false, 'phone lying still');
  assert.equal(motionDetected([...Array(19).fill(9.8), 14]), true);
});

test('summarize computes score and verdict', () => {
  assert.deepEqual(summarize({ a: RESULT.PASS, b: RESULT.PASS, c: RESULT.SKIP }),
    { pass: 2, fail: 0, skip: 1, pending: 0, score: 100, verdict: 'ok' });
  assert.equal(summarize({ a: RESULT.PASS, b: RESULT.FAIL }).verdict, 'check');
  assert.equal(summarize({ a: RESULT.FAIL, b: RESULT.FAIL, c: RESULT.PASS }).verdict, 'bad');
  assert.equal(summarize({ a: RESULT.SKIP }).verdict, 'incomplete');
  assert.equal(summarize({ a: RESULT.PASS, b: RESULT.FAIL, c: RESULT.FAIL, d: RESULT.PASS }).score, 50);
});

test('shareText lists every test with its icon', () => {
  const tests = [{ id: 'a', title: 'Pantalla' }, { id: 'b', title: 'Cámara' }];
  const text = shareText(tests, { a: RESULT.PASS, b: RESULT.FAIL });
  assert.match(text, /50%/);
  assert.match(text, /✅ Pantalla/);
  assert.match(text, /❌ Cámara/);
});
