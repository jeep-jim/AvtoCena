"""Read-only verification of the exact accepted public runtime and China cut."""
import datetime
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import urllib.error
import urllib.request

RUNTIME = "a5ca426eec2663eb17c2df69fe2bfed46e2b8740"
GENERATION = "gen_china_45875678028_1"
TOTAL = 281310
CALCULATION = "4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90"
ROOT = Path(__file__).resolve().parents[1]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def require(value, code):
    if not value:
        raise ValueError(code)

def timeout(_signum, _frame):
    raise ValueError("public_verification_deadline")

def checked_resource_runtime(value, reviewed, now=None):
    """A resource observation does not grant publication authority. It only
    selects one already reviewed source pin for this independent public check.
    China generation, formula, totals and anonymous-access checks stay exact.
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)
    require(type(value) is dict and value.get("kind") == "regcloud-resource-inventory-20261126-v1"
        and value.get("status") == "observed" and value.get("healthAndContainersUnchanged") is True
        and value.get("runtimeLockHeld") is True
        and type(value.get("mutations")) is int and value["mutations"] == 0
        and type(value.get("providerRequests")) is int and value["providerRequests"] == 0,
        "public_verification_inventory")
    try:
        observed = datetime.datetime.fromisoformat(value.get("measuredAtUtc", "").replace("Z", "+00:00"))
        age = (now - observed).total_seconds()
    except (ValueError, TypeError):
        raise ValueError("public_verification_inventory_time") from None
    require(-60 <= age < 15 * 60, "public_verification_inventory_time")
    health = value.get("health") or {}
    runtime = health.get("releaseSha")
    require(type(runtime) is str and re.fullmatch(r"[a-f0-9]{40}", runtime)
        and runtime in reviewed and health.get("status") == 200 and health.get("ok") is True
        and health.get("calculationVersion") == CALCULATION, "public_verification_inventory_runtime")
    serving = [row for row in value.get("containers", []) if type(row) is dict
        and row.get("id") == value.get("servingContainerId")]
    require(len(serving) == 1 and serving[0].get("running") is True
        and serving[0].get("runtimeSha") == runtime, "public_verification_inventory_container")
    return runtime

def runtime_from_inventory(filename):
    require(filename == "server-resource-inventory.json", "public_verification_inventory_path")
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= 2 * 1024 * 1024,
            "public_verification_inventory_file")
        raw = b""
        while len(raw) <= 2 * 1024 * 1024:
            part = os.read(descriptor, min(65536, 2 * 1024 * 1024 + 1 - len(raw)))
            if not part:
                break
            raw += part
        after = os.fstat(descriptor)
        require(len(raw) == before.st_size and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "public_verification_inventory_changed")
    finally:
        os.close(descriptor)
    reviewed = []
    for name in ("china-serving-plan.json", "china-code-serving-plan.json"):
        with (ROOT / ".github/operations/catalog-next" / name).open(encoding="utf-8") as source:
            plan = json.load(source)
        require(plan.get("version") == 1 and plan.get("market") == "china"
            and re.fullmatch(r"[a-f0-9]{40}", plan.get("runtimeSha", "")), "public_verification_reviewed_plan")
        reviewed.append(plan["runtimeSha"])
    return checked_resource_runtime(json.loads(raw), reviewed)

def get(path, status=200):
    request = urllib.request.Request("https://avtocena.com" + path,
        headers={"Accept": "application/json", "User-Agent": "AvtoCena-public-verification/1"},
        method="GET")
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(request, timeout=15)
    except urllib.error.HTTPError as response_error:
        response = response_error
    except Exception:
        raise ValueError("public_verification_transport") from None
    with response:
        require(response.getcode() == status, "public_verification_status")
        require(response.headers.get_content_type() == "application/json", "public_verification_content_type")
        raw = response.read(65537)
        require(len(raw) <= 65536, "public_verification_size")
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ValueError("public_verification_json") from None
        require(type(body) is dict, "public_verification_shape")
        return body, response.headers

def count(power=False):
    path = "/api/catalog/search?market=china&countOnly=1&preparedCut=" + GENERATION
    if power:
        path += "&powerTo=160"
    body, headers = get(path)
    require(body.get("ok") is True and body.get("generationId") == GENERATION
        and body.get("items") == [] and type(body.get("total")) is int
        and 0 <= body["total"] <= TOTAL, "public_verification_count")
    require("no-store" in [item.strip() for item in headers.get("Cache-Control", "").lower().split(",")],
        "public_verification_count_cache")
    return body["total"]

def main():
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(75)
    report = {"version": 1, "kind": "avtocena-public-post-release-check-v1",
        "passed": False, "readOnly": True, "productionMutations": 0,
        "directSupplierRequests": 0, "signedInRequests": 0}
    try:
        require(sys.argv[1:] in ([], ["--inventory", "server-resource-inventory.json"]), "public_verification_arguments")
        runtime = runtime_from_inventory(sys.argv[2]) if len(sys.argv) == 3 else RUNTIME
        health, _ = get("/api/health")
        require(health.get("ok") is True and health.get("service") == "avtocena-web"
            and health.get("releaseSha") == runtime
            and health.get("calculationVersion") == CALCULATION, "public_verification_runtime")
        total = count()
        require(total == TOTAL, "public_verification_total")
        power_total = count(True)
        access, headers = get("/api/crm/china-catalog-status", 401)
        require(access == {"ok": False, "error": "auth_required"}
            and not headers.get_all("Set-Cookie"), "public_verification_crm_boundary")
        report.update({"passed": True, "requests": 4, "runtimeSha": runtime,
            "calculationVersion": CALCULATION, "generationId": GENERATION,
            "total": total, "powerTo160Total": power_total,
            "crmAnonymousStatus": 401, "crmAnonymousBodyMatched": True,
            "crmSetCookieAbsent": True})
    except Exception as error:
        code = str(error)
        report["errorCode"] = code if code.startswith("public_verification_") and code.replace("_", "").isalnum() else "public_verification_failed"
    finally:
        signal.alarm(0)
    report["observedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    raw = json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n"
    with open("public-post-release-verification.json", "x", encoding="utf-8") as output:
        output.write(raw)
    sys.stdout.write(raw)
    return 0 if report["passed"] else 1

if __name__ == "__main__":
    sys.exit(main())
