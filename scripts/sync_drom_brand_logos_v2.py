#!/usr/bin/env python3
"""Enhanced Drom logo synchronization.

Drom keeps most logo URLs inside compiled JS/CSS bundles rather than directly
in the initial HTML. This wrapper recursively scans those same-origin bundles,
resolves both absolute media URLs and webpack's bare hashed filenames, then
delegates normalization and manifest generation to the base synchronizer.
"""

from __future__ import annotations

import re
import sys
from collections import deque
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlparse

import sync_drom_brand_logos as base


MAX_BUNDLES = 220


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


def collect_bare_media(text: str, bundle_url: str, logos: dict[str, dict[str, list[str]]]) -> int:
    """Resolve webpack media filenames such as audi-dark.<hash>.png.

    In production bundles Drom often stores only the hashed filename and joins
    it with the public media path at runtime. The browser therefore sees the
    correct transparent file while a simple HTML URL scraper misses it.
    """

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


def enhanced_manifest() -> dict[str, dict[str, list[str]]]:
    logos: dict[str, dict[str, list[str]]] = {}
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

    print(
        f"Bundle scan complete: {len(visited)} bundles, "
        f"{len(logos)} logo keys, {bare_assets} bare media assets"
    )
    return logos


base.fetch_source_manifest = enhanced_manifest
raise SystemExit(base.main())
