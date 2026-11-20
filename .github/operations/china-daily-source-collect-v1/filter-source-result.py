import hashlib
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
code = int(sys.argv[2])
protected = dict(publicationAuthorized=False, cursorAdvanceAuthorized=False, scheduleHeld=True)

def load(file, cap):
    p = root / file
    if p.is_symlink() or p.stat().st_size > cap:
        raise ValueError("private file scope")
    return p

def terminal(file):
    p = load(file, 8 * 1024 * 1024)
    with p.open("rb") as f:
        f.seek(max(0, p.stat().st_size - 8192))
        return json.loads(f.read(8192).splitlines()[-1])

def reject(reason):
    print(json.dumps(dict(outcome="held", reason=reason, **protected), separators=(",", ":")))
    sys.exit(1)

if code:
    reason = "source_collection_unverified"
    try:
        v = terminal("actor.stderr")
        if v.get("outcome") == "held":
            r = v.get("reason", "")
            # No free-form remote error, ID, path or object data in output.
            if re.fullmatch(r"china_daily_(?:authority|privacy|once|collect|dry|source):[a-z0-9_]{1,45}(?::\d{3})?|china_private_stage_privacy:[a-z0-9_]{1,45}(?::\d{3})?|auto_api_http_\d{3}", r):
                reason = r
    except (OSError, ValueError, IndexError, TypeError):
        pass
    reject(reason)
try:
    v = terminal("actor.stdout")
    if any(v.get(k) is not expected for k, expected in protected.items()):
        raise ValueError("auth results")
    cursor = v.get("cursor")
    if type(cursor) is not int or not 13123821 <= cursor < 2**53:
        raise ValueError("cursor")
    if v.get("outcome") == "no_delta" and cursor == 13123821:
        if set(v) != {*protected, "outcome", "cursor"}:
            raise ValueError("no-delta properties")
        out = dict(outcome="no_delta", cursor=cursor, **protected)
    elif v.get("outcome") == "archive_verified" and cursor > 13123821:
        if set(v) != {*protected, "outcome", "cursor", "offers", "manifestSha256", "receiptSha256"}:
            raise ValueError("archive properties")
        digest = v.get("receiptSha256", "")
        manifest = v.get("manifestSha256", "")
        offers = v.get("offers")
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or not re.fullmatch(r"[a-f0-9]{64}", manifest) or type(offers) is not int or not 0 < offers <= 500000:
            raise ValueError("archive metadata")
        raw = load("china-daily-archive-private.json", 16384).read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest or json.loads(raw).get("manifestSha256") != manifest:
            raise ValueError("private receipt integrity")
        out = dict(outcome="archive_verified", cursor=cursor, offers=offers, manifestSha256=manifest, receiptSha256=digest, **protected)
    else:
        raise ValueError("outcome")
    print(json.dumps(out, separators=(",", ":")))
except (OSError, TypeError, ValueError, IndexError):
    reject("source_collection_unverified")
