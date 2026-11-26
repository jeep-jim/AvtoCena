"""Compute immutable Git provenance only; no runtime, host, REG or supplier requests."""
import hashlib
import json
import pathlib
import signal
import subprocess
import sys

RUNTIME = "889c5150803f7973fc371d1d90491bb38cbabf82"
PARENT = "775973757f5c2c8eb7be408baaa2642c62ad5548"
BASE = "a5ca426eec2663eb17c2df69fe2bfed46e2b8740"
PRICING = "64c6338e0db23c8999096bceefbf113c0136fe15"
EXPECTED = {
  "apps/web/components/catalog/AjesCatalog.tsx": "246fc6bad8255beeadd261938f33897029f984c2",
  "apps/web/components/catalog/CatalogLoadMore.tsx": "aa203d5b1c167f2d8377aa90cb1430f86133566a",
  "apps/web/components/catalog/catalog-load-more-action.tsx": "bab94ebc03d42e4357e760961227932f05be30c0",
  "apps/web/lib/catalog/ajes-catalog.ts": "249fbc8a0b315fdb4bbf11c21abae84f4a906b37",
  "apps/web/lib/catalog/ajes-filtered-page.ts": "765d0f67db71d9e3cdafd278103d19ea866398d4",
  "tests/ajes-catalog-progressive.test.ts": "89057adccef8cb6c5433c6f65fd83a9f586ce676",
  "tests/ajes-count-progressive.test.ts": "73127b4123b98a5acd8e4bc9b3c523909cc8d15b",
  "tests/ajes-filtered-page.test.ts": "2dff6ceee6a86a72eb586e24cb88ce242f5b857a",
  "tests/browser/ajes-pagination-fixture.tsx": "e6d0e9a33a49a2cf98b372f04b9c9b932144b764",
  "tests/browser/ajes-pagination.mjs": "1c8d4082e59742bb44202818120c35bffd12b5b8",
  "tests/japan-source-power.test.ts": "f5ef64149c27da60c72f14cb839109119f728262"
}
KIND = "japan-pagination24-source-freeze-v1"

def need(value, code):
    if not value:
        raise ValueError(code)

def deadline(_signum, _frame):
    raise ValueError("source_freeze_deadline")

def git(*arguments, cap=16777216):
    try:
        result = subprocess.run(["git", *arguments], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=False)
    except Exception:
        raise ValueError("source_freeze_git_transport") from None
    need(result.returncode == 0, "source_freeze_git_failure")
    need(len(result.stdout) <= cap, "source_freeze_size")
    return result.stdout

def names(base):
    raw = git("diff", "--name-only", "-z", base, RUNTIME, cap=131072)
    paths = [p.decode("utf-8") for p in raw.split(b"\0") if p]
    need(len(paths) == len(set(paths)) and all(len(p) <= 240 and not p.startswith("/")
        and ".." not in p.split("/") and not any(c in p for c in "\r\n\\") for p in paths), "source_freeze_paths")
    return sorted(paths)

def main():
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(240)
    need(len(sys.argv) == 1, "source_freeze_arguments")
    remote = git("remote", "get-url", "origin", cap=4096).decode().strip()
    need(remote in ("https://github.com/jeep-jim/AvtoCena", "https://github.com/jeep-jim/AvtoCena.git"), "source_freeze_repository")
    git("fetch", "--no-tags", "--depth=1", "origin", RUNTIME, BASE, PRICING)
    need(git("rev-parse", RUNTIME + "^{tree}", cap=256).decode().strip() == "c9d6371dab51839ace654703509d1272656adf93", "source_freeze_tree")
    # The shallow boundary can hide parents from revision walking; read the raw immutable commit object.
    commit = git("cat-file", "commit", RUNTIME, cap=65536).decode()
    parents = [line[7:] for line in commit.split("\n\n", 1)[0].splitlines() if line.startswith("parent ")]
    need(parents == [PARENT], "source_freeze_parent")
    need(names(BASE) == sorted(EXPECTED), "source_freeze_delta")
    entries = {}
    for path, expected_blob in EXPECTED.items():
        blob = git("rev-parse", RUNTIME + ":" + path, cap=256).decode().strip()
        need(blob == expected_blob, "source_freeze_blob")
        raw = git("cat-file", "blob", blob, cap=1048576)
        entries[path] = {"blob": blob, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    delta = git("diff", "--binary", "--full-index", BASE, RUNTIME)
    cumulative = git("diff", "--binary", "--full-index", PRICING, RUNTIME)
    report = {"version": 1, "kind": KIND, "status": "verified", "runtimeSha": RUNTIME, "runtimeParent": PARENT,
        "runtimeTree": "c9d6371dab51839ace654703509d1272656adf93", "retainedRuntime": BASE,
        "pricingRuntimeSha": PRICING, "runtimeDiffSha256": hashlib.sha256(delta).hexdigest(),
        "runtimeDiffBytes": len(delta), "pricingToServingDiffSha256": hashlib.sha256(cumulative).hexdigest(),
        "pricingToServingDiffBytes": len(cumulative), "runtimeFiles": names(BASE),
        "cumulativePricingToServingFiles": names(PRICING), "entries": entries,
        "productionRequests": 0, "providerRequests": 0, "productionMutations": 0,
        "runtimeTestsExecuted": False}
    output = json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n"
    need(len(output.encode()) <= 32768, "source_freeze_output")
    signal.alarm(0)
    return output

if __name__ == "__main__":
    try:
        output = main()
        code = 0
    except Exception as error:
        message = str(error)
        error_code = message if message.startswith("source_freeze_") and message.replace("_", "").isalnum() else "source_freeze_failed"
        output = json.dumps({"version": 1, "kind": KIND, "status": "failed", "errorCode": error_code}, separators=(",", ":")) + "\n"
        code = 1
    pathlib.Path("japan-pagination24-source-freeze.json").write_text(output, encoding="utf-8")
    sys.stdout.write(output)
    sys.exit(code)
