# Chequeá el Celu

![Tests](https://github.com/Drabenq/chequea-el-celu/actions/workflows/test.yml/badge.svg)

**Demo:** https://drabenq.github.io/chequea-el-celu/ (open it on a phone)

Web app to inspect a used phone before buying it. The buyer opens the page on the phone being sold and runs the checks in a few minutes, swiping from one test to the next. Interface in Spanish (Argentina).

## Checks

| Check | How it is evaluated |
|-------|---------------------|
| Touch screen | Automatic: a full-screen grid must be completely covered |
| Multi-touch | Automatic: detects 3 fingers at the same time |
| Speaker + microphone | Automatic: the speaker plays an 1800 Hz tone and the microphone must detect it (FFT analysis) |
| Back and front cameras | Automatic: analyzes frames to detect a black or frozen image, then asks about focus |
| Motion sensors | Automatic: accelerometer readings must change while moving the phone |
| Charging port | Automatic: Battery API detects when the charger is plugged in |
| Dead pixels, vibration | Guided manual check |
| Physical checklist | IMEI, account lock, buttons, port, biometrics, damage |

The result screen shows a score, a verdict and lets the buyer share a summary. Nothing is stored or sent anywhere.

## Tech

Vanilla JavaScript (ES modules), no build step, no dependencies. Uses browser APIs: Pointer Events, Web Audio, MediaDevices, DeviceMotion, Battery and Web Share.

The detection logic (tone detection, frame analysis, motion, scoring) lives in `src/logic.js` as pure functions and is unit tested with Node's built-in test runner:

```bash
npm test
```

Browser support varies: iPhone does not allow vibration or battery access from the web, so those checks are marked as "not available" instead of failing.

## Run locally

Camera and microphone need HTTPS or localhost:

```bash
python -m http.server 8000
```

Open http://localhost:8000
