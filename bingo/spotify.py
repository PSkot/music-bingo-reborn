"""Minimal Spotify Web API client: OAuth (authorization code flow) and playlist reading.

Since Spotify's February 2026 Development Mode changes, playlist contents are only
returned with a *user* access token, so the client credentials flow is not enough.
"""

import base64
import re
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import requests

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API_URL = "https://api.spotify.com/v1"
SCOPES = "playlist-read-private playlist-read-collaborative"

_PLAYLIST_ID_RE = re.compile(r"(?:playlist[/:])([A-Za-z0-9]{22})")
_BARE_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")


class SpotifyError(Exception):
    pass


@dataclass(frozen=True)
class Song:
    title: str
    artist: str


def parse_playlist_id(link: str) -> str:
    """Accepts open.spotify.com links (with or without intl-xx/ and ?si=), spotify: URIs or bare IDs."""
    link = link.strip()
    if _BARE_ID_RE.match(link):
        return link
    match = _PLAYLIST_ID_RE.search(link)
    if not match:
        raise SpotifyError("That doesn't look like a Spotify playlist link.")
    return match.group(1)


def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def _token_request(client_id: str, client_secret: str, data: dict) -> dict:
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = requests.post(TOKEN_URL, data=data, headers={"Authorization": f"Basic {basic}"}, timeout=15)
    if resp.status_code != 200:
        raise SpotifyError(f"Spotify login failed ({resp.status_code}): {resp.text}")
    token = resp.json()
    token["expires_at"] = time.time() + token.get("expires_in", 3600) - 60
    return token


def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    return _token_request(
        client_id,
        client_secret,
        {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
    )


def refresh_token(client_id: str, client_secret: str, refresh: str) -> dict:
    token = _token_request(client_id, client_secret, {"grant_type": "refresh_token", "refresh_token": refresh})
    token.setdefault("refresh_token", refresh)
    return token


def _get(url: str, access_token: str, params: dict | None = None) -> requests.Response:
    resp = requests.get(url, params=params, headers={"Authorization": f"Bearer {access_token}"}, timeout=15)
    if resp.status_code == 429:
        time.sleep(int(resp.headers.get("Retry-After", "1")))
        return _get(url, access_token, params)
    return resp


def _raise_for(resp: requests.Response) -> None:
    if resp.status_code == 401:
        raise SpotifyError("Your Spotify session has expired. Please log in again.")
    if resp.status_code == 403:
        raise SpotifyError(
            "Spotify refused access to this playlist. Apps in Development Mode can only read "
            "playlists that the logged-in user owns or collaborates on - try saving a copy of "
            "the playlist to your own account."
        )
    if resp.status_code == 404:
        raise SpotifyError("Playlist not found. Is the link correct?")
    if resp.status_code != 200:
        raise SpotifyError(f"Spotify API error ({resp.status_code}): {resp.text}")


def fetch_playlist(access_token: str, playlist_id: str) -> tuple[str, list[Song]]:
    """Returns (playlist name, unique songs in playlist order)."""
    name = ""
    meta = _get(f"{API_URL}/playlists/{playlist_id}", access_token, {"fields": "name"})
    if meta.status_code == 200:
        name = meta.json().get("name", "")

    songs: list[Song] = []
    seen: set[tuple[str, str]] = set()
    url = f"{API_URL}/playlists/{playlist_id}/items"
    params: dict | None = {"limit": 50, "additional_types": "track"}
    while url:
        resp = _get(url, access_token, params)
        if resp.status_code == 404 and url.endswith("/items"):
            # Older apps may still only have the pre-2026 endpoint.
            url = f"{API_URL}/playlists/{playlist_id}/tracks"
            resp = _get(url, access_token, params)
        _raise_for(resp)
        page = resp.json()
        for entry in page.get("items", []):
            track = entry.get("item") or entry.get("track")
            if not track or track.get("type", "track") != "track" or not track.get("name"):
                continue
            artists = [a.get("name", "") for a in track.get("artists", []) if a.get("name")]
            song = Song(track["name"], artists[0] if artists else "")
            key = (song.title.lower(), song.artist.lower())
            if key not in seen:
                seen.add(key)
                songs.append(song)
        url, params = page.get("next"), None
    return name, songs
