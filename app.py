import os
import re
import secrets
import time
from urllib.parse import quote

from dotenv import load_dotenv
from flask import Flask, Response, flash, redirect, render_template, request, session, url_for

from bingo.pdf import build_pdf
from bingo.plates import clean_title, generate_plates
from bingo.spotify import Song, SpotifyError, authorize_url, exchange_code, fetch_playlist, parse_playlist_id, refresh_token

load_dotenv()

CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:5000/callback")

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)

DEFAULTS = {"playlist": "", "title": "", "count": 30, "rows": 3, "cols": 4, "clean": True, "song_list": False}


def _access_token() -> str | None:
    token = session.get("token")
    if not token:
        return None
    if time.time() >= token["expires_at"]:
        try:
            token = refresh_token(CLIENT_ID, CLIENT_SECRET, token["refresh_token"])
        except SpotifyError:
            session.pop("token", None)
            return None
        session["token"] = _slim(token)
    return token["access_token"]


def _slim(token: dict) -> dict:
    return {k: token[k] for k in ("access_token", "refresh_token", "expires_at")}


@app.get("/")
def index():
    form = {**DEFAULTS, **session.pop("form", {})}
    return render_template(
        "index.html",
        form=form,
        logged_in="token" in session,
        configured=bool(CLIENT_ID and CLIENT_SECRET),
        redirect_uri=REDIRECT_URI,
    )


@app.get("/login")
def login():
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    return redirect(authorize_url(CLIENT_ID, REDIRECT_URI, state))


@app.get("/callback")
def callback():
    if request.args.get("error"):
        flash(f"Spotify login was cancelled: {request.args['error']}")
    elif request.args.get("state") != session.pop("oauth_state", None):
        flash("Login failed (state mismatch). Please try again.")
    else:
        try:
            session["token"] = _slim(exchange_code(CLIENT_ID, CLIENT_SECRET, request.args["code"], REDIRECT_URI))
        except SpotifyError as e:
            flash(str(e))
    return redirect(url_for("index"))


@app.post("/logout")
def logout():
    session.pop("token", None)
    return redirect(url_for("index"))


@app.post("/generate")
def generate():
    form = {
        "playlist": request.form.get("playlist", "").strip(),
        "title": request.form.get("title", "").strip(),
        "count": request.form.get("count", type=int) or DEFAULTS["count"],
        "rows": request.form.get("rows", type=int) or DEFAULTS["rows"],
        "cols": request.form.get("cols", type=int) or DEFAULTS["cols"],
        "clean": "clean" in request.form,
        "song_list": "song_list" in request.form,
    }

    def fail(message: str):
        flash(message)
        session["form"] = form
        return redirect(url_for("index"))

    if not (1 <= form["count"] <= 500 and 1 <= form["rows"] <= 10 and 1 <= form["cols"] <= 10):
        return fail("Use 1-500 plates and 1-10 rows/columns.")
    token = _access_token()
    if not token:
        return fail("Please log in with Spotify first.")

    try:
        name, songs = fetch_playlist(token, parse_playlist_id(form["playlist"]))
    except SpotifyError as e:
        if "expired" in str(e):
            session.pop("token", None)
        return fail(str(e))

    if form["clean"]:
        unique = {}
        for song in songs:
            cleaned = Song(clean_title(song.title), song.artist)
            unique.setdefault((cleaned.title.lower(), cleaned.artist.lower()), cleaned)
        songs = list(unique.values())

    try:
        plates = generate_plates(songs, form["count"], form["rows"], form["cols"])
    except ValueError as e:
        return fail(str(e))

    title = form["title"] or name or "Music Bingo"
    used = list({song for plate in plates for song in plate})
    pdf = build_pdf(plates, title, form["rows"], form["cols"], song_list=used if form["song_list"] else None)
    filename = re.sub(r"[^\w\-]+", "_", title).strip("_") or "bingo"
    ascii_name = re.sub(r"[^A-Za-z0-9_\-]", "", filename) or "bingo"
    disposition = f'attachment; filename="{ascii_name}.pdf"; filename*=UTF-8\'\'{quote(filename)}.pdf'
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": disposition})


if __name__ == "__main__":
    # Bind to 127.0.0.1 so the address matches the Spotify redirect URI.
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=True)
