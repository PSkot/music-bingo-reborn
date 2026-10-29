import io
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, Table, TableStyle
from xml.sax.saxutils import escape

from .spotify import Song

# A Unicode TTF font handles titles in any script; Helvetica is the fallback.
_FONT_CANDIDATES = [
    os.environ.get("BINGO_FONT", ""),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def _font() -> str:
    if "BingoFont" in pdfmetrics.getRegisteredFontNames():
        return "BingoFont"
    for path in _FONT_CANDIDATES:
        if path and os.path.isfile(path):
            try:
                pdfmetrics.registerFont(TTFont("BingoFont", path))
                return "BingoFont"
            except Exception:
                continue
    return "Helvetica"


MARGIN = 28
TITLE_SIZE = 18
MAX_ROW_HEIGHT = 58
PADDING = 4


def _cell(song: Song, font: str, width: float, height: float) -> list[Paragraph]:
    """Title and artist, shrinking the font until they fit in the cell."""
    for size in (9, 8, 7, 6, 5):
        style = ParagraphStyle("cell", fontName=font, fontSize=size, leading=size * 1.15, alignment=TA_CENTER)
        artist_style = ParagraphStyle("artist", parent=style, spaceBefore=size * 0.9)
        paras = [Paragraph(escape(song.title), style), Paragraph(escape(song.artist), artist_style)]
        total = sum(p.wrap(width - 2 * PADDING, height)[1] for p in paras) + artist_style.spaceBefore
        if total <= height - 2 * PADDING:
            break
    return paras


def _draw_plate(c: Canvas, plate: list[Song], title: str, rows: int, cols: int, top: float, slot_height: float, font: str):
    page_width = c._pagesize[0]
    c.setFont(font, TITLE_SIZE)
    c.drawCentredString(page_width / 2, top - TITLE_SIZE, title)

    table_top = top - TITLE_SIZE - 12
    col_width = (page_width - 2 * MARGIN) / cols
    row_height = min(MAX_ROW_HEIGHT, (table_top - (top - slot_height) - 8) / rows)
    data = [[_cell(plate[r * cols + col], font, col_width, row_height) for col in range(cols)] for r in range(rows)]
    table = Table(data, colWidths=[col_width] * cols, rowHeights=[row_height] * rows)
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 1.2, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), PADDING),
                ("RIGHTPADDING", (0, 0), (-1, -1), PADDING),
                ("TOPPADDING", (0, 0), (-1, -1), PADDING),
                ("BOTTOMPADDING", (0, 0), (-1, -1), PADDING),
            ]
        )
    )
    _, h = table.wrapOn(c, page_width, slot_height)
    table.drawOn(c, MARGIN, table_top - h)


def _draw_song_list(c: Canvas, songs: list[Song], title: str, font: str):
    """Host checklist of every song in the game, in two columns."""
    width, height = c._pagesize
    size, leading = 9, 13
    per_column = int((height - 2 * MARGIN - 40) / leading)
    col_width = (width - 2 * MARGIN) / 2
    ordered = sorted(songs, key=lambda s: (s.title.lower(), s.artist.lower()))
    for start in range(0, len(ordered), per_column * 2):
        c.setFont(font, TITLE_SIZE)
        c.drawCentredString(width / 2, height - MARGIN - TITLE_SIZE, f"{title} - song list")
        c.setFont(font, size)
        for i, song in enumerate(ordered[start : start + per_column * 2]):
            x = MARGIN + (i // per_column) * col_width
            y = height - MARGIN - 40 - (i % per_column) * leading
            c.rect(x, y - 1, 8, 8)
            text = f"{song.title} - {song.artist}" if song.artist else song.title
            while c.stringWidth(text, font, size) > col_width - 24 and len(text) > 4:
                text = text[:-4] + "..."
            c.drawString(x + 14, y, text)
        c.showPage()


def build_pdf(plates: list[list[Song]], title: str, rows: int, cols: int, song_list: list[Song] | None = None) -> bytes:
    font = _font()
    buf = io.BytesIO()
    pagesize = landscape(A4)
    c = Canvas(buf, pagesize=pagesize)
    c.setTitle(title)
    per_page = 2 if rows <= 4 else 1
    slot_height = (pagesize[1] - 2 * MARGIN) / per_page

    for i, plate in enumerate(plates):
        slot = i % per_page
        top = pagesize[1] - MARGIN - slot * slot_height
        _draw_plate(c, plate, title, rows, cols, top, slot_height, font)
        if slot == per_page - 1 or i == len(plates) - 1:
            c.showPage()

    if song_list:
        _draw_song_list(c, song_list, title, font)
    c.save()
    return buf.getvalue()
