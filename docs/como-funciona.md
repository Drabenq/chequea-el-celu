# Cómo funciona

## Estructura
- `src/logic.js`: funciones puras (sin navegador). Se testean con `npm test`.
- `src/app.js`: arma las pantallas y conecta cada prueba con las APIs del navegador.
- Cada prueba es un objeto con `id`, `title`, `how` y `run(ui)`. Para agregar una prueba nueva solo sumás un objeto a la lista `TESTS`.

## Las pruebas automáticas, explicadas
- **Parlante + micrófono:** el parlante emite un tono de 1800 Hz y el micrófono escucha. Con un `AnalyserNode` se obtiene el espectro (FFT). Si la frecuencia de 1800 Hz está 15 dB por encima del ruido promedio en varias lecturas, los dos funcionan. Se desactiva la cancelación de eco porque si no el teléfono "borra" su propio sonido.
- **Cámaras:** se copia el video a un canvas chico y se calcula el brillo medio y la variación. Una cámara rota da negro o una imagen lisa.
- **Pantalla táctil:** cada movimiento del dedo se convierte en una celda de la grilla (`cellAt`). Cuando están todas, pasa.
- **Sensores:** se mide la aceleración total; si varía al mover el teléfono, el sensor anda.

## Por qué se testea así
El código que usa cámara o micrófono es difícil de testear automáticamente. Por eso la *decisión* (¿hay tono?, ¿la imagen está viva?) está separada en funciones puras que reciben números y se prueban con datos inventados.

## Ideas para seguir (monetización)
- Espacio para publicidad en la pantalla de resultado.
- Guardar el reporte como imagen para mandarlo por WhatsApp.
