import io
import json
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
import urllib.request
import webbrowser
import zipfile
from contextlib import contextmanager
from datetime import timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR
DATABASE_PATH = Path(__file__).resolve().parent / "instance" / "memento.sqlite3"
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=None)


def load_secret_key():
    configured_key = os.environ.get("MEMENTO_SECRET_KEY")
    if configured_key:
        return configured_key

    key_path = DATABASE_PATH.parent / ".secret_key"
    try:
        return key_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        generated_key = secrets.token_hex(32)
        try:
            key_path.write_text(generated_key, encoding="utf-8")
        except FileExistsError:
            return key_path.read_text(encoding="utf-8").strip()
        return generated_key


app.secret_key = load_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("MEMENTO_HTTPS", "").lower() in {"1", "true"},
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)


@contextmanager
def database():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    with database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


initialize_database()


def account_from_session():
    account_id = session.get("account_id")
    if account_id is None:
        return None
    return {
        "id": account_id,
        "name": session.get("account_name", "Memento User"),
        "email": session.get("account_email", ""),
    }


def require_account(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if account_from_session() is None:
            return jsonify({"error": "Please sign in to continue."}), 401
        return view(*args, **kwargs)

    return wrapped


# Offline speech-to-text for browsers without the Web Speech API (Firefox, etc.).
# Audio is transcribed in memory on this server and never written to disk.
SPEECH_MODEL_NAME = "vosk-model-small-en-us-0.15"
SPEECH_MODEL_URL = f"https://alphacephei.com/vosk/models/{SPEECH_MODEL_NAME}.zip"
SPEECH_MODEL_DIR = DATABASE_PATH.parent / "models" / SPEECH_MODEL_NAME
SPEECH_SAMPLE_RATE = 16000
MAX_AUDIO_BYTES = SPEECH_SAMPLE_RATE * 2 * 20  # 20 seconds of 16-bit mono audio
speech = {"model": None, "status": "idle"}  # idle, loading, ready or unavailable


def load_speech_model():
    speech["status"] = "loading"
    try:
        from vosk import Model, SetLogLevel

        SetLogLevel(-1)
        if not SPEECH_MODEL_DIR.is_dir():
            SPEECH_MODEL_DIR.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(SPEECH_MODEL_URL, timeout=120) as response:
                archive_bytes = response.read()
            with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
                archive.extractall(SPEECH_MODEL_DIR.parent)
        speech["model"] = Model(str(SPEECH_MODEL_DIR))
        speech["status"] = "ready"
    except Exception as error:  # missing package, no network, corrupt download
        print(f"Offline voice engine unavailable: {error}")
        speech["status"] = "unavailable"


@app.get("/api/speech/status")
@require_account
def speech_status():
    return jsonify({"status": speech["status"]})


@app.post("/api/transcribe")
@require_account
def transcribe():
    if speech["status"] != "ready":
        return jsonify({"error": "The offline speech engine is not ready.", "status": speech["status"]}), 503
    if request.content_length is None or request.content_length > MAX_AUDIO_BYTES:
        return jsonify({"error": "Recording is too long."}), 413

    audio = request.get_data(cache=False)
    if len(audio) < SPEECH_SAMPLE_RATE // 5 * 2:
        return jsonify({"text": ""})

    from vosk import KaldiRecognizer

    recognizer = KaldiRecognizer(speech["model"], SPEECH_SAMPLE_RATE)
    recognizer.AcceptWaveform(audio[: len(audio) // 2 * 2])
    return jsonify({"text": json.loads(recognizer.FinalResult()).get("text", "")})

def start_session(account):
    session.clear()
    session.permanent = True
    session["account_id"] = account["id"]
    session["account_name"] = account["name"]
    session["account_email"] = account["email"]


def serve_app():
    account = account_from_session()
    if account is None:
        return redirect(url_for("login_page"))

    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    encoded_account = json.dumps(account).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    account_script = f"<script>window.MEMENTO_ACCOUNT = {encoded_account};</script>"
    html = html.replace("<!-- MEMENTO_ACCOUNT_CONTEXT -->", account_script, 1)
    return Response(html, mimetype="text/html")


@app.get("/")
@app.get("/index.html")
def index():
    return serve_app()


@app.get("/login")
@app.get("/register")
def login_page():
    if account_from_session() is not None:
        return redirect(url_for("index"))
    return send_from_directory(STATIC_DIR, "login.html")


@app.get("/api/auth/session")
def auth_session():
    account = account_from_session()
    return jsonify({"authenticated": account is not None, "account": account})


@app.post("/api/auth/register")
def register():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Please submit the registration form."}), 400

    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    if not name or len(name) > 80:
        return jsonify({"error": "Enter a name with 1 to 80 characters."}), 400
    if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify({"error": "Enter a valid email address."}), 400
    if len(password) < 8 or len(password) > 256:
        return jsonify({"error": "Use a password between 8 and 256 characters."}), 400

    try:
        with database() as connection:
            cursor = connection.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                (name, email, generate_password_hash(password)),
            )
            account = {"id": cursor.lastrowid, "name": name, "email": email}
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with that email already exists. Sign in instead."}), 409

    start_session(account)
    return jsonify({"account": account}), 201


@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Please submit the sign-in form."}), 400

    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    with database() as connection:
        account = connection.execute(
            "SELECT id, name, email, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if account is None or not check_password_hash(account["password_hash"], password):
        return jsonify({"error": "Email or password is incorrect."}), 401

    account_data = {"id": account["id"], "name": account["name"], "email": account["email"]}
    start_session(account_data)
    return jsonify({"account": account_data})


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/account")
@require_account
def account_details():
    return jsonify({"account": account_from_session()})


@app.get("/<path:path>")
def static_files(path: str):
    if path == "index.html":
        return serve_app()
    if path == "login.html":
        return login_page()

    requested = (STATIC_DIR / path).resolve()
    try:
        requested.relative_to(STATIC_DIR)
    except ValueError:
        return "Not found", 404

    if requested.is_file() and requested.suffix.lower() in {".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"}:
        return send_from_directory(STATIC_DIR, path)
    if account_from_session() is not None:
        return serve_app()
    return redirect(url_for("login_page"))


def open_browser_when_ready(port):
    def wait_for_server():
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                    webbrowser.open(f"http://127.0.0.1:{port}/register", new=2)
                    return
            except OSError:
                time.sleep(0.25)

    threading.Thread(target=wait_for_server, daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    threading.Thread(target=load_speech_model, daemon=True).start()
    if os.environ.get("MEMENTO_OPEN_BROWSER", "").lower() in {"1", "true"}:
        open_browser_when_ready(port)
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=port,
        debug=os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true"},
    )
