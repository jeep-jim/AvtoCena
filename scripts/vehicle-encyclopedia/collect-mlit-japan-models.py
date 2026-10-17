#!/usr/bin/env python3
"""Collect source-backed Japan-market model identities from official MLIT workbooks."""

from __future__ import annotations

import hashlib
import io
import json
import re
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import pandas as pd


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
WORKSPACE_ROOT = REPO_ROOT / "data/catalog/vehicle-encyclopedia-v2"
OUTPUT_FILE = WORKSPACE_ROOT / "reports/model-mlit-japan-2015-2026.json"
VERIFIED_AT = "2026-08-17"

PAGES = [
    (2015, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000027.html"),
    (2016, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000031.html"),
    (2017, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000035.html"),
    (2018, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000039.html"),
    (2019, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000044.html"),
    (2020, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000050.html"),
    (2021, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000051.html"),
    (2022, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000055.html"),
    (2023, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000056.html"),
    (2024, "https://www.mlit.go.jp/jidosha/jidosha_tk10_000048.html"),
    (2025, "https://www.mlit.go.jp/jidosha/jidosha_tk10_000050.html"),
    (2026, "https://www.mlit.go.jp/jidosha/jidosha_fr10_000013.html"),
]

JAPANESE_BRANDS = {
    "トヨタ": "toyota",
    "レクサス": "lexus",
    "ニッサン": "nissan",
    "日産": "nissan",
    "ホンダ": "honda",
    "本田": "honda",
    "マツダ": "mazda",
    "三菱": "mitsubishi",
    "スバル": "subaru",
    "スズキ": "suzuki",
    "ダイハツ": "daihatsu",
    "いすゞ": "isuzu",
    "アウディ": "audi",
    "フォルクスワーゲン": "volkswagen",
    "メルセデスベンツ": "mercedes-benz",
    "メルセデス・ベンツ": "mercedes-benz",
    "ビーエムダブリュー": "bmw",
    "ビー・エム・ダブリュー": "bmw",
    "ポルシェ": "porsche",
    "ボルボ": "volvo",
    "ジャガー": "jaguar",
    "ランドローバー": "land-rover",
    "ルノー": "renault",
    "フィアット": "fiat",
    "アルファロメオ": "alfa-romeo",
    "ジープ": "jeep",
    "プジョー": "peugeot",
    "シトロエン": "citroen",
    "シボレー": "chevrolet",
    "クライスラー": "chrysler",
    "テスラ": "tesla",
}


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.href: str | None = None
        self.text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href") or ""
        if re.search(r"\.xlsx?$", href, re.IGNORECASE):
            self.href = href
            self.text = []

    def handle_data(self, data: str) -> None:
        if self.href:
            self.text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.href:
            label = " ".join(" ".join(self.text).split())
            self.links.append((label, self.href))
            self.href = None
            self.text = []


@dataclass(frozen=True)
class WorkbookJob:
    inventory_year: int
    page_url: str
    label: str
    workbook_url: str


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "AvtoCena-Encyclopedia-V2/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    return re.sub(r"[^0-9a-z\u3040-\u30ff\u3400-\u9fff]+", "", text)


def clean_text(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = unicodedata.normalize("NFKC", str(value)).replace("\n", " ")
    text = " ".join(text.split()).strip()
    return text or None


def load_workspace_records(prefix: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for file in sorted((WORKSPACE_ROOT / "chunks").glob(f"{prefix}-*.json")):
        records.extend(json.loads(file.read_text(encoding="utf-8"))["records"])
    return records


def brand_lookup(brands: list[dict[str, Any]]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for brand in brands:
        values = [brand["id"], brand["canonicalName"]]
        values.extend(alias["value"] for alias in brand.get("aliases", []) if alias.get("safe"))
        for value in values:
            result.setdefault(normalize(value), set()).add(brand["id"])
    for value, brand_id in JAPANESE_BRANDS.items():
        result.setdefault(normalize(value), set()).add(brand_id)
    return result


def model_lookup(models: list[dict[str, Any]]) -> dict[tuple[str, str], set[str]]:
    result: dict[tuple[str, str], set[str]] = {}
    for model in models:
        values = [model["canonicalName"]]
        values.extend(alias["value"] for alias in model.get("aliases", []))
        values.extend(alias["value"] for alias in model.get("sourceNames", []))
        for value in values:
            result.setdefault((model["brandId"], normalize(value)), set()).add(model["id"])
    return result


def page_jobs() -> tuple[list[WorkbookJob], list[dict[str, Any]]]:
    jobs: list[WorkbookJob] = []
    pages: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for inventory_year, page_url in PAGES:
        html = fetch_bytes(page_url).decode("utf-8", "replace")
        parser = LinkParser()
        parser.feed(html)
        page_links = []
        for label, href in parser.links:
            workbook_url = urljoin(page_url, href)
            key = (inventory_year, workbook_url)
            if key in seen:
                continue
            seen.add(key)
            page_links.append({"label": label, "url": workbook_url})
            jobs.append(WorkbookJob(inventory_year, page_url, label, workbook_url))
        pages.append({"inventoryYear": inventory_year, "url": page_url, "workbookLinks": len(page_links)})
    return jobs, pages


def first_type_column(frame: pd.DataFrame) -> int | None:
    for row_index in range(min(12, len(frame.index))):
        for column in range(len(frame.columns)):
            value = clean_text(frame.iat[row_index, column])
            if value == "型式" and column >= 2:
                return column
    return None


def is_passenger_sheet(frame: pd.DataFrame) -> bool:
    preview = " ".join(clean_text(value) or "" for value in frame.iloc[:12].to_numpy().flatten())
    return "乗用車" in preview and "貨物車" not in preview and "小型バス" not in preview


def parse_workbook(job: WorkbookJob) -> dict[str, Any]:
    content = fetch_bytes(job.workbook_url)
    checksum = hashlib.sha256(content).hexdigest()
    result: dict[str, Any] = {
        "inventoryYear": job.inventory_year,
        "pageUrl": job.page_url,
        "label": job.label,
        "url": job.workbook_url,
        "sha256": checksum,
        "passengerSheets": 0,
        "observations": [],
        "errors": [],
    }
    try:
        workbook = pd.ExcelFile(io.BytesIO(content))
    except Exception as error:  # source file remains auditable in the report
        result["errors"].append(f"open: {type(error).__name__}: {error}")
        return result

    for sheet_name in workbook.sheet_names:
        try:
            frame = pd.read_excel(io.BytesIO(content), sheet_name=sheet_name, header=None, dtype=object)
        except Exception as error:
            result["errors"].append(f"sheet {sheet_name}: {type(error).__name__}: {error}")
            continue
        if frame.empty or not is_passenger_sheet(frame):
            continue
        type_column = first_type_column(frame)
        if type_column is None:
            result["errors"].append(f"sheet {sheet_name}: vehicle type column not found")
            continue
        result["passengerSheets"] += 1
        current_make = clean_text(sheet_name)
        current_model: str | None = None
        for row_index in range(6, len(frame.index)):
            row = frame.iloc[row_index]
            type_code = clean_text(row.iat[type_column])
            if not type_code or not re.search(r"[A-Z0-9]", type_code, re.IGNORECASE):
                continue
            make_cell = clean_text(row.iat[0])
            if make_cell:
                current_make = make_cell
            model_cells = [clean_text(row.iat[column]) for column in range(1, type_column)]
            model_cells = [value for value in model_cells if value and not re.fullmatch(r"※?\d+", value)]
            if model_cells:
                current_model = model_cells[-1]
            if not current_model:
                continue
            result["observations"].append({
                "sheet": clean_text(sheet_name),
                "sourceMake": current_make,
                "sourceModel": current_model,
                "typeCode": type_code,
            })
    return result


def main() -> None:
    brands = load_workspace_records("brands")
    models = load_workspace_records("models")
    brands_by_id = {brand["id"]: brand for brand in brands}
    brand_terms = brand_lookup(brands)
    model_terms = model_lookup(models)
    jobs, pages = page_jobs()

    workbook_results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(parse_workbook, job): job for job in jobs}
        for index, future in enumerate(as_completed(futures), start=1):
            job = futures[future]
            try:
                workbook_results.append(future.result())
            except Exception as error:
                workbook_results.append({
                    "inventoryYear": job.inventory_year,
                    "pageUrl": job.page_url,
                    "label": job.label,
                    "url": job.workbook_url,
                    "sha256": None,
                    "passengerSheets": 0,
                    "observations": [],
                    "errors": [f"fetch: {type(error).__name__}: {error}"],
                })
            if index % 25 == 0 or index == len(futures):
                print(f"MLIT workbooks {index}/{len(futures)}", flush=True)

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    unresolved_brands: dict[str, dict[str, Any]] = {}
    for workbook in workbook_results:
        for observation in workbook["observations"]:
            candidate_terms = [observation.get("sourceMake"), observation.get("sheet")]
            matches: set[str] = set()
            for term in candidate_terms:
                matches.update(brand_terms.get(normalize(term), set()))
            if len(matches) != 1:
                key = " | ".join(str(value) for value in candidate_terms if value)
                row = unresolved_brands.setdefault(key, {"sourceIdentity": key, "occurrences": 0, "inventoryYears": set(), "workbooks": set(), "matchingBrandIds": set()})
                row["occurrences"] += 1
                row["inventoryYears"].add(workbook["inventoryYear"])
                row["workbooks"].add(workbook["url"])
                row["matchingBrandIds"].update(matches)
                continue
            brand_id = next(iter(matches))
            source_model = observation["sourceModel"]
            key = (brand_id, normalize(source_model))
            row = grouped.setdefault(key, {
                "brandId": brand_id,
                "brand": brands_by_id[brand_id]["canonicalName"],
                "sourceNames": set(),
                "observedInventoryYears": set(),
                "typeCodes": set(),
                "workbooks": set(),
                "pageUrls": set(),
            })
            row["sourceNames"].add(source_model)
            row["observedInventoryYears"].add(workbook["inventoryYear"])
            row["typeCodes"].add(observation["typeCode"])
            row["workbooks"].add(workbook["url"])
            row["pageUrls"].add(workbook["pageUrl"])

    candidates = []
    for key, row in sorted(grouped.items()):
        matches = sorted(model_terms.get(key, set()))
        disposition = "unresolved_english_canonical"
        if len(matches) == 1:
            disposition = "existing_model_exact_alias"
        elif len(matches) > 1:
            disposition = "ambiguous_existing_models"
        candidates.append({
            "brandId": row["brandId"],
            "brand": row["brand"],
            "sourceNames": sorted(row["sourceNames"]),
            "observedInventoryYears": sorted(row["observedInventoryYears"]),
            "typeCodes": sorted(row["typeCodes"]),
            "workbookUrls": sorted(row["workbooks"]),
            "pageUrls": sorted(row["pageUrls"]),
            "disposition": disposition,
            "existingModelIds": matches,
        })

    by_brand = []
    for brand in brands:
        rows = [row for row in candidates if row["brandId"] == brand["id"]]
        by_brand.append({
            "brandId": brand["id"],
            "brand": brand["canonicalName"],
            "mlitModelIdentities": len(rows),
            "exactExistingAliases": sum(row["disposition"] == "existing_model_exact_alias" for row in rows),
            "unresolvedEnglishCanonical": sum(row["disposition"] == "unresolved_english_canonical" for row in rows),
            "ambiguous": sum(row["disposition"] == "ambiguous_existing_models" for row in rows),
        })

    serial_workbooks = []
    for workbook in sorted(workbook_results, key=lambda row: (row["inventoryYear"], row["url"])):
        serial_workbooks.append({key: value for key, value in workbook.items() if key != "observations"} | {"observationRows": len(workbook["observations"])})
    serial_unresolved = []
    for row in sorted(unresolved_brands.values(), key=lambda value: value["sourceIdentity"]):
        serial_unresolved.append({
            "sourceIdentity": row["sourceIdentity"],
            "occurrences": row["occurrences"],
            "inventoryYears": sorted(row["inventoryYears"]),
            "workbooks": sorted(row["workbooks"]),
            "matchingBrandIds": sorted(row["matchingBrandIds"]),
        })

    report = {
        "schemaVersion": 2,
        "generatedAt": VERIFIED_AT,
        "source": {
            "name": "Japan Ministry of Land, Infrastructure, Transport and Tourism annual and current vehicle fuel-efficiency inventories",
            "authority": "国土交通省 / MLIT",
            "market": "Japan",
            "scope": "Passenger-car identities present in official MLIT fuel-efficiency workbooks; pure BEV and models outside these publications require additional official sources.",
        },
        "window": {"market": "Japan", "yearFrom": 2015, "yearTo": 2026},
        "policy": {
            "originalJapaneseNamesPreserved": True,
            "automaticTranslationToCanonicalEnglish": False,
            "typeCodesPreservedForGenerationReview": True,
            "publicationAllowed": False,
            "completionClaimAllowed": False,
        },
        "totals": {
            "v2Brands": len(brands),
            "officialPages": len(pages),
            "workbooksExamined": len(workbook_results),
            "passengerWorkbooks": sum(bool(row["passengerSheets"]) for row in workbook_results),
            "passengerSheets": sum(row["passengerSheets"] for row in workbook_results),
            "sourceObservationRows": sum(row["observationRows"] for row in serial_workbooks),
            "uniqueBrandModelSourceIdentities": len(candidates),
            "brandsWithCandidates": len({row["brandId"] for row in candidates}),
            "exactExistingAliases": sum(row["disposition"] == "existing_model_exact_alias" for row in candidates),
            "unresolvedEnglishCanonical": sum(row["disposition"] == "unresolved_english_canonical" for row in candidates),
            "ambiguousExistingModels": sum(row["disposition"] == "ambiguous_existing_models" for row in candidates),
            "unresolvedBrandIdentities": len(serial_unresolved),
            "workbookErrors": sum(bool(row["errors"]) for row in serial_workbooks),
        },
        "pages": pages,
        "workbooks": serial_workbooks,
        "byBrand": by_brand,
        "candidates": candidates,
        "unresolvedBrandIdentities": serial_unresolved,
    }
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT_FILE), "totals": report["totals"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
