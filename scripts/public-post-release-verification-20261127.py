"""Read-only verification of the exact accepted public runtime and China cut."""
import datetime
import json
import signal
import sys
import urllib.error
import urllib.request

RUNTIME = "a5ca426eec2663eb17c2df69fe2bfed46e2b8740"
GENERATION = "gen_china_45875678028_1"
TOTAL = 281310
CALCULATION = "4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def require(value, code):
    if not value:
        raise ValueError(code)

def timeout(_signum, _frame):
    raise ValueError("public_verification_deadline")

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
        health, _ = get("/api/health")
        require(health.get("ok") is True and health.get("service") == "avtocena-web"
            and health.get("releaseSha") == RUNTIME
            and health.get("calculationVersion") == CALCULATION, "public_verification_runtime")
        total = count()
        require(total == TOTAL, "public_verification_total")
        power_total = count(True)
        access, headers = get("/api/crm/china-catalog-status", 401)
        require(access == {"ok": False, "error": "auth_required"}
            and not headers.get_all("Set-Cookie"), "public_verification_crm_boundary")
        report.update({"passed": True, "requests": 4, "runtimeSha": RUNTIME,
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
