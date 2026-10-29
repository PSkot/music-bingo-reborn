"use strict";

// ---------------------------------------------------------------------------
// Spotify: login with Authorization Code + PKCE (no client secret needed) and
// playlist reading. Since Spotify's February 2026 Development Mode changes,
// playlist contents are only returned with a user access token.
// ---------------------------------------------------------------------------

const CLIENT_ID = window.SPOTIFY_CLIENT_ID || "";
const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html$/, "");
const SCOPES = "playlist-read-private playlist-read-collaborative";
const API = "https://api.spotify.com/v1";
const TOKEN_KEY = "bingo.token";

class SpotifyError extends Error {}

function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function login() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  storage("bingo.pkce", { verifier, state });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

async function tokenRequest(body) {
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new SpotifyError(`Spotify login failed: ${data.error_description || data.error || resp.status}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || body.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
}

// Finishes the login when Spotify redirects back with ?code=...
async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return;
  history.replaceState(null, "", REDIRECT_URI);
  const pkce = storage("bingo.pkce");
  storage("bingo.pkce", null);
  if (params.has("error")) throw new SpotifyError(`Spotify login was cancelled: ${params.get("error")}`);
  if (!pkce || params.get("state") !== pkce.state) throw new SpotifyError("Login failed (state mismatch). Please try again.");
  storage(TOKEN_KEY, await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code"),
    redirect_uri: REDIRECT_URI,
    code_verifier: pkce.verifier,
  }));
}

async function accessToken() {
  let token = storage(TOKEN_KEY);
  if (!token) return null;
  if (Date.now() >= token.expires_at) {
    try {
      token = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh_token });
      storage(TOKEN_KEY, token);
    } catch {
      storage(TOKEN_KEY, null);
      return null;
    }
  }
  return token.access_token;
}

async function apiGet(url, token) {
  for (;;) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status !== 429) return resp;
    const wait = Number(resp.headers.get("Retry-After") || 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

async function raiseFor(resp) {
  if (resp.status === 401) {
    storage(TOKEN_KEY, null);
    throw new SpotifyError("Your Spotify session has expired. Please log in again.");
  }
  if (resp.status === 403) {
    throw new SpotifyError(
      "Spotify refused access to this playlist. Apps in Development Mode can only read playlists " +
        "that the logged-in user owns or collaborates on - try saving a copy of the playlist to your own account."
    );
  }
  if (resp.status === 404) throw new SpotifyError("Playlist not found. Is the link correct?");
  if (!resp.ok) throw new SpotifyError(`Spotify API error (${resp.status}): ${await resp.text()}`);
}

function parsePlaylistId(link) {
  link = link.trim();
  if (/^[A-Za-z0-9]{22}$/.test(link)) return link;
  const match = link.match(/playlist[/:]([A-Za-z0-9]{22})/);
  if (!match) throw new SpotifyError("That doesn't look like a Spotify playlist link.");
  return match[1];
}

// Returns { name, songs: [{ title, artist }] } with duplicates removed.
async function fetchPlaylist(token, id) {
  let name = "";
  const meta = await apiGet(`${API}/playlists/${id}?fields=name`, token);
  if (meta.ok) name = (await meta.json()).name || "";

  const songs = [];
  const seen = new Set();
  let url = `${API}/playlists/${id}/items?limit=50&additional_types=track`;
  while (url) {
    let resp = await apiGet(url, token);
    if (resp.status === 404 && url.includes("/items?")) {
      // Older apps may still only have the pre-2026 endpoint.
      url = url.replace("/items?", "/tracks?");
      resp = await apiGet(url, token);
    }
    await raiseFor(resp);
    const page = await resp.json();
    for (const entry of page.items || []) {
      const track = entry.item || entry.track;
      if (!track || (track.type && track.type !== "track") || !track.name) continue;
      const artist = (track.artists || []).map((a) => a.name).find(Boolean) || "";
      const key = `${track.name.toLowerCase()}\u0000${artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        songs.push({ title: track.name, artist });
      }
    }
    url = page.next;
  }
  return { name, songs };
}

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

// " - Remastered 2011", " - Radio Edit", "(feat. X)", "[Remastered]", "(2011 Remaster)" ...
const DASH_SUFFIX_RE = /\s+-\s+.*$/;
const BRACKET_RE = /\s*[([][^)\]]*\b(feat\.?|ft\.?|with|remaster(ed)?|radio edit|edit|version|mix|remix|live|mono|stereo)\b[^)\]]*[)\]]/gi;

