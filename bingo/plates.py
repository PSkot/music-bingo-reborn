import random
import re

from .spotify import Song

# " - Remastered 2011", " - Radio Edit", " - From \"Movie\"" ...
_DASH_SUFFIX_RE = re.compile(r"\s+-\s+.*$")
# "(feat. X)", "[Remastered]", "(Radio Edit)", "(2011 Remaster)" ...
_BRACKET_RE = re.compile(
    r"\s*[\(\[][^\)\]]*\b(feat\.?|ft\.?|with|remaster(ed)?|radio edit|edit|version|mix|remix|live|mono|stereo)\b[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


def clean_title(title: str) -> str:
    cleaned = _BRACKET_RE.sub("", _DASH_SUFFIX_RE.sub("", title)).strip()
    return cleaned or title


def generate_plates(songs: list[Song], count: int, rows: int, cols: int, seed: int | None = None) -> list[list[Song]]:
    """Returns `count` distinct plates of rows*cols songs each.

    Songs are spread as evenly as possible across plates, so every song in the playlist
    shows up on roughly the same number of plates.
    """
    size = rows * cols
    if len(songs) < size:
        raise ValueError(f"The playlist has {len(songs)} unique songs, but each plate needs {size}.")

    rng = random.Random(seed)
    usage = {song: 0 for song in songs}
    seen: set[frozenset[Song]] = set()
    plates = []
    for _ in range(count):
        # Prefer the least used songs, random tie-break.
        picked = sorted(songs, key=lambda s: (usage[s], rng.random()))[:size]
        attempts = 0
        while frozenset(picked) in seen and attempts < 100:
            picked = rng.sample(songs, size)
            attempts += 1
        seen.add(frozenset(picked))
        for song in picked:
            usage[song] += 1
        rng.shuffle(picked)
        plates.append(picked)
    return plates
