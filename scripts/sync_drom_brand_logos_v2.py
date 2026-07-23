#!/usr/bin/env python3
"""Enhanced Drom logo synchronization.

The checked-in files under ``apps/web/public/brand-logos/drom-source`` are the
primary source of truth. They are the original transparent Drom assets uploaded
for AvtoCena, including separate light/dark variants where Drom provides them.
If that directory is empty, the script falls back to scanning Drom bundles.
"""

from __future__ import annotations

import mimetypes
import re
import sys
from collections import deque
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlparse

import sync_drom_brand_logos as base


MAX_BUNDLES = 220
LOCAL_SOURCE_ROOT = base.ROOT / "apps/web/public/brand-logos/drom-source"
LOCAL_PREFIX = "local://"
LOGO_ALIASES: dict[str, tuple[str, ...]] = {
    # Neta is the export-facing name used by Hozon; Drom keeps the mark under
    # the manufacturer name.
    "Neta": ("Hozon",),
    "SRM Shineray": ("SRM", "Shineray"),
    "Micro": ("Microcar", "Microlino"),
}


_remote_download = base.download


def download_local_or_remote(source: str) -> tuple[bytes, str]:
    if not source.startswith(LOCAL_PREFIX):
        return _remote_download(source)

    filename = unquote(source[len(LOCAL_PREFIX):])
    root = LOCAL_SOURCE_ROOT.resolve()
    path = (LOCAL_SOURCE_ROOT / filename).resolve()
    if path.parent != root or not path.is_file():
        raise RuntimeError(f"local Drom asset is unavailable: {filename}")
    data = path.read_bytes()
    if len(data) < 100:
        raise RuntimeError(f"local Drom asset is unexpectedly small: {filename}")
    return data, mimetypes.guess_type(path.name)[0] or ""


base.download = download_local_or_remote


def bundle_urls(text: str, base_url: str) -> list[str]:
    cleaned = base.clean_html(text)
    patterns = [
        r'(?:src|href)=["\']([^"\']+\.(?:js|css)(?:\?[^"\']*)?)["\']',
        r'(?:(?:https?:)?//|/)[^"\'<>\s]+?/js/bundles/[^"\'<>\s]+?\.(?:js|css)(?:\?[^"\'<>\s]*)?',
    ]
    found: list[str] = []
    for pattern in patterns:
        for raw in re.findall(pattern, cleaned, flags=re.I):
            absolute = urljoin(base_url, raw)
            parsed = urlparse(absolute)
            hostname = parsed.hostname.lower() if parsed.hostname else ""
            if hostname != "drom.ru" and not hostname.endswith(".drom.ru"):
                continue
            if "/js/bundles/" not in parsed.path.lower():
                continue
            if not re.search(r"\.(?:js|css)$", parsed.path, flags=re.I):
                continue
            if absolute not in found:
                found.append(absolute)
    return found


def collect_local_media(logos: dict[str, dict[str, list[str]]]) -> int:
    """Index the manually uploaded original Drom files without altering them."""

    if not LOCAL_SOURCE_ROOT.is_dir():
        return 0

    added = 0
    supported = {".png", ".svg", ".webp", ".jpg", ".jpeg"}
    for path in sorted(LOCAL_SOURCE_ROOT.iterdir(), key=lambda item: item.name.lower()):
        if not path.is_file() or path.suffix.lower() not in supported:
            continue
        stem = re.sub(r"\.(?:png|svg|webp|jpe?g)$", "", path.name, flags=re.I)
        stem = re.sub(r"\.[a-f0-9]{6,}$", "", stem, flags=re.I)
        theme_match = re.match(r"^(.*?)-(dark|light)$", stem, flags=re.I)
        base_name = theme_match.group(1) if theme_match else stem
        key = base.normalized_key(base_name)
        if not key:
            continue
        theme = theme_match.group(2).lower() if theme_match else "any"
        source = LOCAL_PREFIX + quote(path.name, safe="-._~")
        bucket = logos.setdefault(key, {"light": [], "dark": [], "any": []})
        if source not in bucket[theme]:
            bucket[theme].append(source)
            added += 1
    return added


def collect_bare_media(text: str, bundle_url: str, logos: dict[str, dict[str, list[str]]]) -> int:
    """Resolve webpack media filenames such as audi-dark.<hash>.png."""

    parsed = urlparse(bundle_url)
    if not parsed.scheme or not parsed.netloc:
        return 0
    media_root = f"{parsed.scheme}://{parsed.netloc}/js/bundles/media/"
    cleaned = base.clean_html(text)
    matches = re.findall(
        r'(?<![A-Za-z0-9])([A-Za-z0-9][A-Za-z0-9_%+&().~-]*?\.[a-f0-9]{6,}\.(?:png|svg|webp|jpe?g))(?![A-Za-z0-9])',
        cleaned,
        flags=re.I,
    )
    added = 0
    seen: set[str] = set()
    for raw in matches:
        filename = Path(unquote(raw)).name
        if filename in seen:
            continue
        seen.add(filename)
        url = media_root + quote(filename, safe="-._~%")
        before = sum(len(theme_urls) for item in logos.values() for theme_urls in item.values())
        base.collect_logos(url, logos)
        after = sum(len(theme_urls) for item in logos.values() for theme_urls in item.values())
        if after > before:
            added += 1
    return added


def apply_logo_aliases(logos: dict[str, dict[str, list[str]]]) -> None:
    for brand, aliases in LOGO_ALIASES.items():
        target = base.normalized_key(brand)
        if target in logos:
            continue
        for alias in aliases:
            source = logos.get(base.normalized_key(alias))
            if source:
                logos[target] = {
                    "light": list(source.get("light", [])),
                    "dark": list(source.get("dark", [])),
                    "any": list(source.get("any", [])),
                }
                print(f"Mapped Drom logo alias {brand} -> {alias}")
                break


def enhanced_manifest() -> dict[str, dict[str, list[str]]]:
    logos: dict[str, dict[str, list[str]]] = {}
    local_assets = collect_local_media(logos)
    if local_assets:
        apply_logo_aliases(logos)
        print(f"Using {local_assets} uploaded Drom assets from {LOCAL_SOURCE_ROOT}")
        return logos

    queue: deque[str] = deque()
    visited: set[str] = set()
    bare_assets = 0

    for page in base.SOURCE_PAGES:
        try:
            html = base.fetch_text(page)
            base.collect_logos(html, logos)
            queue.extend(bundle_urls(html, page))
            print(f"Collected Drom HTML media from {page}: {len(logos)} logo keys")
        except Exception as error:
            print(f"Warning: failed to read {page}: {error}", file=sys.stderr)

    while queue and len(visited) < MAX_BUNDLES:
        url = queue.popleft()
        if url in visited:
            continue
        visited.add(url)
        try:
            payload = base.fetch_text(url)
            base.collect_logos(payload, logos)
            bare_assets += collect_bare_media(payload, url, logos)
            for linked in bundle_urls(payload, url):
                if linked not in visited:
                    queue.append(linked)
            if len(visited) % 10 == 0:
                print(
                    f"Scanned {len(visited)} Drom bundles; "
                    f"{len(logos)} logo keys and {bare_assets} bare media assets found"
                )
        except Exception as error:
            print(f"Warning: failed to scan bundle {url}: {error}", file=sys.stderr)

    apply_logo_aliases(logos)
    print(
        f"Bundle scan complete: {len(visited)} bundles, "
        f"{len(logos)} logo keys, {bare_assets} bare media assets"
    )
    return logos


base.fetch_source_manifest = enhanced_manifest
raise SystemExit(base.main())
