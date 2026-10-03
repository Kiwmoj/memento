# WhereDidI

WhereDidI is an external memory for everyday things. Save what an item is, where it is (or who has it) and why it matters, then find it later by typing or asking out loud.

Built with Flask on the server and plain HTML, CSS and JavaScript in the browser. There is no Node.js, npm or build step.

## Setup

Requires Python 3.9 or newer.

### Windows (one click)

Double-click `run_app.bat`. It creates `.venv`, installs Flask and Vosk, starts the server and opens your browser. Keep the console window open while using the app. The first run needs an internet connection to install packages and download the voice model.

### Windows (PowerShell)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open **http://localhost:8080**, choose **Create account** the first time, then sign in with the same email and password afterwards. Use `localhost` (or HTTPS when deployed): browsers only allow the camera and microphone on secure origins.

To use another port, set `PORT` (for example `$env:PORT=9000` in PowerShell) before running `python app.py`.

## Features

- Memory cards with item, location, reason, category, date and optional photo
- Add, edit, delete and pin memories, with friendly validation
- Search by item, place, category or reason, including natural questions such as "where are my keys?"
- Filter by All memories, Pinned or any category
- Take a photo with the camera or choose an image, with preview, replace and remove
- Voice questions with clear states: ready, listening, processing, answer ready, and helpful errors
- Answers shown on screen and read aloud (can be switched off)
- Typed question fallback whenever voice is unavailable
- Responsive layout with a mobile menu, keyboard support, visible focus and labelled controls
- Per-account sign-in with hashed passwords

## Where data lives

- Memories and photos are stored in this browser's `localStorage`, scoped to your account. They are never uploaded. Clearing site data removes them, and they do not sync between devices.
- Account names, emails and password hashes are stored in `instance/memento.sqlite3`.
- Set `MEMENTO_SECRET_KEY` (and `MEMENTO_HTTPS=1` behind HTTPS) for a deployed server. Otherwise a key is generated in `instance/`.
- Voice recognition uses your browser's speech service where available (Chrome, Edge, Safari); Chrome and Edge may send audio to their own provider. In other browsers such as Firefox, the app records from the microphone and transcribes it on this computer with Vosk, an offline model. That audio is processed in memory and never stored or sent anywhere. Use "Type a question instead" if you prefer to keep everything on-device.

## Troubleshooting microphone and camera access

**Permission denied**
1. Click the lock icon beside the address bar.
2. Set Microphone or Camera to **Allow**.
3. Reload the page and try again.

**Voice in Firefox and other browsers**: these use the offline Vosk engine. On the first run the server downloads a ~40 MB English model into `instance/models/` (internet needed once; check the console for "Offline voice engine unavailable" if it fails). Until it finishes, the app says the voice engine is getting ready. Offline recognition is less accurate than Chrome's, so speak clearly. The typed question box always works.

**"No speech detected"**: check that the correct microphone is selected in your system sound settings, move closer, and speak after the "Listening" state appears.

**"No microphone / camera found"**: connect a device and make sure another app is not using it. Close video-call apps and retry.

**Nothing happens on a deployed site**: the camera and microphone require HTTPS. `localhost` is allowed without it.

**Camera still fails**: use **Choose image**. On phones it offers the camera or your photo library.

**Browser storage full**: photos are shrunk before saving, but localStorage is limited to a few MB. Remove old photos or memories.

**Page will not load**: make sure `python app.py` is still running and you are using the same port.
