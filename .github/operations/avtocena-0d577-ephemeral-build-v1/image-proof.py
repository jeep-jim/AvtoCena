"""Bounded proof of final local Docker config. No image is run/exported."""
import json
import pathlib
import re
import sys

APP = "0d577596d14bbd5c4f6eafa48fb9b153ae7ef2ec"
TREE = "a2d52f40104ea8cc3162a21b182478d0225ef997"
HEX = r"[0-9a-f]{64}"
TAG = "avtocena-regcloud:" + APP

def build_dockerfile(raw, base):
    if not re.fullmatch("sha256:" + HEX, base):
        raise ValueError("bad_base_digest")
    edits = {
        "FROM node:24.22.1-alpine AS deps": f"FROM docker.io/library/node@{base} AS deps",
        "FROM node:24.22.1-alpine AS builder": f"FROM docker.io/library/node@{base} AS builder",
        "FROM node:24.22.1-alpine AS runner": f"FROM docker.io/library/node@{base} AS runner",
        "RUN node scripts/check-runtime-streams.mjs": "RUN --network=none node scripts/check-runtime-streams.mjs",
        "RUN npm run build": "RUN --network=none NEXT_TELEMETRY_DISABLED=1 npm run build",
    }
    lines = raw.splitlines()
    for old in edits:
        if lines.count(old) != 1:
            raise ValueError("unexpected_dockerfile")
    return "\n".join(edits.get(line,line) for line in lines) + "\n"

def proof(data, calc):
    if not re.fullmatch(HEX, calc):
        raise ValueError("invalid_calculation")
    if not isinstance(data,list) or len(data)!=1:
        raise ValueError("invalid_image_count")
    item = data[0]
    cfg = item["Config"]
    labels = cfg["Labels"]
    if (not re.fullmatch("sha256:" + HEX, item["Id"]) or item["Os"] != "linux" or item["Architecture"] != "amd64"
        or item["RepoTags"] != [TAG] or labels.get("org.opencontainers.image.revision") != APP
        or labels.get("com.avtocena.app-tree") != TREE or labels.get("com.avtocena.build-calculation") != calc
        or labels.get("com.avtocena.artifact") != "ephemeral-build-only-v1"
        or cfg["WorkingDir"] != "/app" or cfg["Cmd"] != ["node","apps/web/server.js"]
        or cfg.get("Entrypoint") not in (None,["docker-entrypoint.sh"]) or cfg.get("ExposedPorts") != {"3000/tcp": {}}):
        raise ValueError("invalid_image_identity")
    env=cfg["Env"]
    allowed={"PATH","NODE_VERSION","YARN_VERSION","NODE_ENV"}
    items = [line.split("=",1) for line in env]
    if any(len(x)!=2 for x in items) or len({x[0] for x in items}) != len(items) or set(x[0] for x in items) - allowed:
        raise ValueError("unexpected_baked_env")
    if dict(items).get("NODE_ENV")!="production" or dict(items).get("NODE_VERSION")!="24.22.1":
        raise ValueError("unexpected_baked_runtime")
    layers=item["RootFS"]["Layers"]
    if not layers or len(layers)>80 or len(set(layers))!=len(layers) or any(not re.fullmatch("sha256:" + HEX,x) for x in layers):
        raise ValueError("invalid_layer_metadata")
    size=item["Size"]
    if type(size) is not int or not 0 < size <= 4*1024**3:
        raise ValueError("invalid_image_size")
    return {"imageId":item["Id"], "imageBytes":size, "rootfsLayerCount":len(layers)}

def pathtext(path, limit):
    with pathlib.Path(path).open("rb") as f:
        raw=f.read(limit+1)
    if len(raw)>limit: raise ValueError("file_too_large")
    return raw.decode("utf-8")

if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv)>1 else ""
    try:
        if stage=="dockerfile" and len(sys.argv)==4:
            sys.stdout.write(build_dockerfile(pathtext(sys.argv[2],16*1024),sys.argv[3]))
        elif stage=="proof" and len(sys.argv)==4:
            print(json.dumps(proof(json.loads(pathtext(sys.argv[2],64*1024)),sys.argv[3]),separators=(",",":")))
        else:
            raise ValueError("usage")
    except (OSError,ValueError,TypeError,KeyError):
        raise SystemExit("ephemeral_image_metadata_rejected")
