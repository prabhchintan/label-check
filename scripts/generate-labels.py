#!/usr/bin/env python3
"""
Demo label generator.

Renders the 8-label demo set as PNGs with pixel-perfect control over the
government warning text (the precision traps, title-case prefix, reworded
statement, missing warning, cannot be sourced reliably from real registry
images, so they are rendered synthetically).

Outputs:
  public/demo-labels/label-N-*.png
  public/demo-labels/manifest.json        (demo gallery: fields, expected outcome, story)
  src/extract/mockData.ts                 (hash-keyed extractions for mock mode)

Run: python3 scripts/generate-labels.py   (requires Pillow)
"""

import hashlib
import io
import json
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "demo-labels")
os.makedirs(OUT, exist_ok=True)

STATUTORY = (
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not "
    "drink alcoholic beverages during pregnancy because of the risk of birth "
    "defects. (2) Consumption of alcoholic beverages impairs your ability to "
    "drive a car or operate machinery, and may cause health problems."
)
TITLE_CASE = STATUTORY.replace("GOVERNMENT WARNING:", "Government Warning:")
REWORDED = (
    "GOVERNMENT WARNING: Drinking alcoholic beverages during pregnancy can cause "
    "birth defects. Alcohol impairs your ability to drive or operate machinery "
    "and may cause health problems."
)

FONT_DIRS = [
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation",
    "/System/Library/Fonts",
]


def font(name_candidates, size):
    for d in FONT_DIRS:
        for n in name_candidates:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def serif_bold(s):
    return font(["DejaVuSerif-Bold.ttf", "LiberationSerif-Bold.ttf"], s)


def serif(s):
    return font(["DejaVuSerif.ttf", "LiberationSerif-Regular.ttf"], s)


def sans(s):
    return font(["DejaVuSans.ttf", "LiberationSans-Regular.ttf"], s)


def sans_bold(s):
    return font(["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"], s)


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_warning(draw, x, y, max_w, warning_text, bold_prefix=True, fnt_size=17):
    """Render warning with bold 'GOVERNMENT WARNING:' prefix (if it exists) and regular body."""
    fb, fr = sans_bold(fnt_size), sans(fnt_size)
    lh = fnt_size + 5
    # Split prefix (first two words + colon) from body for mixed-weight rendering.
    parts = warning_text.split(" ", 2)
    prefix = " ".join(parts[:2]) if len(parts) >= 2 else warning_text
    body = parts[2] if len(parts) > 2 else ""
    pf = fb if bold_prefix else fr
    # Build lines word by word with per-word font.
    words = [(w, pf) for w in prefix.split()] + [(w, fr) for w in body.split()]
    cx, cy = x, y
    for w, f in words:
        wlen = draw.textlength(w + " ", font=f)
        if cx + wlen > x + max_w:
            cx, cy = x, cy + lh
        draw.text((cx, cy), w, font=f, fill=(20, 20, 20))
        cx += wlen
    return cy + lh


def base_label(w=900, h=1200, bg=(245, 240, 228)):
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, w - 20, h - 20], outline=(120, 90, 40), width=4)
    d.rectangle([32, 32, w - 32, h - 32], outline=(120, 90, 40), width=2)
    return img, d


