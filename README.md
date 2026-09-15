# JARVIS Sphere

A local personal assistant with an original particle-sphere interface, Hermes chat, speech wake, Voicebox support, live source-linked briefings, and two-hand sphere controls. This is a separate app inside the trading checkout. It contains no face identification or surveillance pipeline.

## What it does

- Select any visible sphere particle to open a current briefing from World, China, engineering, aircraft, or market feeds. Each panel shows the publisher, source time, refresh time, and original link.
- Scroll over the sphere to zoom. When zoomed in, JARVIS shows a source-linked briefing preview; market particles include a current intraday Dow Jones line chart from Yahoo Finance.
- Say “Jarvis, wake up” or clap twice after starting voice control. JARVIS responds in the browser voice or an optional local Voicebox profile.
- Use one pinched hand to rotate the sphere and two hands to zoom it. Camera inference stays in the browser.
- Use the Computer console to open a website or local app, download a file to Downloads, find files under the current user's home folder, or run an explicit command. Every action has an exact review-and-confirm screen. Commands run without a shell.

## Run

From this folder:

```powershell
npm ci
npm run setup
npm start
```

Open http://127.0.0.1:4317. Node.js 22+ and a current Chromium browser are recommended. Setup downloads pinned MediaPipe assets; the interface and hand model are then served locally. The Python bridge defaults to `C:\Hermes\hermes-agent\venv\Scripts\python.exe` and reads the existing `C:\Hermes\config.yaml` and `.env`. Override `JARVIS_PYTHON`, `HERMES_HOME`, or `JARVIS_PORT` in the process environment if needed. No credentials go into browser code.

To install it as an app after it is running, open the address in Chrome or Edge and choose **Install JARVIS** from the browser menu. The local server and Hermes remain required because they provide the AI bridge and local computer-action boundary.

Chat needs the existing configured AI provider to be available. The local UI does not imply offline model inference. Capacity errors and timeouts produce a retryable failure. The bridge has no enabled tools, skips workspace instructions and memory, and disables Hermes plugins through safe mode. It is a conversational assistant, not an unrestricted operating-system agent.

## Download the desktop app

GitHub Releases contains the downloadable installers: Windows uses an `.exe` installer and macOS uses a `.dmg` when the macOS release job is available. The repository includes Windows and macOS release jobs, but the current GitHub Actions account is not allocating runner jobs; version 1.0.0 therefore contains the locally verified Windows installer only. On first run, configure a provider on that computer as described below; the installer contains no API keys, model credentials, or shared defaults.

For local development, `npm run desktop` launches the desktop shell. `npm run dist` makes the installer for the current operating system. macOS Gatekeeper warnings remain possible until the project is signed and notarized with the repository owner's Apple Developer certificate.

## Provider connection

Hermes remains the default and uses the existing `C:\Hermes` configuration. You can select another provider only in the server environment; keys never enter the webpage or its local storage.

The default Hermes configuration uses the local OmniRoute OpenAI-compatible endpoint at `http://127.0.0.1:20128/v1`. The header reports `HERMES · OMNIROUTE` when that route is active.

```powershell
# Direct OmniRoute. Create a scoped local key in OmniRoute and keep it in the process environment.
$env:JARVIS_PROVIDER = 'omniroute'
$env:OMNIROUTE_API_KEY = '...'
# Optional: $env:JARVIS_OMNIROUTE_MODEL = 'auto'

# OpenRouter: choose a model available to your account.
$env:JARVIS_PROVIDER = 'openrouter'
$env:OPENROUTER_API_KEY = '...'
$env:JARVIS_OPENROUTER_MODEL = 'provider/model-name'

# Gemini: the default model is gemini-2.5-flash-lite.
$env:JARVIS_PROVIDER = 'gemini'
$env:GEMINI_API_KEY = '...'
# Optional: $env:JARVIS_GEMINI_MODEL = 'gemini-2.5-flash-lite'
```

Restart `npm start` after changing provider variables. The header identifies the selected bridge but never exposes a model name or credential. `G0DM0DƎ` is available locally as a visual tool; it is not a documented model-provider API, so it is not used as a chat backend.

