"""
Gera os arquivos da marca a partir da logo oficial (apps/web/brand-source/logo-original.webp)
e do icone do app (apps/web/brand-source/icone-original.png).

    python3 scripts/brand/build-logos.py

Saidas em apps/web/public/brand/ e favicons em apps/web/public/:

- logo.webp          logo completa, fundo transparente (para fundo claro)
- logo-branca.webp   igual, com o texto escuro trocado por branco (para fundo escuro)
- logo-icone.webp    so o simbolo, fundo transparente
- favicon-48.png, favicon-192.png, icon-512.png   icone do app (icone-original.png), cantos transparentes
- apple-touch-icon.png   o mesmo, quadrado cheio para o iOS

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


# --- icone do app (quadrado arredondado oficial) --------------------------
# Origem: apps/web/brand-source/icone-original.png. Os cantos fora do quadrado
# arredondado sao brancos; para favicon ficam transparentes (preenchimento a
# partir dos cantos, que nao entra no desenho porque a borda azul o fecha).
from PIL import ImageDraw, ImageFilter

ICON_SRC = ROOT / "apps/web/brand-source/icone-original.png"
app = Image.open(ICON_SRC).convert("RGB")

marked = app.copy()
for corner in [(0, 0), (app.width - 1, 0), (0, app.height - 1), (app.width - 1, app.height - 1)]:
    ImageDraw.floodfill(marked, corner, (255, 0, 255), thresh=14)
outside = np.asarray(marked)[..., :3]
is_bg = (outside[..., 0] == 255) & (outside[..., 1] == 0) & (outside[..., 2] == 255)
mask = Image.fromarray(np.where(is_bg, 0, 255).astype(np.uint8), "L")
# Erode 2 px (some o fiapo branco da borda) e suaviza.
mask = mask.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
app_rgba = app.convert("RGBA")
app_rgba.putalpha(mask)


def save_png(im: Image.Image, name: str, size: int) -> None:
    out = im.resize((size, size), Image.LANCZOS)
    out.save(PUBLIC / name, "PNG", optimize=True)
    print(f"{name}: {out.size}")


save_png(app_rgba, "favicon-48.png", 48)
save_png(app_rgba, "favicon-192.png", 192)
save_png(app_rgba, "icon-512.png", 512)

# iOS aplica a propria mascara arredondada e nao aceita transparencia: quadrado
# cheio, cortando 4% de cada lado (o raio do iOS e maior que o do desenho, entao
# os cantos brancos ficam fora da mascara).
inset = round(app.width * 0.04)
cropped = app.crop((inset, inset, app.width - inset, app.height - inset))
cropped.resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png", "PNG", optimize=True)
print("apple-touch-icon.png: (180, 180)")
