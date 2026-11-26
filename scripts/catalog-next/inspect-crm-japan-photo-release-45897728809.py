#!/usr/bin/env python3
"""Verify fixed accepted CRM/photo release evidence; GitHub GET-only, no production or provider access."""
import base64
import datetime
import hashlib
import io
import json
import os
import re
import signal
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = "jeep-jim/AvtoCena"
REPOSITORY_ID = 1289722938
RUN = 45897728809
HEAD = "63ef119e77ec50d3cdd866af8ed808a64faaa892"
WORKFLOW = ".github/workflows/catalog-next-china-photo-release.yml"
ARTIFACT = 15156135490
ARCHIVE_BYTES = 6082
DIGEST = "dea8da2916c5decb4c8c1318a717310e2786df9a3531b5ee6535d98ebf3d99a1"
NAME = "china-photo-code-release-result"
FILES = ("catalog-next-china-photo-release-report.json", "catalog-next-crm-china-operations-report.json",
         "catalog-next-japan-photo-retry-report.json", "china-crm-collection-controls-report.json",
         "japan-photo-retry-browser-report.json", "image-receipt.json")
GENERATION = "gen_china_45875678028_1"
PREVIOUS_GENERATION = "gen_china_45655051136_1"
SERVING_RUNTIME = "077cbb17626ab0c64e7f06db055fef9252ad21c0"
PRICING_RUNTIME = "64c6338e0db23c8999096bceefbf113c0136fe15"
PRICING_TREE = "d2fc1f171316bfb0dc76f09e90409d4d7336f6b3"
PRICING_DIFF = "b4a945a00093e5bf2d8ee06891634d75c23d4fdd2c88668583f1345f59a614c5"
BASE = "https://api.github.com/repos/" + REPOSITORY + "/actions/"
JSON_CAP = 1024 * 1024
SAFE_INTEGER = 9007199254740991
KIND = "crm-japan-photo-release-inspection-v1"