For a downloaded desktop app, set the same variables in the environment before launching it. Windows users can set them in User Environment Variables. macOS users can set them in the shell or a launch configuration. The app never asks users to paste API keys into the interface.

## Voicebox voice

JARVIS uses the installed browser voice by default. To use a local Voicebox profile, install and run Voicebox, create a voice profile you own, then start JARVIS with:

```powershell
$env:VOICEBOX_URL = 'http://127.0.0.1:17493'
$env:VOICEBOX_PROFILE = 'Your profile name'
```

JARVIS calls Voicebox's local `/speak` endpoint. Voicebox owns the profile, personality, and audio settings; JARVIS does not include or clone a film character voice.

## Controls

- Type a message and press Enter; Shift+Enter inserts a newline. Clear resets in-memory conversation. During a request, Clear cancels it.
- Start voice control once to authorize browser microphone access. Then say “Jarvis, wake up” (or “Hey Jarvis”) or clap twice; JARVIS waits for the command, sends it automatically, reads its reply aloud, and returns to wake listening. Stop voice control or press Escape to end it. Wake words use the browser recognizer; clap detection is local to the tab.
- Enable air touch explicitly requests the webcam. Pinch and move one hand to rotate the sphere. Use two hands to zoom it. It only operates the sphere; it does not move the desktop pointer.
- Escape stops sensors and speech. Hiding the page stops camera processing. The camera is off on every page load.
- Air touch uses a 480×360 ideal camera feed, up to two hands, 15 FPS by default, adaptive pointer smoothing, and worker inference. Low-power mode reduces processing to 8 FPS. These are caps, not guaranteed measured performance on an old machine.
- Windows and macOS can install the local app through Chrome or Edge's Install control, or Safari's Add to Dock. `open_app` uses the native launcher on Windows, macOS, and Linux; macOS accepts an existing `.app` bundle. Hermes and Python must be installed locally, and macOS users set `JARVIS_PYTHON` and `HERMES_HOME` to their local locations.
- On iPhone and Android, the PWA interface can be installed from Safari's Share > Add to Home Screen or Chrome's Install app. Full chat and Computer-console actions still need a reachable JARVIS server: a phone cannot use a desktop's `127.0.0.1` address. Camera and speech behavior remains browser- and device-dependent.
- Notes use browser localStorage and are not encrypted. Chat history is kept in page memory; the AI provider and Hermes runtime may have their own logging policies.

## Verification

```powershell
npm test
python tests/test_bridge.py
npm run test:browser
```

The browser test uses the parent checkout's installed Playwright package and an already-running JARVIS server. It exercises a real MediaPipe model with synthetic camera frames, notes, timer, help, responsive layout, camera shutdown, an injected HTML response, and a simulated permission denial. It does not establish real hand or microphone accuracy.

To additionally require a real provider response through the browser:

```powershell
$env:JARVIS_LIVE_TEST = '1'
npm run test:browser
```

HTTP checks cover origin/Host guards, DNS rebinding, token enforcement, path isolation, request size, invalid roles, and concurrent requests. The Python check ensures provider failures cannot be displayed as successful answers. `npm audit --omit=dev` checks the pinned JavaScript dependency; it does not audit the separately installed Hermes environment.

## Security boundary

This server is for a single trusted OS account and binds to 127.0.0.1. Do not expose it through a public tunnel or reverse proxy. A local process with the user's privileges can obtain the UI token, as can that user's browser. Remote website requests are rejected by Host, Origin, Fetch Metadata, and token checks. Only the public asset directory is served. Messages enter the child process through JSON stdin with no shell; responses enter the DOM through textContent.

Camera frames remain in the browser worker. Chat text crosses to the configured model provider. The server bounds input, output, request concurrency, and child lifetime. The code and tests cannot guarantee a vulnerability-free system; browser, model binary, Hermes dependencies, and upstream provider internals require separate assessment.

The legacy desktop pointer companion is Windows-only and is not exposed in the current sphere-only interface. It accepts only a small JSON protocol: normalized cursor movement, one primary click, bounded scroll, and disarm. It cannot accept shell commands or key presses.