def spirits_label(
    brand="OLD TOM DISTILLERY",
    class_type="Kentucky Straight Bourbon Whiskey",
    abv_text="45% Alc./Vol. (90 Proof)",
    net="750 mL",
    warning=STATUTORY,
    bold_prefix=True,
    producer="Distilled and Bottled by Old Tom Distillery, Bardstown, Kentucky",
):
    img, d = base_label()
    w = img.width
    y = 90
    d.text((w // 2, y), "EST. 1887", font=serif(26), fill=(120, 90, 40), anchor="mm")
    y += 70
    # Brand (possibly two lines)
    bf = serif_bold(64)
    for line in wrap(d, brand, bf, w - 140):
        d.text((w // 2, y), line, font=bf, fill=(60, 40, 20), anchor="mm")
        y += 78
    y += 8
    d.line([120, y, w - 120, y], fill=(120, 90, 40), width=3)
    y += 50
    cf = serif(34)
    for line in wrap(d, class_type, cf, w - 160):
        d.text((w // 2, y), line, font=cf, fill=(70, 50, 30), anchor="mm")
        y += 46
    y += 30
    d.text((w // 2, y), abv_text, font=sans_bold(30), fill=(40, 40, 40), anchor="mm")
    y += 55
    d.text((w // 2, y), net, font=sans(28), fill=(40, 40, 40), anchor="mm")
    y += 70
    d.line([120, y, w - 120, y], fill=(120, 90, 40), width=2)
    y += 35
    pf = sans(16)
    for line in wrap(d, producer, pf, w - 200):
        d.text((w // 2, y), line, font=pf, fill=(80, 80, 80), anchor="mm")
        y += 24
    # Warning block at bottom
    if warning:
        wy = img.height - 250
        d.line([80, wy - 25, w - 80, wy - 25], fill=(150, 150, 150), width=1)
        draw_warning(d, 80, wy, w - 160, warning, bold_prefix=bold_prefix)
    return img


def perspective_glare(img):
    """Mild angle + glare for the 'bad photo' demo label."""
    w, h = img.size
    img = img.convert("RGB")
    # Perspective: squeeze right edge
    coeffs = find_coeffs(
        [(0, 0), (w, 60), (w, h - 60), (0, h)],
        [(0, 0), (w, 0), (w, h), (0, h)],
    )
    img = img.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(200, 198, 192))
    # Diagonal glare streak
    glare = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glare)
    gd.polygon([(w * 0.25, 0), (w * 0.45, 0), (w * 0.75, h), (w * 0.55, h)], fill=110)
    glare = glare.filter(ImageFilter.GaussianBlur(60))
    white = Image.new("RGB", (w, h), (255, 255, 255))
    img = Image.composite(white, img, glare)
    # Slight warm tint + noise
    px = img.load()
    random.seed(7)
    for _ in range(4000):
        x, y = random.randrange(w), random.randrange(h)
        r, g, b = px[x, y]
        n = random.randint(-12, 12)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img


def find_coeffs(pa, pb):
    matrix = []
    for p1, p2 in zip(pa, pb):
        matrix.append([p2[0], p2[1], 1, 0, 0, 0, -p1[0] * p2[0], -p1[0] * p2[1]])
        matrix.append([0, 0, 0, p2[0], p2[1], 1, -p1[1] * p2[0], -p1[1] * p2[1]])
    import numpy as np

    A = np.array(matrix, dtype=float)
    B = np.array([c for p in pa for c in p], dtype=float)
    res = np.linalg.lstsq(A, B, rcond=None)[0]
    return tuple(res)


# ---------------------------------------------------------------------------
# The 8 demo labels (STRATEGY §6). Each entry: filename, render kwargs,
# application-form fields, the extraction the mock provider returns, expected
# tier, and the one-line story shown in the demo gallery.
# ---------------------------------------------------------------------------

def extraction(brand, class_type, abv, net, warning_text, bold=True, present=True,
               producer="Distilled and Bottled by Old Tom Distillery, Bardstown, Kentucky",
               quality_note=None):
    return {
        "brand_name": brand,
        "class_type": class_type,
        "alcohol_statement": abv,
        "net_contents": net,
        "warning": {"present": present, "text": warning_text, "appears_bold": bold if present else "unknown"},
        "producer_name": producer,
        "country_of_origin": None,
        "image_quality_note": quality_note,
    }


DEMOS = [
    {
        "id": "happy-path",
        "file": "label-1-happy-path.png",
        "title": "Clean bourbon label, everything matches",
        "story": "The happy path: every field matches, verified in seconds.",
        "render": dict(),
        "app": {"brand_name": "OLD TOM DISTILLERY", "class_type": "Kentucky Straight Bourbon Whiskey", "abv": "45%", "net_contents": "750 mL"},
        "extract": extraction("OLD TOM DISTILLERY", "Kentucky Straight Bourbon Whiskey", "45% Alc./Vol. (90 Proof)", "750 mL", STATUTORY),
        "expected": "GREEN",
    },
    {
        "id": "stones-throw",
        "file": "label-2-stones-throw.png",
        "title": "STONE'S THROW vs Stone's Throw",
        "story": "Dave's nuance: all-caps on the label, title case in the application, same brand, and the tool explains why.",
        "render": dict(brand="STONE'S THROW", class_type="Straight Rye Whiskey", abv_text="46% Alc./Vol. (92 Proof)", producer="Distilled and Bottled by Stone's Throw Distilling Co., Frankfort, Kentucky"),
        "app": {"brand_name": "Stone's Throw", "class_type": "Straight Rye Whiskey", "abv": "46%", "net_contents": "750 mL"},
        "extract": extraction("STONE'S THROW", "Straight Rye Whiskey", "46% Alc./Vol. (92 Proof)", "750 mL", STATUTORY, producer="Distilled and Bottled by Stone's Throw Distilling Co., Frankfort, Kentucky"),
        "expected": "GREEN",
    },
    {
        "id": "title-case-warning",
        "file": "label-3-title-case-warning.png",
        "title": "Warning in Title Case",
        "story": "Jenny's exact catch: \"Government Warning:\" in title case instead of all caps. Rejected.",
        "render": dict(brand="RIVERBEND RESERVE", class_type="Small Batch Bourbon Whiskey", abv_text="43% Alc./Vol. (86 Proof)", warning=TITLE_CASE, producer="Riverbend Reserve Distilling, Louisville, Kentucky"),
        "app": {"brand_name": "RIVERBEND RESERVE", "class_type": "Small Batch Bourbon Whiskey", "abv": "43%", "net_contents": "750 mL"},
        "extract": extraction("RIVERBEND RESERVE", "Small Batch Bourbon Whiskey", "43% Alc./Vol. (86 Proof)", "750 mL", TITLE_CASE, producer="Riverbend Reserve Distilling, Louisville, Kentucky"),
        "expected": "RED",
    },
    {
        "id": "reworded-warning",
        "file": "label-4-reworded-warning.png",
        "title": "Reworded warning statement",
        "story": "Zero tolerance: the warning is paraphrased. The statute requires the exact words, rejected, with the first difference highlighted.",
        "render": dict(brand="SILVER CREEK", class_type="American Single Malt Whiskey", abv_text="44% Alc./Vol. (88 Proof)", warning=REWORDED, producer="Silver Creek Spirits, Asheville, North Carolina"),
        "app": {"brand_name": "SILVER CREEK", "class_type": "American Single Malt Whiskey", "abv": "44%", "net_contents": "750 mL"},
        "extract": extraction("SILVER CREEK", "American Single Malt Whiskey", "44% Alc./Vol. (88 Proof)", "750 mL", REWORDED, producer="Silver Creek Spirits, Asheville, North Carolina"),
        "expected": "RED",
    },
    {
        "id": "abv-mismatch",
        "file": "label-5-abv-mismatch.png",
        "title": "ABV mismatch (43% vs 45%)",
        "story": "The core matching job: application says 45%, label says 43%. Caught instantly by code, not AI.",
        "render": dict(brand="COPPER STILL", class_type="Kentucky Straight Bourbon Whiskey", abv_text="43% Alc./Vol. (86 Proof)", producer="Copper Still Distillery, Lexington, Kentucky"),
        "app": {"brand_name": "COPPER STILL", "class_type": "Kentucky Straight Bourbon Whiskey", "abv": "45%", "net_contents": "750 mL"},
        "extract": extraction("COPPER STILL", "Kentucky Straight Bourbon Whiskey", "43% Alc./Vol. (86 Proof)", "750 mL", STATUTORY, producer="Copper Still Distillery, Lexington, Kentucky"),
        "expected": "RED",
    },
    {
        "id": "bad-photo",
        "file": "label-6-bad-photo.png",
        "title": "Photographed at an angle, with glare",
        "story": "Jenny's stretch goal: a less-than-perfect photo. The pipeline reads it anyway, and catches a real gap: the label says 'Imported by' but names no country of origin.",
        "render": dict(brand="HARBOR LIGHT", class_type="Blended Canadian Whisky", abv_text="40% Alc./Vol. (80 Proof)", producer="Imported by Harbor Light Imports, Seattle, Washington"),
        "post": "perspective_glare",
        "app": {"brand_name": "HARBOR LIGHT", "class_type": "Blended Canadian Whisky", "abv": "40%", "net_contents": "750 mL"},
        "extract": extraction("HARBOR LIGHT", "Blended Canadian Whisky", "40% Alc./Vol. (80 Proof)", "750 mL", STATUTORY, producer="Imported by Harbor Light Imports, Seattle, Washington", quality_note="Image is photographed at an angle with a glare streak; text remained legible."),
        "expected": "YELLOW",
    },
    {
        "id": "missing-warning",
        "file": "label-7-missing-warning.png",
        "title": "No warning statement at all",
        "story": "The mandatory element is simply absent. Hard stop.",
        "render": dict(brand="MIDNIGHT ROOSTER", class_type="Spiced Rum", abv_text="35% Alc./Vol. (70 Proof)", warning=None, producer="Midnight Rooster Rum Co., Tampa, Florida"),
        "app": {"brand_name": "MIDNIGHT ROOSTER", "class_type": "Spiced Rum", "abv": "35%", "net_contents": "750 mL"},
        "extract": extraction("MIDNIGHT ROOSTER", "Spiced Rum", "35% Alc./Vol. (70 Proof)", "750 mL", None, present=False, producer="Midnight Rooster Rum Co., Tampa, Florida"),
        "expected": "RED",
    },
    {
        "id": "net-contents-format",
        "file": "label-8-net-contents.png",
        "title": "750ml vs 750 mL",
        "story": "Normalization smarts: same quantity, different formatting. Match, with the equivalence spelled out.",
        "render": dict(brand="JUNIPER & PINE", class_type="London Dry Gin", abv_text="47% Alc./Vol. (94 Proof)", net="750ml", producer="Juniper & Pine Distillers, Portland, Oregon"),
        "app": {"brand_name": "JUNIPER & PINE", "class_type": "London Dry Gin", "abv": "47%", "net_contents": "750 mL"},
        "extract": extraction("JUNIPER & PINE", "London Dry Gin", "47% Alc./Vol. (94 Proof)", "750ml", STATUTORY, producer="Juniper & Pine Distillers, Portland, Oregon"),
        "expected": "GREEN",
    },
]


def main():
    manifest = []
    mock_entries = []
    for d in DEMOS:
        img = spirits_label(**d["render"])
        if d.get("post") == "perspective_glare":
            img = perspective_glare(img)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        path = os.path.join(OUT, d["file"])
        with open(path, "wb") as f:
            f.write(data)
        sha = hashlib.sha256(data).hexdigest()
        manifest.append({
            "id": d["id"],
            "title": d["title"],
            "story": d["story"],
            "image": f"demo-labels/{d['file']}",
            "application": d["app"],
            "expected": d["expected"],
        })
        mock_entries.append((sha, d["extract"], d["id"]))
        print(f"  {d['file']}  {len(data)//1024} KB  sha256={sha[:12]}…")

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    ts = [
        "/**",
        " * GENERATED FILE, do not edit by hand.",
        " * Produced by scripts/generate-labels.py alongside the demo label images.",
        " * Maps SHA-256(image bytes) → the extraction the mock provider returns,",
        " * so the deployed demo works end-to-end without an API key.",
        " */",
        "",
        'import type { LabelExtraction } from "./types";',
        "",
        "export const DEMO_EXTRACTIONS: Record<string, LabelExtraction> = {",
    ]
    for sha, ext, demo_id in mock_entries:
        ts.append(f"  // {demo_id}")
        ts.append(f'  "{sha}": {json.dumps(ext, indent=2)},')
    ts.append("};")
    with open(os.path.join(ROOT, "src", "extract", "mockData.ts"), "w") as f:
        f.write("\n".join(ts) + "\n")
    print(f"\nWrote manifest.json ({len(manifest)} entries) and src/extract/mockData.ts")


if __name__ == "__main__":
    main()