function cleanTitle(title) {
  return title.replace(DASH_SUFFIX_RE, "").replace(BRACKET_RE, "").trim() || title;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Returns `count` distinct plates of rows*cols songs each. Songs are spread as evenly
// as possible, so every song shows up on roughly the same number of plates.
function generatePlates(songs, count, rows, cols) {
  const size = rows * cols;
  if (songs.length < size) {
    throw new Error(`The playlist has ${songs.length} unique songs, but each plate needs ${size}.`);
  }
  const usage = new Map(songs.map((s) => [s, 0]));
  const seen = new Set();
  const keyOf = (plate) => plate.map((s) => songs.indexOf(s)).sort((a, b) => a - b).join(",");
  const plates = [];
  for (let n = 0; n < count; n++) {
    // Prefer the least used songs, random tie-break.
    let picked = shuffle([...songs]).sort((a, b) => usage.get(a) - usage.get(b)).slice(0, size);
    for (let attempts = 0; seen.has(keyOf(picked)) && attempts < 100; attempts++) {
      picked = shuffle([...songs]).slice(0, size);
    }
    seen.add(keyOf(picked));
    picked.forEach((s) => usage.set(s, usage.get(s) + 1));
    plates.push(shuffle(picked));
  }
  return plates;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGIN = 28;
const TITLE_SIZE = 18;
const MAX_ROW_HEIGHT = 58;
const PADDING = 4;
const LINE_FACTOR = 1.15;

let fontData = null;

// DejaVu Sans covers far more characters than the PDF built-in fonts.
async function useFont(doc) {
  try {
    if (!fontData) {
      const buf = new Uint8Array(await (await fetch("fonts/DejaVuSans.ttf")).arrayBuffer());
      let binary = "";
      for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      fontData = btoa(binary);
    }
    doc.addFileToVFS("DejaVuSans.ttf", fontData);
    doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");
    doc.setFont("DejaVu", "normal");
  } catch {
    doc.setFont("helvetica", "normal");
  }
}

function drawCell(doc, song, x, y, width, height) {
  let size, titleLines, artistLines, total;
  // Shrink the font until title and artist fit in the cell.
  for (size of [9, 8, 7, 6, 5]) {
    doc.setFontSize(size);
    titleLines = doc.splitTextToSize(song.title, width - 2 * PADDING);
    artistLines = song.artist ? doc.splitTextToSize(song.artist, width - 2 * PADDING) : [];
    total = (titleLines.length + artistLines.length) * size * LINE_FACTOR + (artistLines.length ? size * 0.9 : 0);
    if (total <= height - 2 * PADDING) break;
  }
  const cx = x + width / 2;
  let top = y + (height - total) / 2;
  const opts = { align: "center", baseline: "top", lineHeightFactor: LINE_FACTOR };
  doc.text(titleLines, cx, top, opts);
  if (artistLines.length) {
    top += titleLines.length * size * LINE_FACTOR + size * 0.9;
    doc.text(artistLines, cx, top, opts);
  }
}

function drawPlate(doc, plate, title, rows, cols, top, slotHeight) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(TITLE_SIZE);
  doc.text(title, pageWidth / 2, top + TITLE_SIZE, { align: "center" });

  const tableTop = top + TITLE_SIZE + 12;
  const colWidth = (pageWidth - 2 * MARGIN) / cols;
  const rowHeight = Math.min(MAX_ROW_HEIGHT, (top + slotHeight - tableTop - 8) / rows);
  doc.setLineWidth(1.2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = MARGIN + c * colWidth;
      const y = tableTop + r * rowHeight;
      doc.rect(x, y, colWidth, rowHeight);
      drawCell(doc, plate[r * cols + c], x, y, colWidth, rowHeight);
    }
  }
}

// Host checklist of every song in the game, in two columns.
function drawSongList(doc, songs, title) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const size = 9;
  const leading = 13;
  const perColumn = Math.floor((height - 2 * MARGIN - 40) / leading);
  const colWidth = (width - 2 * MARGIN) / 2;
  const ordered = [...songs].sort((a, b) =>
    (a.title + "\u0000" + a.artist).localeCompare(b.title + "\u0000" + b.artist, undefined, { sensitivity: "base" })
  );
  doc.setLineWidth(0.8);
  for (let start = 0; start < ordered.length; start += perColumn * 2) {
    doc.addPage();
    doc.setFontSize(TITLE_SIZE);
    doc.text(`${title} - song list`, width / 2, MARGIN + TITLE_SIZE, { align: "center" });
    doc.setFontSize(size);
    ordered.slice(start, start + perColumn * 2).forEach((song, i) => {
      const x = MARGIN + Math.floor(i / perColumn) * colWidth;
      const y = MARGIN + 40 + (i % perColumn) * leading;
      doc.rect(x, y, 8, 8);
      let text = song.artist ? `${song.title} - ${song.artist}` : song.title;
      while (doc.getTextWidth(text) > colWidth - 24 && text.length > 4) text = text.slice(0, -4) + "...";
      doc.text(text, x + 14, y, { baseline: "top" });
    });
  }
}

