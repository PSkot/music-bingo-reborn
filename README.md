# Music Bingo

A small web app that turns a Spotify playlist into a printable PDF of music bingo plates
(by default 3 × 4 songs per plate, two plates per A4 landscape page).

## Setup

1. Create an app at <https://developer.spotify.com/dashboard>.
   - Under **Redirect URIs**, add `http://127.0.0.1:5000/callback`. Spotify doesn't accept `localhost`.
   - Tick **Web API**.
2. Copy `.env.example` to `.env` and fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`
   and a random `FLASK_SECRET_KEY`.
3. Install and run:

   ```bash
   python -m venv .venv
   source .venv/bin/activate      # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python app.py
   ```

4. Open <http://127.0.0.1:5000>, log in with Spotify, paste a playlist link and click **Generate PDF**.

## Options

- **Title**: printed above every plate. Defaults to the playlist name.
- **Plates / rows / columns**: plates with more than 4 rows are printed one per page.
- **Clean up titles**: removes suffixes like `- Remastered 2011` and `(feat. ...)`.
- **Song checklist**: adds a sorted list of every song used, which the host can tick off as songs play.

Songs are spread evenly, so each song appears on about the same number of plates, and no two plates contain the same set of songs.

## Why a Spotify login is needed

Since Spotify's February 2026 Development Mode changes, an app-only (client credentials) token can no longer read playlist contents.
The app therefore uses the regular login flow. In Development Mode, Spotify may also only return
playlists that the logged-in user owns or collaborates on. If you get a "refused access" error, save
a copy of the playlist to your own account and use that link instead. The account that owns the
Spotify app needs Premium, and other people who log in must be added under **User Management** in the dashboard.
