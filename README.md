# Music Bingo

A web app that turns a Spotify playlist into a printable PDF of music bingo plates
(by default 3 × 4 songs per plate, two plates per A4 landscape page).

Everything runs in the browser, so it can be hosted on GitHub Pages and used from a phone.
There is no server and no client secret. Spotify login uses the Authorization Code flow with PKCE,
and the PDF is built on the device with [jsPDF](https://github.com/parallax/jsPDF).

## Setup

1. Create an app at <https://developer.spotify.com/dashboard> and tick **Web API**.
2. Put its **Client ID** in `config.js`. The Client ID isn't secret, so it's fine to commit it.
   You don't need the client secret.
3. Under **Redirect URIs** in the Spotify app, add the address(es) you'll open the app from, exactly
   (the app also shows its redirect URI if the Client ID is missing):
   - GitHub Pages: `https://pskot.github.io/music-bingo-reborn/`
   - Local testing: `http://127.0.0.1:8000/` (Spotify doesn't accept `localhost`)

### Hosting on GitHub Pages

1. Make the repository public. GitHub Pages on a private repo needs a paid plan.
2. Go to **Settings → Pages**, choose **Deploy from a branch**, then pick the branch and `/ (root)`.
3. After a minute the app is live at `https://pskot.github.io/music-bingo-reborn/`. You can add it to
   your phone's home screen from the browser's share menu.

### Running locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8000/>. Opening `index.html` directly as a file won't work,
because the login needs a real web address.

## Options

- **Title**: printed above every plate. Defaults to the playlist name.
- **Plates / rows / columns**: plates with more than 4 rows are printed one per page.
- **Clean up titles**: removes suffixes like `- Remastered 2011` and `(feat. ...)`.
- **Song checklist**: adds a sorted list of every song used, which the host can tick off as songs play.

Songs are spread evenly, so each song appears on about the same number of plates, and no two plates contain the same set of songs.

## Spotify limitations

Since Spotify's February 2026 Development Mode changes:

- Playlist contents can only be read with a logged-in user, not with an app-only token.
- Spotify may only return playlists that the logged-in user owns or collaborates on. If you get a
  "refused access" error, save a copy of the playlist to your own account and use that link instead.
- The account that owns the Spotify app needs Premium. Up to 5 other people can use it, and each
  must be added under **User Management** in the dashboard.

## Credits

- `vendor/jspdf.umd.min.js`: jsPDF 4.2.1, MIT license.
- `fonts/DejaVuSans.ttf`: DejaVu Sans, see `fonts/DejaVu-LICENSE.txt`.
