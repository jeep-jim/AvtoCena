#!/usr/bin/env python3
"""Normalize staged brand logos to the Encyclopedia V2 90x60 PNG contract.

The default input is the existing read-only site asset library. Output is written
only to the isolated V2 staging workspace. The visible mark keeps its aspect
ratio and is centered on a transparent canvas; no text fallback is generated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
WORKSPACE_ROOT = REPO_ROOT / "data" / "catalog" / "vehicle-encyclopedia-v2"
DEFAULT_SOURCE_ROOT = REPO_ROOT / "apps" / "web" / "public" / "brand-logos" / "drom"
DEFAULT_SOURCE_MANIFEST = DEFAULT_SOURCE_ROOT / "manifest.json"
DEFAULT_OUTPUT_ROOT = WORKSPACE_ROOT / "assets" / "brand-logos"
DEFAULT_REPORT = WORKSPACE_ROOT / "reports" / "brand-logo-assets.json"
DEFAULT_SUPPLEMENTAL_MANIFEST = WORKSPACE_ROOT / "research" / "brand-logo-supplemental.json"

CANVAS = (90, 60)
CONTENT_BOX = (82, 52)
THEMES = ("dark", "light")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--source-manifest", type=Path, default=DEFAULT_SOURCE_MANIFEST)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--supplemental-manifest", type=Path, default=DEFAULT_SUPPLEMENTAL_MANIFEST)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def visible_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A")
    return alpha.point(lambda value: 255 if value > 3 else 0).getbbox()


def normalize(source: Path, destination: Path) -> dict[str, Any]:
    with Image.open(source) as raw:
        input_format = raw.format
        input_size = raw.size
        image = raw.convert("RGBA")

    bbox = visible_bbox(image)
    if bbox is None:
        raise ValueError(f"Logo is fully transparent: {source}")

    image = image.crop(bbox)
    image.thumbnail(CONTENT_BOX, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    left = (CANVAS[0] - image.width) // 2
    top = (CANVAS[1] - image.height) // 2
    canvas.alpha_composite(image, (left, top))

    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "PNG", optimize=True, compress_level=9)

    with Image.open(destination) as check:
        if check.size != CANVAS or check.format != "PNG" or check.mode != "RGBA":
            raise ValueError(f"Normalized logo violates the 90x60 RGBA PNG contract: {destination}")
        output_bbox = visible_bbox(check.convert("RGBA"))

    return {
        "inputFormat": input_format,
        "inputWidthPx": input_size[0],
        "inputHeightPx": input_size[1],
        "outputWidthPx": CANVAS[0],
        "outputHeightPx": CANVAS[1],
        "outputMode": "RGBA",
        "visibleBoundsPx": list(output_bbox) if output_bbox else None,
        "sha256": sha256(destination),
    }


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"brands": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def relative_to_repo(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def main() -> int:
    args = parse_args()
    source_manifest = load_manifest(args.source_manifest)
    manifest_brands = source_manifest.get("brands", {})
    assets: dict[str, Any] = {}

    for theme in THEMES:
        theme_root = args.source_root / theme
        if not theme_root.is_dir():
            raise FileNotFoundError(f"Missing source theme directory: {theme_root}")
        for source in sorted(theme_root.glob("*.png")):
            slug = source.stem
            destination = args.output_root / theme / f"{slug}.png"
            details = normalize(source, destination)
            source_theme = manifest_brands.get(slug, {}).get("themes", {}).get(theme, {})
            entry = assets.setdefault(slug, {"slug": slug, "themes": {}})
            entry["themes"][theme] = {
                "assetPath": relative_to_repo(destination).split("data/catalog/vehicle-encyclopedia-v2/", 1)[-1],
                "inputPath": relative_to_repo(source),
                "source": source_theme.get("source"),
                "sourceManifestKnown": slug in manifest_brands,
                "fallback": source_theme.get("fallback"),
                **details,
            }

    supplemental_manifest = load_manifest(args.supplemental_manifest)
    supplemental_source_root = REPO_ROOT / supplemental_manifest.get("sourceRoot", "")
    supplemental_inputs = 0
    for slug, brand in sorted(supplemental_manifest.get("brands", {}).items()):
        entry = assets.setdefault(slug, {"slug": slug, "themes": {}})
        for theme in THEMES:
            source_theme = brand.get("themes", {}).get(theme)
            if not source_theme:
                continue
            source = supplemental_source_root / source_theme["file"]
            destination = args.output_root / theme / f"{slug}.png"
            details = normalize(source, destination)
            entry["themes"][theme] = {
                "assetPath": relative_to_repo(destination).split("data/catalog/vehicle-encyclopedia-v2/", 1)[-1],
                "inputPath": relative_to_repo(source),
                "source": source_theme.get("source"),
                "sourceManifestKnown": True,
                "fallback": source_theme.get("fallback"),
                **details,
            }
            supplemental_inputs += 1

    rows = []
    for slug in sorted(assets):
        entry = assets[slug]
        themes = entry["themes"]
        entry["pairComplete"] = all(theme in themes for theme in THEMES)
        entry["formatReady"] = entry["pairComplete"] and all(
            themes[theme]["outputWidthPx"] == CANVAS[0]
            and themes[theme]["outputHeightPx"] == CANVAS[1]
            and themes[theme]["outputMode"] == "RGBA"
            for theme in THEMES
        )
        entry["sourceTraceComplete"] = entry["pairComplete"] and all(
            bool(themes[theme].get("source")) for theme in THEMES
        )
        entry["fallbackFree"] = entry["pairComplete"] and all(
            themes[theme].get("fallback") is False for theme in THEMES
        )
        rows.append(entry)

    source_files = sum(len(list((args.source_root / theme).glob("*.png"))) for theme in THEMES) + supplemental_inputs
    output_files = sum(len(list((args.output_root / theme).glob("*.png"))) for theme in THEMES)
    report = {
        "schemaVersion": 1,
        "productionConnected": False,
        "standard": {
            "format": "PNG",
            "mode": "RGBA",
            "canvasPx": {"width": CANVAS[0], "height": CANVAS[1]},
            "contentBoxPx": {"width": CONTENT_BOX[0], "height": CONTENT_BOX[1]},
            "preserveAspectRatio": True,
            "generatedOrTextFallbackAllowed": False,
        },
        "inputs": {
            "sourceRoot": relative_to_repo(args.source_root),
            "sourceManifest": relative_to_repo(args.source_manifest),
            "supplementalManifest": relative_to_repo(args.supplemental_manifest),
            "sourceFiles": source_files,
        },
        "outputs": {
            "outputRoot": relative_to_repo(args.output_root),
            "outputFiles": output_files,
            "brandAssets": len(rows),
            "completeThemePairs": sum(1 for row in rows if row["pairComplete"]),
            "exactFormatPairs": sum(1 for row in rows if row["formatReady"]),
            "sourceTraceCompletePairs": sum(1 for row in rows if row["sourceTraceComplete"]),
            "fallbackFreePairs": sum(1 for row in rows if row["fallbackFree"]),
        },
        "rightsStatus": "review_required",
        "publicationNote": "Technical normalization does not grant publication rights. Each trademark asset remains blocked until source and rights review is cleared.",
        "assets": rows,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["outputs"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
