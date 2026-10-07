import {
  RESULT, VERDICT_TEXT, createGrid, cellAt, coverage, toneDetected,
  frameStats, frameLooksAlive, motionDetected, summarize, shareText,
} from './logic.js';

const track = document.getElementById('track');
const strip = document.getElementById('strip');
const overlay = document.getElementById('overlay');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function openOverlay() {
  overlay.replaceChildren();
  overlay.hidden = false;
  overlay.requestFullscreen?.().catch(() => {});
  return {
    root: overlay,
    close() {
      overlay.hidden = true;
      overlay.replaceChildren();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    },
  };
}

function overlayHint(text) {
  return el('p', { className: 'overlay-hint', textContent: text });
}

function overlayButton(text, onClick) {
  const button = el('button', { className: 'overlay-close', type: 'button', textContent: text });
  button.addEventListener('click', onClick);
  return button;
}

function waitForChoice(ui, statusText, options) {
  ui.status(statusText, 'running');
  return new Promise((resolve) => {
    ui.choices(options.map((o) => ({ ...o, onClick: () => resolve(o.value) })));
  });
}

// ---------------------------------------------------------------------------
// Tests. Each one receives a `ui` object and must end by calling ui.finish().
// ---------------------------------------------------------------------------
const TESTS = [
  {
    id: 'touch',
    title: 'Pantalla táctil',
    tag: 'Se evalúa sola',
    how: 'Vas a ver una grilla en toda la pantalla. Pasá el dedo por todos los cuadros hasta que queden verdes.',
    async run(ui) {
      const grid = createGrid(6, 11);
      const { root, close } = openOverlay();
      const board = el('div', { className: 'grid' });
      board.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
      board.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;
      const cells = Array.from({ length: grid.cols * grid.rows }, () => board.appendChild(el('div')));

      const result = await new Promise((resolve) => {
        const paint = (event) => {
          const rect = board.getBoundingClientRect();
          const index = cellAt(grid, event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
          if (grid.touched.has(index)) return;
          grid.touched.add(index);
          cells[index].classList.add('on');
          if (coverage(grid) === 1) resolve(RESULT.PASS);
        };
        board.addEventListener('pointerdown', paint);
        board.addEventListener('pointermove', paint);
        root.append(
          board,
          overlayHint('Pasá el dedo por todos los cuadros'),
          overlayButton('Hay zonas que no responden', () => resolve(RESULT.FAIL)),
        );
      });
      close();
      const percent = Math.round(coverage(grid) * 100);
      ui.finish(result, result === RESULT.PASS
        ? 'Toda la pantalla responde al tacto.'
        : `Quedaron zonas sin responder: se cubrió el ${percent}% de la pantalla.`);
    },
  },
  {
    id: 'multitouch',
    title: 'Varios dedos a la vez',
    tag: 'Se evalúa sola',
    how: 'Apoyá tres dedos al mismo tiempo sobre la pantalla. Sirve para zoom y juegos.',
    async run(ui) {
      const { root, close } = openOverlay();
      const active = new Set();
      const counter = overlayHint('Dedos detectados: 0 de 3');
      const result = await new Promise((resolve) => {
        root.addEventListener('pointerdown', (e) => {
          active.add(e.pointerId);
          counter.textContent = `Dedos detectados: ${active.size} de 3`;
          if (active.size >= 3) resolve(RESULT.PASS);
        });
        const release = (e) => active.delete(e.pointerId);
        root.addEventListener('pointerup', release);
        root.addEventListener('pointercancel', release);
        root.append(counter, overlayButton('No detecta varios dedos', () => resolve(RESULT.FAIL)));
      });
      close();
      ui.finish(result, result === RESULT.PASS
        ? 'La pantalla detecta varios dedos a la vez.'
        : 'La pantalla no detectó tres dedos al mismo tiempo.');
    },
  },
  {
    id: 'pixels',
    title: 'Píxeles y manchas',
    tag: 'La evaluás vos',
    how: 'La pantalla se va a llenar de un color por vez. Tocá para pasar al siguiente y buscá puntos que no cambien de color o manchas.',
    async run(ui) {
      const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000'];
      const { root, close } = openOverlay();
      const hint = overlayHint('Tocá para cambiar de color');
      root.append(hint);
      for (const color of colors) {
        root.style.background = color;
        await new Promise((resolve) => root.addEventListener('pointerdown', resolve, { once: true }));
        hint.remove();
      }
      root.style.background = '';
      close();
      const answer = await waitForChoice(ui, '¿Viste algún punto fijo o mancha?', [
        { label: 'Se ve perfecta', kind: 'good', value: RESULT.PASS },
        { label: 'Vi puntos o manchas', kind: 'bad', value: RESULT.FAIL },
      ]);
      ui.finish(answer, answer === RESULT.PASS
        ? 'Sin píxeles muertos ni manchas.'
        : 'La pantalla tiene píxeles muertos o manchas.');
    },
  },
  {
    id: 'audio',
    title: 'Parlante y micrófono',
    tag: 'Se evalúa sola',
    how: 'Subí el volumen y sacá el modo silencio. El parlante va a emitir un pitido y el micrófono tiene que captarlo. Te va a pedir permiso para usar el micrófono.',
    async run(ui) {
      const FREQ = 1800;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx || !navigator.mediaDevices?.getUserMedia) {
        ui.finish(RESULT.SKIP, 'Este navegador no permite probar el audio. Probalo con una nota de voz.');
        return;
      }
      const ctx = new AudioCtx(); // created inside the tap, so the browser lets it play

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch {
        ui.status('Sin permiso de micrófono solo podemos probar el parlante.', 'running');
      }
      await ctx.resume();

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = FREQ;
      gain.gain.value = 0.5;
      oscillator.connect(gain).connect(ctx.destination);

      let hits = 0;
      if (stream) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Float32Array(analyser.frequencyBinCount);
        ui.status('Escuchando el pitido…', 'running');
        oscillator.start();
        for (let i = 0; i < 30 && hits < 4; i++) {
          await sleep(100);
          analyser.getFloatFrequencyData(data);
          if (toneDetected(data, ctx.sampleRate, analyser.fftSize, FREQ)) hits++;
        }
        stream.getTracks().forEach((t) => t.stop());
      } else {
        oscillator.start();
        await sleep(1500);
      }
      oscillator.stop();
      ctx.close();

      if (hits >= 4) {
        ui.finish(RESULT.PASS, 'El micrófono captó el pitido del parlante: los dos funcionan.');
        return;
      }
      const answer = await waitForChoice(
        ui,
        stream
          ? 'El micrófono no captó el pitido. ¿Lo escuchaste? Si sonó bajo, subí el volumen y repetí.'
          : '¿Escuchaste el pitido?',
        [
          { label: 'Se escuchó', kind: 'good', value: 'heard' },
          { label: 'No se escuchó', kind: 'bad', value: 'silent' },
        ],
      );
      if (answer === 'silent') {
        ui.finish(RESULT.FAIL, 'El parlante no emitió sonido.');
      } else if (stream) {
        ui.finish(RESULT.FAIL, 'El parlante suena, pero el micrófono no lo captó. Confirmalo grabando una nota de voz.');
      } else {
        ui.finish(RESULT.PASS, 'El parlante funciona. El micrófono quedó sin probar.');
      }
    },
  },
  {
    id: 'vibration',
    title: 'Vibración',
    tag: 'La evaluás vos',
    how: 'El celular va a vibrar dos veces.',
    async run(ui) {
      if (!('vibrate' in navigator)) {
        ui.finish(RESULT.SKIP, 'Este navegador no permite probar la vibración (pasa en iPhone). Probala recibiendo una llamada.');
        return;
      }
      navigator.vibrate([400, 200, 400]);
      const answer = await waitForChoice(ui, '¿Sentiste la vibración?', [
        { label: 'Vibró', kind: 'good', value: RESULT.PASS },
        { label: 'No vibró', kind: 'bad', value: RESULT.FAIL },
      ]);
      ui.finish(answer, answer === RESULT.PASS ? 'El motor de vibración funciona.' : 'El celular no vibró.');
    },
  },
  {
    id: 'camera-back',
    title: 'Cámara trasera',
    tag: 'Se evalúa sola',
    how: 'Apuntá a algo con buena luz. Te va a pedir permiso para usar la cámara.',
    run: (ui) => cameraTest(ui, 'environment', 'trasera'),
  },
  {
    id: 'camera-front',
    title: 'Cámara frontal',
    tag: 'Se evalúa sola',
    how: 'Mirá a la cámara de adelante, con buena luz.',
    run: (ui) => cameraTest(ui, 'user', 'frontal'),
  },
  {
    id: 'motion',
    title: 'Sensores de movimiento',
    tag: 'Se evalúa sola',
    how: 'Mové el celular en el aire durante unos segundos. Prueba el acelerómetro que usa la rotación de pantalla.',
    async run(ui) {
      if (!('DeviceMotionEvent' in window)) {
        ui.finish(RESULT.SKIP, 'Este navegador no da acceso a los sensores.');
        return;
      }
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          if ((await DeviceMotionEvent.requestPermission()) !== 'granted') throw new Error('denied');
        } catch {
          ui.finish(RESULT.SKIP, 'No diste permiso para leer los sensores. Tocá Repetir y aceptalo.');
          return;
        }
      }
      const magnitudes = [];
      const onMotion = (event) => {
        const a = event.accelerationIncludingGravity;
        if (a && a.x !== null) magnitudes.push(Math.hypot(a.x, a.y, a.z));
      };
      window.addEventListener('devicemotion', onMotion);
      ui.status('Mové el celular…', 'running');
      for (let i = 0; i < 60 && !motionDetected(magnitudes); i++) await sleep(100);
      window.removeEventListener('devicemotion', onMotion);

      if (magnitudes.length === 0) ui.finish(RESULT.SKIP, 'El navegador no envió datos de los sensores.');
      else if (motionDetected(magnitudes)) ui.finish(RESULT.PASS, 'El acelerómetro responde al movimiento.');
      else ui.finish(RESULT.FAIL, 'Los sensores no registraron movimiento.');
    },
  },
  {
    id: 'charging',
    title: 'Batería y carga',
    tag: 'Se evalúa sola',
    how: 'Tené a mano un cargador. Vamos a ver el nivel de batería y si el puerto carga.',
    async run(ui) {
      if (!navigator.getBattery) {
        ui.finish(RESULT.SKIP, 'Este navegador no informa la batería (pasa en iPhone). Mirá la salud en Ajustes > Batería.');
        return;
      }
      const battery = await navigator.getBattery();
      const percent = Math.round(battery.level * 100);
      if (battery.charging) {
        ui.finish(RESULT.PASS, `Está cargando, con ${percent}% de batería. El puerto funciona.`);
        return;
      }
      const outcome = await new Promise((resolve) => {
        const onChange = () => {
          if (!battery.charging) return;
          battery.removeEventListener('chargingchange', onChange);
          resolve(RESULT.PASS);
        };
        battery.addEventListener('chargingchange', onChange);
        ui.status(`Batería al ${percent}%. Conectá el cargador…`, 'running');
        ui.choices([
          { label: 'No tengo cargador acá', onClick: () => { battery.removeEventListener('chargingchange', onChange); resolve(RESULT.SKIP); } },
          { label: 'No carga', kind: 'bad', onClick: () => { battery.removeEventListener('chargingchange', onChange); resolve(RESULT.FAIL); } },
        ]);
      });
      const text = {
        [RESULT.PASS]: 'Detectamos la carga: el puerto funciona.',
        [RESULT.FAIL]: 'El celular no carga con el cargador conectado.',
        [RESULT.SKIP]: `Batería al ${percent}%. La carga quedó sin probar.`,
      };
      ui.finish(outcome, text[outcome]);
    },
  },
  {
    id: 'physical',
    title: 'Revisión física',
    tag: 'La evaluás vos',
    how: 'Lo que el navegador no puede medir. Marcá cada punto a medida que lo revisás.',
    startLabel: 'Ver la lista',
    async run(ui) {
      const items = [
        'Marcaste *#06# y el IMEI coincide con la caja o la factura.',
        'Consultaste el IMEI en la web de ENACOM y no figura como denunciado.',
        'La cuenta de Google o iCloud del dueño anterior está cerrada.',
        'Los botones de volumen y encendido responden y no están hundidos.',
        'El cargador entra firme en el puerto, sin juego.',
        'La huella o el reconocimiento facial funcionan.',
        'No hay rajaduras, golpes ni la tapa despegada.',
      ];
      const boxes = items.map(() => el('input', { type: 'checkbox' }));
      ui.extra.replaceChildren(el('ul', { className: 'checklist' },
        ...items.map((text, i) => el('li', {}, el('label', {}, boxes[i], el('span', { textContent: text }))))));

      let answer;
      do {
        answer = await waitForChoice(ui, 'Cuando termines, elegí una opción.', [
          { label: 'Todo está bien', kind: 'good', value: RESULT.PASS },
          { label: 'Algo está mal', kind: 'bad', value: RESULT.FAIL },
        ]);
        if (answer === RESULT.PASS && boxes.some((b) => !b.checked)) {
          ui.status('Faltan puntos por marcar. Revisalos o elegí "Algo está mal".', 'fail');
          await sleep(1800);
          answer = null;
        }
      } while (!answer);
      ui.finish(answer, answer === RESULT.PASS
        ? 'Revisaste todos los puntos físicos.'
        : 'Encontraste un problema físico: usalo para negociar o no compres.');
    },
  },
];

