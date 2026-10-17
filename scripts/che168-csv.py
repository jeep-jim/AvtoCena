"""Strict streaming reader: quoted pipes/newlines and Unicode are CSV, not split()."""
import csv
import io
import json
import sys


def parse(stream, year_from):
    csv.field_size_limit(16 * 1024 * 1024)
    reader = csv.DictReader(stream, delimiter="|", strict=True)
    required = {"inner_id", "url", "mark", "model", "year", "price", "images", "extra"}
    if not required.issubset(reader.fieldnames or []) or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError("header")
    total = selected = 0
    for row in reader:
        total += 1
        if None in row or any(value is None for value in row.values()):
            raise ValueError("columns")
        # Only unequivocally older years can be skipped early. Invalid/missing
        # years still reach the existing quarantine/admission checks.
        if row["year"].isdigit() and 1900 <= int(row["year"]) < year_from:
            continue
        extra = (json.loads(row["extra"]) if row["extra"] else None) or {}
        images = (json.loads(row["images"]) if row["images"] else None) or []
        if not isinstance(extra, dict) or not isinstance(images, list):
            raise ValueError("json_shape")
        # This configuration is embedded in the identity-bound CSV row. Keep
        # its actual specification ID, without lookup or model-name guessing.
        configuration = extra.get("configuration") or {}
        if not isinstance(configuration, dict):
            raise ValueError("configuration")
        row["specid"] = configuration.get("specid")
        row["extra"] = {"configuration": configuration}
        row["images"] = images
        for key in ["description", "address", "vin", "seller_type", "salon_id"]:
            row.pop(key, None)
        selected += 1
        yield {"inner_id": row["inner_id"], "data": row}
    if not total or not selected:
        raise ValueError("empty")
    yield {"csvComplete": True, "totalRows": total, "selectedRows": selected}


if __name__ == "__main__":
    try:
        stream = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8-sig", newline="")
        for row in parse(stream, int(sys.argv[1])):
            print(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        # Never emit seller data, source bodies or authentication in failures.
        print("auto_api_invalid_csv", file=sys.stderr)
        sys.exit(1)