async function buildPdf(plates, title, rows, cols, songList) {
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setProperties({ title });
  await useFont(doc);
  const perPage = rows <= 4 ? 2 : 1;
  const slotHeight = (doc.internal.pageSize.getHeight() - 2 * MARGIN) / perPage;
  plates.forEach((plate, i) => {
    const slot = i % perPage;
    if (i > 0 && slot === 0) doc.addPage();
    drawPlate(doc, plate, title, rows, cols, MARGIN + slot * slotHeight, slotHeight);
  });
  if (songList) drawSongList(doc, songList, title);
  return doc.output("blob");
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const FORM_KEY = "bingo.form";

function showMessage(text, kind = "error") {
  const el = $("message");
  el.textContent = text;
  el.className = `message ${kind}`;
  el.hidden = !text;
}

function render() {
  const loggedIn = Boolean(storage(TOKEN_KEY));
  $("setup").hidden = Boolean(CLIENT_ID);
  $("login").hidden = !CLIENT_ID || loggedIn;
  $("generator").hidden = !CLIENT_ID || !loggedIn;
  document.querySelectorAll(".redirect-uri").forEach((el) => (el.textContent = REDIRECT_URI));
}

function readForm() {
  const num = (id, fallback) => parseInt($(id).value, 10) || fallback;
  return {
    playlist: $("playlist").value.trim(),
    title: $("title").value.trim(),
    count: num("count", 30),
    rows: num("rows", 3),
    cols: num("cols", 4),
    clean: $("clean").checked,
    songList: $("song-list").checked,
  };
}

function restoreForm() {
  const saved = storage(FORM_KEY);
  if (!saved) return;
  for (const id of ["playlist", "title", "count", "rows", "cols"]) if (saved[id] != null) $(id).value = saved[id];
  $("clean").checked = saved.clean ?? true;
  $("song-list").checked = Boolean(saved.songList);
}

// Browsers can ignore non-ASCII download names, so "Fødselsdag" becomes "Foedselsdag".
function fileName(title) {
  const ascii = title
    .replace(/[æÆ]/g, "ae").replace(/[øØ]/g, "oe").replace(/[åÅ]/g, "aa").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  return ascii.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "bingo";
}

async function generate(event) {
  event.preventDefault();
  const form = readForm();
  storage(FORM_KEY, form);
  showMessage("");
  $("result").hidden = true;
  if (!(form.count >= 1 && form.count <= 500 && form.rows >= 1 && form.rows <= 10 && form.cols >= 1 && form.cols <= 10)) {
    return showMessage("Use 1-500 plates and 1-10 rows/columns.");
  }
  const button = $("generate");
  button.disabled = true;
  button.textContent = "Generating...";
  try {
    const token = await accessToken();
    if (!token) {
      render();
      throw new SpotifyError("Please log in with Spotify again.");
    }
    let { name, songs } = await fetchPlaylist(token, parsePlaylistId(form.playlist));
    if (form.clean) {
      const unique = new Map();
      for (const s of songs) {
        const cleaned = { title: cleanTitle(s.title), artist: s.artist };
        const key = `${cleaned.title.toLowerCase()}\u0000${cleaned.artist.toLowerCase()}`;
        if (!unique.has(key)) unique.set(key, cleaned);
      }
      songs = [...unique.values()];
    }
    const plates = generatePlates(songs, form.count, form.rows, form.cols);
    const title = form.title || name || "Music Bingo";
    const used = [...new Set(plates.flat())];
    const blob = await buildPdf(plates, title, form.rows, form.cols, form.songList ? used : null);

    const link = $("download");
    if (link.href) URL.revokeObjectURL(link.href);
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName(title)}.pdf`;
    $("result-text").textContent = `${plates.length} plates from ${songs.length} songs.`;
    $("result").hidden = false;
    link.click();
  } catch (err) {
    showMessage(err.message || String(err));
    render();
  } finally {
    button.disabled = false;
    button.textContent = "Generate PDF";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  restoreForm();
  $("login-button").addEventListener("click", () => login().catch((e) => showMessage(e.message)));
  $("logout").addEventListener("click", () => {
    storage(TOKEN_KEY, null);
    render();
  });
  $("generator").addEventListener("submit", generate);
  try {
    await handleRedirect();
  } catch (err) {
    showMessage(err.message);
  }
  render();
});