async function cameraTest(ui, facingMode, label) {
  if (!navigator.mediaDevices?.getUserMedia) {
    ui.finish(RESULT.SKIP, 'Este navegador no da acceso a la cámara.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false });
  } catch (error) {
    const denied = error.name === 'NotAllowedError';
    ui.finish(denied ? RESULT.SKIP : RESULT.FAIL, denied
      ? 'No diste permiso para usar la cámara. Tocá Repetir y aceptalo.'
      : `No se pudo abrir la cámara ${label}.`);
    return;
  }
  const video = el('video', { className: 'preview', playsInline: true, muted: true, autoplay: true });
  video.srcObject = stream;
  ui.extra.replaceChildren(video);
  await video.play().catch(() => {});
  ui.status('Midiendo la imagen…', 'running');
  await sleep(1200);

  const canvas = el('canvas', { width: 96, height: 72 });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let aliveFrames = 0;
  for (let i = 0; i < 10; i++) {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (frameLooksAlive(frameStats(context.getImageData(0, 0, canvas.width, canvas.height).data))) aliveFrames++;
    await sleep(150);
  }

  if (aliveFrames < 5) {
    stream.getTracks().forEach((t) => t.stop());
    ui.extra.replaceChildren();
    ui.finish(RESULT.FAIL, `La cámara ${label} no muestra imagen (se ve negra o lisa). Si la tapaste, repetí la prueba.`);
    return;
  }
  const answer = await waitForChoice(ui, 'La cámara muestra imagen. ¿Se ve nítida y sin manchas?', [
    { label: 'Se ve bien', kind: 'good', value: RESULT.PASS },
    { label: 'Manchas o no enfoca', kind: 'bad', value: RESULT.FAIL },
  ]);
  stream.getTracks().forEach((t) => t.stop());
  ui.extra.replaceChildren();
  ui.finish(answer, answer === RESULT.PASS
    ? `La cámara ${label} funciona y enfoca.`
    : `La cámara ${label} tiene manchas o problemas de foco.`);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const slides = [track.querySelector('.intro')];

TESTS.forEach((test, i) => {
  results[test.id] = RESULT.PENDING;
  const status = el('div', { className: 'status', textContent: 'Todavía no la hiciste.' });
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const extra = el('div', { className: 'extra' });
  const startButton = el('button', { className: 'btn primary', type: 'button', textContent: test.startLabel ?? 'Empezar' });
  const choices = el('div', { className: 'actions' });
  const skipButton = el('button', { className: 'btn', type: 'button', textContent: 'Saltear' });

  const slide = el('section', { className: 'slide' },
    el('div', { className: 'slide-body' },
      el('p', { className: 'number', textContent: String(i + 1).padStart(2, '0') }),
      el('span', { className: 'tag', textContent: test.tag }),
      el('h2', { textContent: test.title }),
      el('p', { className: 'lead', textContent: test.how }),
      extra,
      status,
      choices,
      el('div', { className: 'actions' }, startButton, skipButton),
    ));
  slide.setAttribute('aria-label', `Prueba ${i + 1}: ${test.title}`);

  let finished = false;
  const ui = {
    extra,
    status(text, state = 'running') {
      status.textContent = text;
      status.dataset.state = state;
    },
    choices(list) {
      choices.replaceChildren(...list.map((c) => {
        const b = el('button', { className: `btn ${c.kind ?? ''}`, type: 'button', textContent: c.label });
        b.addEventListener('click', c.onClick);
        return b;
      }));
    },
    finish(result, text) {
      finished = true;
      results[test.id] = result;
      ui.status(text, result);
      choices.replaceChildren();
      startButton.textContent = 'Repetir';
      startButton.hidden = false;
      skipButton.hidden = true;
      refresh();
      setTimeout(() => goTo(i + 2), reduceMotion ? 0 : 1100);
    },
  };

  startButton.addEventListener('click', () => {
    finished = false;
    startButton.hidden = true;
    skipButton.hidden = true;
    choices.replaceChildren();
    ui.status('Preparando…', 'running');
    Promise.resolve(test.run(ui)).catch((error) => {
      console.error(error);
      if (!finished) ui.finish(RESULT.SKIP, 'No se pudo hacer esta prueba en este navegador.');
    });
  });
  skipButton.addEventListener('click', () => ui.finish(RESULT.SKIP, 'La salteaste.'));

  track.append(slide);
  slides.push(slide);

  const segment = el('button', { type: 'button', title: test.title });
  segment.setAttribute('aria-label', test.title);
  segment.addEventListener('click', () => goTo(i + 1));
  strip.append(segment);
});

const resultBody = el('div', { className: 'slide-body' });
const resultSlide = el('section', { className: 'slide' }, resultBody);
resultSlide.setAttribute('aria-label', 'Resultado');
track.append(resultSlide);
slides.push(resultSlide);

function refresh() {
  [...strip.children].forEach((segment, i) => { segment.dataset.state = results[TESTS[i].id]; });

  const summary = summarize(results);
  const verdict = VERDICT_TEXT[summary.verdict];
  const shareButton = el('button', { className: 'btn primary', type: 'button', textContent: 'Compartir resultado' });
  shareButton.addEventListener('click', async () => {
    const text = shareText(TESTS, results);
    try {
      if (navigator.share) await navigator.share({ title: 'Chequeá el Celu', text });
      else {
        await navigator.clipboard.writeText(text);
        shareButton.textContent = 'Resultado copiado';
      }
    } catch { /* the user closed the share sheet */ }
  });
  const restartButton = el('button', { className: 'btn', type: 'button', textContent: 'Revisar otro celular' });
  restartButton.addEventListener('click', () => window.location.reload());

  const icon = { pass: '✅', fail: '❌', skip: '➖', pending: '⏳' };
  resultBody.replaceChildren(
    el('p', { className: `score verdict-${summary.verdict}`, textContent: `${summary.score}%` }),
    el('h2', { className: `verdict-${summary.verdict}`, textContent: verdict.title }),
    el('p', { className: 'lead', textContent: verdict.body }),
    el('p', { textContent: `${summary.pass} bien · ${summary.fail} con fallas · ${summary.skip} salteadas · ${summary.pending} sin hacer` }),
    el('ul', { className: 'result-list' }, ...TESTS.map((t) => el('li', { textContent: `${icon[results[t.id]]} ${t.title}` }))),
    el('div', { className: 'actions' }, shareButton, restartButton),
  );
}

function goTo(index) {
  const target = slides[Math.max(0, Math.min(index, slides.length - 1))];
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
}

// Highlight the current test in the strip.
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const index = slides.indexOf(entry.target);
    [...strip.children].forEach((s, i) => {
      if (i === index - 1) s.setAttribute('aria-current', 'step');
      else s.removeAttribute('aria-current');
    });
  });
}, { root: track, threshold: 0.6 });
slides.forEach((s) => observer.observe(s));

document.querySelector('[data-action="next"]').addEventListener('click', () => goTo(1));
refresh();
