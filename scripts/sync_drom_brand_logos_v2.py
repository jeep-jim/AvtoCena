#!/usr/bin/env python3
"""Enhanced Drom logo synchronization.

Drom keeps most logo URLs inside compiled JS/CSS bundles rather than directly
in the initial HTML. This wrapper recursively scans those same-origin bundles,
then delegates normalization and manifest generation to the base synchronizer.
"""

from __future__ import annotations

import re
import sys
from collections import deque
from urllib.parse import urljoin, urlparse

import sync_drom_brand_logos as base


MAX_BUNDLES = 180


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


def enhanced_manifest() -> dict[str, dict[str, list[str]]]:
    logos: dict[str, dict[str, list[str]]] = {}
    queue: deque[str] = deque()
    visited: set[str] = set()

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
            for linked in bundle_urls(payload, url):
                if linked not in visited:
                    queue.append(linked)
            if len(visited) % 10 == 0:
                print(f"Scanned {len(visited)} Drom bundles; {len(logos)} logo keys found")
        except Exception as error:
            print(f"Warning: failed to scan bundle {url}: {error}", file=sys.stderr)

    print(f"Bundle scan complete: {len(visited)} bundles, {len(logos)} logo keys")
    return logos


base.fetch_source_manifest = enhanced_manifest
raise SystemExit(base.main())
