"""Saved v2 Che168 CSV decoder. Every record is emitted; no market admission."""
import csv
import io
import json
import sys


def parse(stream):
    csv.field_size_limit(16 * 1024 * 1024)
    reader = csv.DictReader(stream, delimiter="|", strict=True)
    required = {"inner_id", "url", "mark", "model", "year", "price", "images", "extra"}
    if not required.issubset(reader.fieldnames or []) or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError("header")
    count = 0
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("columns")
        extra = json.loads(row["extra"]) if row["extra"] else {}
        images = json.loads(row["images"]) if row["images"] else []
        if not isinstance(extra, dict) or not isinstance(images, list):
            raise ValueError("json_shape")
        row["extra"], row["images"] = extra, images
        configuration = extra.get("configuration")
        if isinstance(configuration, dict):
            row["specid"] = configuration.get("specid")
        count += 1
        yield {"kind": "row", "line": reader.line_num, "row": {"inner_id": row["inner_id"], "data": row}}
    yield {"kind": "complete", "rows": count}


if __name__ == "__main__":
    try:
        stream = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8-sig", newline="")
        for value in parse(stream):
            print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        print("catalog_next_source_invalid_csv", file=sys.stderr)
        sys.exit(1)
