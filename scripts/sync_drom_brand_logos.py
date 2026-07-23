#!/usr/bin/env python3
"""Download and normalize the Drom brand logo library for AvtoCena.

The script reads the canonical brand list from apps/web/lib/catalog/brands.ts,
finds Drom's theme-specific logo assets, converts every logo to a transparent
PNG on the same canvas, and writes a manifest consumed by the web app.
"""

from __future__ import annotations

import ast
import io
import json
import re
import sys
import time
import unicodedata
from collections import deque
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlparse

import requests
from PIL import Image, ImageColor, ImageDraw, ImageFont

try:
    import cairosvg
except Exception:  # pragma: no cover - installed in CI
    cairosvg = None


ROOT = Path(__file__).resolve().parents[1]
BRANDS_FILE = ROOT / "apps/web/lib/catalog/brands.ts"
OUTPUT_ROOT = ROOT / "apps/web/public/brand-logos/drom"
MANIFEST_PATH = OUTPUT_ROOT / "manifest.json"
REPORT_PATH = OUTPUT_ROOT / "sync-report.json"

CANVAS = (180, 90)
CONTENT_BOX = (154, 64)
REQUEST_TIMEOUT = 30
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
)
DROM_ORIGIN = "https://auto.drom.ru"
SOURCE_PAGES = (
    "https://auto.drom.ru/",
    "https://www.drom.ru/",
    "https://moscow.drom.ru/",
)

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/svg+xml,image/png,image/*,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7",
        "Referer": "https://www.drom.ru/",
    }
)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = normalized.lower().replace("&", "and")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def normalized_key(value: str) -> str:
    value = value.lower()
    value = re.sub(r"\.(?:png|svg|webp|jpe?g)(?:\?.*)?$", "", value, flags=re.I)
    value = re.sub(r"\.[a-f0-9]{6,}$", "", value, flags=re.I)
    value = re.sub(r"-(?:dark|light)$", "", value, flags=re.I)
    value = value.replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "", value)


def parse_brands() -> list[dict[str, str]]:
    text = BRANDS_FILE.read_text(encoding="utf-8")
    names_match = re.search(r"const DROM_BRAND_NAMES\s*=\s*\[(.*?)\]\s*as const;", text, re.S)
    if not names_match:
        raise RuntimeError("DROM_BRAND_NAMES was not found")
    names = list(ast.literal_eval("[" + names_match.group(1) + "]"))

    overrides: dict[str, str] = {}
    block = re.search(r"const DROM_SLUG_OVERRIDES[^=]*=\s*\{(.*?)\};", text, re.S)
    if block:
        overrides = dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', block.group(1)))

    slug_overrides: dict[str, str] = {}
    block = re.search(r"const SLUG_OVERRIDES[^=]*=\s*\{(.*?)\};", text, re.S)
    if block:
        slug_overrides = dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', block.group(1)))

    brands = []
    for name in names:
        slug = slug_overrides.get(name) or slugify(name)
        brands.append({"name": name, "slug": slug, "dromSlug": overrides.get(name) or slug})
    return brands


def clean_html(text: str) -> str:
    return (
        text.replace("\\u002f", "/")
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("&#x2F;", "/")
    )


def absolute_drom_url(raw: str) -> str:
    try:
        if raw.startswith("//"):
            raw = "https:" + raw
        absolute = urljoin(DROM_ORIGIN, raw)
        parsed = urlparse(absolute)
        hostname = parsed.hostname.lower() if parsed.hostname else ""
        if hostname != "drom.ru" and not hostname.endswith(".drom.ru"):
            return ""
        return absolute
    except Exception:
        return ""


def collect_logos(text: str, target: dict[str, dict[str, list[str]]]) -> None:
    html = clean_html(text)
    matches = re.findall(
        r'(?:(?:https?:)?//|/)[^"\'<>\s]+?\.(?:png|svg|webp|jpe?g)(?:\?[^"\'<>\s]*)?',
        html,
        flags=re.I,
    )
    for raw in matches:
        url = absolute_drom_url(raw)
        if not url or "/js/bundles/media/" not in url.lower():
            continue
        filename = Path(urlparse(url).path).name
        stem = re.sub(r"\.(?:png|svg|webp|jpe?g)$", "", filename, flags=re.I)
        stem = re.sub(r"\.[a-f0-9]{6,}$", "", stem, flags=re.I)
        theme_match = re.match(r"^(.*?)-(dark|light)$", stem, flags=re.I)
        base = theme_match.group(1) if theme_match else stem
        key = normalized_key(base)
        if not key:
            continue
        theme = theme_match.group(2).lower() if theme_match else "any"
        bucket = target.setdefault(key, {"light": [], "dark": [], "any": []})
        if url not in bucket[theme]:
            bucket[theme].append(url)


def fetch_text(url: str) -> str:
    response = SESSION.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or "utf-8"
    return response.text


def fetch_source_manifest() -> dict[str, dict[str, list[str]]]:
    logos: dict[str, dict[str, list[str]]] = {}
    for page in SOURCE_PAGES:
        try:
            collect_logos(fetch_text(page), logos)
            print(f"Collected Drom media from {page}")
        except Exception as error:
            print(f"Warning: failed to read {page}: {error}", file=sys.stderr)
    return logos


def candidate_urls(
    logos: dict[str, dict[str, list[str]]],
    candidates: list[str],
    theme: str,
) -> list[str]:
    result: list[str] = []
    order = (theme, "any", "dark" if theme == "light" else "light")
    for candidate in candidates:
        found = logos.get(normalized_key(candidate))
        if not found:
            continue
        for source_theme in order:
            for url in found[source_theme]:
                if url not in result:
                    result.append(url)
    return result


def download(url: str) -> tuple[bytes, str]:
    response = SESSION.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.content
    if len(data) < 100:
        raise RuntimeError("downloaded file is unexpectedly small")
    return data, response.headers.get("content-type", "")


def image_from_bytes(data: bytes, source: str, content_type: str) -> Image.Image:
    lower_source = source.lower().split("?", 1)[0]
    if lower_source.endswith(".svg") or "svg" in content_type.lower():
        if cairosvg is None:
            raise RuntimeError("cairosvg is unavailable")
        data = cairosvg.svg2png(bytestring=data, output_width=720, output_height=360)
    image = Image.open(io.BytesIO(data))
    image.load()
    return image.convert("RGBA")


def color_distance(left: tuple[int, int, int, int], right: tuple[int, int, int, int]) -> int:
    return max(abs(left[index] - right[index]) for index in range(3))


def clear_edge_background(image: Image.Image) -> Image.Image:
    """Remove an opaque, nearly uniform edge-connected background only.

    Drom assets are normally transparent. This is a defensive cleanup for a
    small number of raster files whose transparent preview was flattened by an
    upstream format. Interior white or black logo details remain untouched.
    """

    if image.getextrema()[3][0] < 250:
        return image

    width, height = image.size
    pixels = image.load()
    corners = [pixels[0, 0], pixels[width - 1, 0], pixels[0, height - 1], pixels[width - 1, height - 1]]
    reference = tuple(sum(color[index] for color in corners) // len(corners) for index in range(4))
    if max(color_distance(color, reference) for color in corners) > 18:
        return image

    visited: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited:
            continue
        visited.add((x, y))
        color = pixels[x, y]
        if color_distance(color, reference) > 24:
            continue
        pixels[x, y] = (color[0], color[1], color[2], 0)
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return image


def normalize_logo(image: Image.Image) -> Image.Image:
    image = clear_edge_background(image)
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 10 else 0).getbbox()
    if bbox:
        image = image.crop(bbox)
    image.thumbnail(CONTENT_BOX, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    left = (CANVAS[0] - image.width) // 2
    top = (CANVAS[1] - image.height) // 2
    canvas.alpha_composite(image, (left, top))
    return canvas


def fallback_logo(name: str, theme: str) -> Image.Image:
    """Transparent typographic fallback used only when Drom has no logo asset."""

    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    try:
        font = ImageFont.truetype(font_path, 22)
    except Exception:
        font = ImageFont.load_default()
    color = ImageColor.getrgb("#f5f7fb" if theme == "dark" else "#1a1d24") + (255,)
    words = name.split()
    lines = [name]
    if len(name) > 13 and len(words) > 1:
        midpoint = max(1, len(words) // 2)
        lines = [" ".join(words[:midpoint]), " ".join(words[midpoint:])]
    boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    heights = [box[3] - box[1] for box in boxes]
    total_height = sum(heights) + (4 if len(lines) > 1 else 0)
    y = (CANVAS[1] - total_height) // 2
    for line, box, height in zip(lines, boxes, heights):
        width = box[2] - box[0]
        draw.text(((CANVAS[0] - width) // 2, y), line, fill=color, font=font)
        y += height + 4
    return canvas


def save_png(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "PNG", optimize=True, compress_level=9)


def resolve_brand(
    brand: dict[str, str],
    logos: dict[str, dict[str, list[str]]],
) -> tuple[dict[str, Any], list[str]]:
    name, slug, drom_slug = brand["name"], brand["slug"], brand["dromSlug"]
    candidates = [drom_slug, slug, name]
    missing: list[str] = []
    entry: dict[str, Any] = {"name": name, "slug": slug, "dromSlug": drom_slug, "themes": {}}

    if not any(candidate_urls(logos, candidates, theme) for theme in ("light", "dark")):
        for page in (
            f"https://auto.drom.ru/{quote(drom_slug)}/",
            f"https://www.drom.ru/catalog/{quote(drom_slug)}/",
        ):
            try:
                collect_logos(fetch_text(page), logos)
            except Exception:
                pass

    for theme in ("light", "dark"):
        destination = OUTPUT_ROOT / theme / f"{slug}.png"
        used_source = ""
        used_fallback = False
        errors: list[str] = []
        for source in candidate_urls(logos, candidates, theme):
            try:
                data, content_type = download(source)
                image = normalize_logo(image_from_bytes(data, source, content_type))
                if image.getchannel("A").getbbox() is None:
                    raise RuntimeError("image is fully transparent")
                save_png(image, destination)
                used_source = source
                break
            except Exception as error:
                errors.append(f"{source}: {error}")

        if not used_source:
            used_fallback = True
            missing.append(f"{name}:{theme}")
            save_png(fallback_logo(name, theme), destination)

        entry["themes"][theme] = {
            "path": f"/brand-logos/drom/{theme}/{slug}.png",
            "source": used_source or None,
            "fallback": used_fallback,
            "errors": errors[-3:],
        }
    return entry, missing


def main() -> int:
    brands = parse_brands()
    logos = fetch_source_manifest()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    manifest_brands: dict[str, Any] = {}
    missing: list[str] = []
    for index, brand in enumerate(brands, start=1):
        entry, brand_missing = resolve_brand(brand, logos)
        manifest_brands[brand["slug"]] = entry
        missing.extend(brand_missing)
        print(f"[{index:03d}/{len(brands):03d}] {brand['name']}: " + ("fallback" if brand_missing else "Drom"))
        time.sleep(0.03)

    manifest = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "https://www.drom.ru/",
        "canvas": {"width": CANVAS[0], "height": CANVAS[1]},
        "count": len(brands),
        "dromThemeAssets": len(brands) * 2 - len(missing),
        "fallbackThemeAssets": len(missing),
        "brands": manifest_brands,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(
        json.dumps(
            {
                "generatedAt": manifest["generatedAt"],
                "brandCount": len(brands),
                "missing": missing,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Saved {len(brands)} brands to {OUTPUT_ROOT}")
    print(f"Drom theme assets: {manifest['dromThemeAssets']}/{len(brands) * 2}")
    if missing:
        print("Drom assets missing; transparent text fallbacks generated for:")
        print("\n".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
