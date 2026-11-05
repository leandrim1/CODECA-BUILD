"""
Gera os arquivos da marca a partir da logo oficial (apps/web/brand-source/logo-original.webp).

    python3 scripts/brand/build-logos.py

Saidas em apps/web/public/brand/ e favicons em apps/web/public/:

- logo.webp          logo completa, fundo transparente (para fundo claro)
- logo-branca.webp   igual, com o texto escuro trocado por branco (para fundo escuro)
- logo-icone.webp    so o simbolo, fundo transparente
- favicon-48.png, favicon-192.png, apple-touch-icon.png   simbolo sobre quadrado branco

Fundo transparente por "cor para alfa" (a cor-chave e o branco): composto sobre
branco o resultado e IDENTICO ao arquivo original, sem halo nas bordas. Requer
Pillow e numpy.
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps/web/brand-source/logo-original.webp"
OUT = ROOT / "apps/web/public/brand"
PUBLIC = ROOT / "apps/web/public"

img = np.asarray(Image.open(SRC).convert("RGB"), dtype=np.float64)

# --- cor para alfa (chave: branco) -----------------------------------------
alpha = ((255.0 - img) / 255.0).max(axis=2)
alpha[alpha < 0.03] = 0.0  # ruido de compressao do fundo (~254)
safe = np.where(alpha > 0, alpha, 1.0)[..., None]
color = np.clip((img - 255.0 * (1.0 - safe)) / safe, 0, 255)
rgba = np.dstack([color, alpha * 255.0]).round().astype(np.uint8)
full = Image.fromarray(rgba, "RGBA")


def trim(im: Image.Image, pad: int) -> Image.Image:
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    x0, y0, x1, y1 = box
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


# --- logo completa ----------------------------------------------------------
logo = trim(full, pad=6)

# --- versao para fundo escuro: o texto escuro (navy/cinza) vira branco ------
arr = np.asarray(logo, dtype=np.float64).copy()
r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
# O azul da marca tem b - r grande; o texto navy/cinza tem b - r pequeno e e escuro.
dark_text = (np.maximum(np.maximum(r, g), b) < 150) & ((b - r) < 90)
arr[..., 0:3][dark_text] = 255
logo_white = Image.fromarray(arr.round().astype(np.uint8), "RGBA")

# --- simbolo ---------------------------------------------------------------
# Regiao do simbolo na imagem original (hexagono + </>), antes do texto.
orig_icon = full.crop((140, 105, 575, 550))
icon = trim(orig_icon, pad=4)


def save_webp(im: Image.Image, name: str, width: int) -> None:
    ratio = width / im.width
    out = im.resize((width, max(1, round(im.height * ratio))), Image.LANCZOS)
    out.save(OUT / name, "WEBP", quality=92, method=6)
    print(f"{name}: {out.size}")


save_webp(logo, "logo.webp", 960)
save_webp(logo_white, "logo-branca.webp", 960)
save_webp(icon, "logo-icone.webp", 256)


def tile(size: int, name: str, radius_ratio: float, margin: float) -> None:
    """Simbolo centralizado sobre quadrado branco (favicons precisam de fundo legivel)."""
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    from PIL import ImageDraw

    ImageDraw.Draw(canvas).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=(255, 255, 255, 255))
    inner = int(size * (1 - 2 * margin))
    scale = min(inner / icon.width, inner / icon.height)
    glyph = icon.resize((round(icon.width * scale), round(icon.height * scale)), Image.LANCZOS)
    canvas.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
    canvas.save(PUBLIC / name, "PNG", optimize=True)
    print(f"{name}: {canvas.size}")


tile(48, "favicon-48.png", 0.18, 0.08)
tile(192, "favicon-192.png", 0.18, 0.08)
# iOS arredonda sozinho: quadrado cheio, sem raio.
tile(180, "apple-touch-icon.png", 0.0, 0.12)