class Guard(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Guard(code)


def deadline(*_):
    raise Guard("deadline")


def integer(value):
    need(type(value) is int and 0 <= value <= SAFE_INTEGER, "report_integer")
    return value


def boolean(value):
    need(type(value) is bool, "report_boolean")
    return value


def nullable_boolean(value):
    return None if value is None else boolean(value)


def matching(value, pattern):
    need(type(value) is str and re.fullmatch(pattern, value) is not None, "report_string")
    return value


def sha40(value):
    return matching(value, r"[a-f0-9]{40}")


def sha256(value):
    return matching(value, r"[a-f0-9]{64}")


def generation(value):
    return matching(value, r"gen_china_[1-9]\d{0,19}_[1-9]\d{0,5}")


def timestamp(value):
    matching(value, r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z")
    try:
        datetime.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise Guard("report_date")
    return value


def clock(value):
    return datetime.datetime.fromisoformat(timestamp(value)[:-1] + "+00:00")


def exact(expected):
    def check(value):
        need(type(value) is type(expected) and value == expected, "report_literal")
        return value
    return check


def error_code(value):
    need(type(value) is str, "report_error_code")
    # No arbitrary error text reaches stdout, even if an artifact contains it.
    return value if value in {"china_gc_storage_transport"} else "unclassified"


def cleanup_status(value):
    need(type(value) is str, "report_status")
    allowed = {"completed", "complete", "remembered", "paused", "needs_reconciliation", "idle", "pending", "stable", "retained", "not_due"}
    return value if value in allowed else "unclassified"


def fields(check, names):
    return {key: check for key in names.split()}


def project(value, checks, required=()):
    need(type(value) is dict, "report_object")
    need(all(key in value for key in required), "report_required")
    return {key: check(value[key]) for key, check in checks.items() if key in value}


def owner(value):
    return project(value, {
        "runId": lambda item: matching(item, r"[1-9]\d{0,19}"),
        "attempt": lambda item: matching(item, r"[1-9]\d{0,5}"),
        "revision": sha40,
    }, ("runId", "attempt", "revision"))


def pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, "duplicate_key")
        result[key] = value
    return result


def bad_number(_):
    raise Guard("json_number")


def parse(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=bad_number)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
calls = 0


def get(url, headers, expected_status):
    global calls
    calls += 1
    need(calls <= 4, "request_cap")
    try:
        response = opener.open(urllib.request.Request(url, headers=headers, method="GET"), timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    if response.status != expected_status:
        response.close()
        raise Guard("http_status")
    return response


def bounded(response, cap):
    raw = response.read(cap + 1)
    need(len(raw) <= cap, "byte_cap")
    return raw


def cleanup(value):
    return project(value, {
        **fields(boolean, "completed"),
        **fields(integer, "deletedObjects deletedBytes alreadyAbsentObjects enqueued collected pruned pending retiredContainers filesDeleted freedBytes"),
        "status": cleanup_status,
        "errorCode": error_code,
        "witnessRemembered": nullable_boolean,
    })


RUNTIME = "a5ca426eec2663eb17c2df69fe2bfed46e2b8740"
RUNTIME_TREE = "5a6d2c7723e9834204eb3896c06271adb2659991"
SCOPE = "catalog-crm-japan-photo-retry-v1"
MANIFEST = "58263ea4dc5642c9ff6f544830e9d3536ba702fb729a7a8c33b049b70b737038"
SOURCE_DATE = "2026-11-26T19:04:39.089Z"
PHOTO_FIXTURE = "5e25916224f7825b364f20b20ed4d26628baf03dcd20afa2084840fc464d7921"
CRM_FIXTURE = "c3c8137ee16f91f3ad2e1d402f58de1c412c7b362d9a4690b80b957c5f4b3b8f"

def exact_keys(value, names):
    need(type(value) is dict and set(value) == set(names.split()), "evidence_keys")

def main():
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(120)
    token = os.environ.get("GITHUB_TOKEN", "")
    need(0 < len(token) <= 4096 and 0 < ARCHIVE_BYTES <= 8 * 1024 * 1024, "configuration")
    auth = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "fixed-code-artifact-inspector",
            "Accept-Encoding": "identity"}
    def api(part):
        with get(BASE + part, auth, 200) as response:
            value = parse(bounded(response, 256 * 1024))
        need(type(value) is dict, "api_object")
        return value
    run = api("runs/" + str(RUN))
    need(run.get("id") == RUN and run.get("run_attempt") == 1 and run.get("status") == "completed"
         and run.get("conclusion") == "success" and run.get("head_sha") == HEAD
         and run.get("head_branch") == "main" and run.get("event") == "push" and run.get("path") == WORKFLOW
         and run.get("repository", {}).get("id") == REPOSITORY_ID
         and run.get("repository", {}).get("full_name") == REPOSITORY
         and run.get("head_repository", {}).get("id") == REPOSITORY_ID, "run_binding")
    meta = api("artifacts/" + str(ARTIFACT))
    binding = meta.get("workflow_run", {})
    need(meta.get("id") == ARTIFACT and meta.get("name") == NAME and meta.get("expired") is False
         and meta.get("size_in_bytes") == ARCHIVE_BYTES and meta.get("digest") == "sha256:" + DIGEST
         and binding.get("id") == RUN and binding.get("head_sha") == HEAD
         and binding.get("head_branch") == "main" and binding.get("repository_id") == REPOSITORY_ID
         and binding.get("head_repository_id") == REPOSITORY_ID, "artifact_binding")
    with get(BASE + "artifacts/" + str(ARTIFACT) + "/zip", auth, 302) as response:
        location = response.headers.get("Location", "")
    target = urllib.parse.urlsplit(location)
    need(len(location) <= 16384 and target.scheme == "https" and not target.username and not target.password
         and target.port in (None, 443) and not target.fragment
         and re.fullmatch(r"[a-z0-9-]+\.blob\.core\.windows\.net", target.hostname or ""), "redirect_scope")
    with get(location, {"User-Agent": "fixed-code-artifact-inspector", "Accept-Encoding": "identity"}, 200) as response:
        archive = bounded(response, ARCHIVE_BYTES)
    need(len(archive) == ARCHIVE_BYTES and hashlib.sha256(archive).hexdigest() == DIGEST, "zip_digest")
    reports, raw_reports, hashes = {}, {}, {}
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        infos = bundle.infolist()
        need(0 < len(infos) <= 64 and len({i.filename for i in infos}) == len(infos), "zip_entries")
        for item in infos:
            parts = item.filename.split("/")
            need(not item.filename.startswith("/") and not "\\" in item.filename
                 and all(p not in (".", "..") for p in parts)
                 and item.orig_filename == item.filename, "zip_path")
            name = parts[-1]
            if name not in FILES:
                continue
            need(name not in reports and not item.is_dir() and not item.flag_bits & 1
                 and stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG)
                 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                 and 0 < item.file_size <= 65536, "zip_entry")
            with bundle.open(item) as stream:
                raw = stream.read(65537)
            need(len(raw) == item.file_size and len(raw) <= 65536, "entry_size")
            reports[name], raw_reports[name], hashes[name] = parse(raw), raw, hashlib.sha256(raw).hexdigest()
    need(set(reports) == set(FILES), "required_evidence")
    cycle, crm, photo, crm_fixture, photo_fixture, image = [reports[name] for name in FILES]
    need(cycle.get("version") == 1 and cycle.get("kind") == "china-code-cycle-v1"
         and cycle.get("market") == "china" and cycle.get("completed") is True
         and cycle.get("published") is True and cycle.get("status") == "accepted"
         and cycle.get("runtimeSha") == cycle.get("acceptedRuntimeSha") == RUNTIME
         and cycle.get("retainedRuntime") == SERVING_RUNTIME and cycle.get("acceptedGenerationId") == GENERATION
         and cycle.get("generationManifestSha256") == MANIFEST and cycle.get("sourceObservedAt") == SOURCE_DATE
         and cycle.get("sourceCursor") == 13340204 and cycle.get("leaseReleased") is True
         and cycle.get("retentionPreserved") is True and not cycle.get("leaseReleasePending")
         and cycle.get("hostCleanup", {}).get("completed") is True, "accepted_cycle")
    zero_fields = "sourceRequests generationRestores priceCalculations generationWrites encyclopediaWrites otherMarketWrites deletions".split()
    need(all(type(cycle.get(k)) is int and cycle[k] == 0 for k in zero_fields), "cycle_write_scope")
    crm_keys = ("version kind codeScope release nonce checkedAt pricingRuntimeSha generationManifestSha256 generationId "
                "sourceObservedAt rows oracleSha256 passed manifestHelperPassed middlewareBoundaryPassed unauthorizedStatus "
                "unauthorizedContentTypeJson unauthorizedBodyIsAuthRequired unauthorizedSetCookieAbsent unsignedAccessDenied "
                "productionMutations directSupplierRequests signedInRequests")
    exact_keys(crm, crm_keys)
    exact_keys(photo, "version kind codeScope release nonce checkedAt oracleSha256 fixtureBase64 fixtureSha256 passed directSupplierRequests productionMutations")
    for value in (crm, photo):
        need(type(value["version"]) is int and value["version"] == 1 and value["codeScope"] == SCOPE
             and value["release"] == RUNTIME and value["passed"] is True
             and type(value["productionMutations"]) is int and value["productionMutations"] == 0
             and type(value["directSupplierRequests"]) is int and value["directSupplierRequests"] == 0, "evidence_binding")
        matching(value["nonce"], r"[a-f0-9]{32}")
        sha256(value["oracleSha256"])
        need(clock(run["run_started_at"]) <= clock(value["checkedAt"]) <= clock(cycle["finishedAt"])
             <= clock(run["updated_at"]), "evidence_time")
    need(crm["nonce"] == photo["nonce"] and crm["oracleSha256"] == photo["oracleSha256"], "shared_evidence")
    crm_true = "manifestHelperPassed middlewareBoundaryPassed unauthorizedContentTypeJson unauthorizedBodyIsAuthRequired unauthorizedSetCookieAbsent unsignedAccessDenied".split()
    need(crm["kind"] == "china-crm-operations-proof-v1" and crm["pricingRuntimeSha"] == PRICING_RUNTIME
         and crm["generationManifestSha256"] == MANIFEST and crm["generationId"] == GENERATION
         and crm["sourceObservedAt"] == SOURCE_DATE and type(crm["rows"]) is int and crm["rows"] == 281310
         and crm["unauthorizedStatus"] == 401 and type(crm["signedInRequests"]) is int and crm["signedInRequests"] == 0
         and all(crm[k] is True for k in crm_true), "crm_evidence")
    need(photo["kind"] == "japan-photo-retry-proof-v1" and type(photo["fixtureBase64"]) is str
         and 0 < len(photo["fixtureBase64"]) <= 21848, "photo_evidence")
    fixture_raw = base64.b64decode(photo["fixtureBase64"], validate=True)
    need(base64.b64encode(fixture_raw).decode("ascii") == photo["fixtureBase64"]
         and len(fixture_raw) <= 16384 and hashlib.sha256(fixture_raw).hexdigest() == photo["fixtureSha256"] == PHOTO_FIXTURE
         and fixture_raw == raw_reports[FILES[4]], "photo_fixture_binding")
    need(hashes[FILES[3]] == CRM_FIXTURE and hashes[FILES[4]] == PHOTO_FIXTURE, "ci_fixture_identity")
    for value, kind, case_count, check_names in (
        (crm_fixture, "china-crm-collection-controls-browser-v1", 2,
         "readyStatus statusFailureIsolated scheduleAndLinks reserveSourcesPreserved neighborControlsPreserved lazyStatusReads revisionConflictPreserved noOverflow"),
        (photo_fixture, "japan-photo-retry-browser-v1", 12,
         "transientRecovery persistentFailureBound sourceChangeCancellation unmountCancellation exactUrl noExternalRequests protectedPhotoPreserved lazyLoadRecovery")):
        exact_keys(value, "version kind passed caseCount widths checks")
        exact_keys(value["checks"], check_names)
        need(value["version"] == 1 and value["kind"] == kind and value["passed"] is True
             and value["caseCount"] == case_count and value["widths"] == [1440, 390]
             and all(v is True for v in value["checks"].values()), "fixture_shape")
    need(type(image) is dict and image.get("runtimeSha") == RUNTIME and image.get("runtimeTree") == RUNTIME_TREE
         and image.get("archiveRoundTripVerified") is True and image.get("imageId") == cycle.get("imageId")
         and re.fullmatch(r"sha256:[a-f0-9]{64}", image.get("imageId", "")), "image_binding")
    safe_cycle = project(cycle, {
        **fields(boolean, "completed published leaseReleased retentionPreserved recovered"),
        **fields(integer, "sourceRequests generationRestores priceCalculations generationWrites encyclopediaWrites otherMarketWrites deletions sourceCursor"),
        **fields(sha40, "runtimeSha retainedRuntime acceptedRuntimeSha"),
        "acceptedGenerationId": generation, "generationManifestSha256": sha256,
        **fields(timestamp, "sourceObservedAt finishedAt"),
        "status": exact("accepted"),
    })
    safe_cycle["hostCleanup"] = cleanup(cycle["hostCleanup"])
    safe_photo = {k: v for k, v in photo.items() if k != "fixtureBase64"}
    output = {"version": 1, "kind": KIND, "status": "verified", "runId": RUN, "headSha": HEAD,
        "artifactId": ARTIFACT, "artifactSha256": DIGEST, "archiveBytes": len(archive),
        "entrySha256": hashes, "entryBytes": {k: len(v) for k, v in raw_reports.items()},
        "requests": calls, "directSupplierRequests": 0, "productionMutations": 0,
        "cycle": safe_cycle, "crm": crm, "photo": safe_photo,
        "crmFixture": crm_fixture, "photoFixture": photo_fixture,
        "image": {"runtimeSha": RUNTIME, "runtimeTree": RUNTIME_TREE, "imageId": image["imageId"], "archiveRoundTripVerified": True},
        "checks": {"exactArtifact": True, "acceptedCycle": True, "crmBoundary": True,
                   "photoFixtureAndCI": True, "sharedNonceAndOracle": True, "imageBinding": True}}
    text = json.dumps(output, separators=(",", ":"), ensure_ascii=True)
    need(len(text.encode("utf-8")) <= 24576, "output_cap")
    signal.alarm(0)
    print(text)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is Guard else "inspection_error"
        print(json.dumps({"version": 1, "kind": KIND, "status": "failed", "errorCode": code}, separators=(",", ":")))
        sys.exit(1)
