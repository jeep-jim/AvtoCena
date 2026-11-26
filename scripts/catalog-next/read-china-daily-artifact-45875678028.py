#!/usr/bin/env python3
"""Inspect two aggregate JSONs from one completed China daily; GET-only, no host/provider access."""
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
RUN = 45875678028
HEAD = "6ac99e79457bb7183a263017dbfd4e76e5ad5d1d"
WORKFLOW = ".github/workflows/catalog-next-china-daily.yml"
ARTIFACT = 15153293332
ARCHIVE_BYTES = 2869
DIGEST = "7fec676a07e537ca6c53700d1d57fd2a532b5928424bf824409716fad2495bbb"
NAME = "catalog-next-china-daily-report"
FILES = ("catalog-next-china-daily-report.json", "catalog-next-china-daily-generation-report.json")
GENERATION = "gen_china_45875678028_1"
PREVIOUS_GENERATION = "gen_china_45655051136_1"
SERVING_RUNTIME = "077cbb17626ab0c64e7f06db055fef9252ad21c0"
PRICING_RUNTIME = "64c6338e0db23c8999096bceefbf113c0136fe15"
PRICING_TREE = "d2fc1f171316bfb0dc76f09e90409d4d7336f6b3"
PRICING_DIFF = "b4a945a00093e5bf2d8ee06891634d75c23d4fdd2c88668583f1345f59a614c5"
BASE = "https://api.github.com/repos/" + REPOSITORY + "/actions/"
JSON_CAP = 1024 * 1024
SAFE_INTEGER = 9007199254740991
KIND = "china-daily-artifact-inspection-v1"


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


def main():
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(120)
    token = os.environ.get("GITHUB_TOKEN", "")
    need(0 < len(token) <= 4096, "token_missing")
    auth = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "fixed-china-artifact-inspector",
            "Accept-Encoding": "identity"}

    def api(path):
        with get(BASE + path, auth, 200) as response:
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
    artifact_run = meta.get("workflow_run", {})
    need(meta.get("id") == ARTIFACT and meta.get("name") == NAME and meta.get("expired") is False
         and type(meta.get("size_in_bytes")) is int and meta["size_in_bytes"] == ARCHIVE_BYTES
         and meta.get("digest") == "sha256:" + DIGEST and artifact_run.get("id") == RUN
         and artifact_run.get("repository_id") == REPOSITORY_ID
         and artifact_run.get("head_repository_id") == REPOSITORY_ID
         and artifact_run.get("head_branch") == "main" and artifact_run.get("head_sha") == HEAD, "artifact_binding")
    with get(BASE + "artifacts/" + str(ARTIFACT) + "/zip", auth, 302) as response:
        location = response.headers.get("Location", "")
    target = urllib.parse.urlsplit(location)
    need(len(location) <= 16384 and target.scheme == "https" and not target.username and not target.password
         and target.port in (None, 443) and not target.fragment
         and re.fullmatch(r"[a-z0-9-]+\.blob\.core\.windows\.net", target.hostname or ""), "redirect_scope")
    # Signed artifact URL only; never forward GitHub Authorization or cookies, and never follow another redirect.
    with get(location, {"User-Agent": "fixed-china-artifact-inspector", "Accept-Encoding": "identity"}, 200) as response:
        archive = bounded(response, ARCHIVE_BYTES)
    need(len(archive) == ARCHIVE_BYTES and hashlib.sha256(archive).hexdigest() == DIGEST, "zip_digest")
    reports, hashes, sizes = {}, {}, {}
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        infos = bundle.infolist()
        need(len(infos) == 2 and {item.filename for item in infos} == set(FILES), "zip_entries")
        need(sum(item.file_size for item in infos) <= 2 * JSON_CAP, "zip_total")
        for item in infos:
            mode = stat.S_IFMT(item.external_attr >> 16)
            need(item.orig_filename == item.filename and not item.is_dir() and not item.flag_bits & 1
                 and mode in (0, stat.S_IFREG)
                 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                 and 0 < item.file_size <= JSON_CAP, "zip_entry")
            with bundle.open(item) as stream:
                raw = stream.read(JSON_CAP + 1)
            need(len(raw) == item.file_size and len(raw) <= JSON_CAP, "entry_size")
            value = parse(raw)
            need(type(value) is dict and type(value.get("version")) is int and value["version"] == 1
                 and value.get("market") == "china", "report_schema")
            reports[item.filename] = value
            hashes[item.filename], sizes[item.filename] = hashlib.sha256(raw).hexdigest(), len(raw)

    daily, prepared = (reports[name] for name in FILES)
    need(daily.get("kind") == "china-daily-cycle-v1" and "kind" not in prepared, "report_kind")
    cycle = project(daily, {
        "completed": exact(True), "published": exact(True), "status": exact("accepted"),
        "sourcePrepared": exact(True), "leaseReleased": exact(True),
        **fields(boolean, "recovered leaseReleasePending hostCleanupPending"),
        **fields(integer, "applicationBuilds encyclopediaWrites otherMarketWrites deletions protectedGenerations sourceCursor"),
        **fields(generation, "preparedGenerationId acceptedGenerationId"),
        **fields(timestamp, "sourceObservedAt finishedAt cleanupDeadlineAt"),
        "errorCode": error_code,
    }, "completed published status sourcePrepared leaseReleased applicationBuilds encyclopediaWrites otherMarketWrites deletions sourceCursor preparedGenerationId acceptedGenerationId sourceObservedAt finishedAt".split())
    prep = project(prepared, {
        "completed": exact(True), "published": exact(False), "phase": exact("complete_private_generation"),
        "controllerSha": sha40, "finishedAt": timestamp,
        **fields(integer, "liveCatalogWrites encyclopediaWrites calculatorFormulaChanges deletions"),
    }, "completed published phase controllerSha finishedAt liveCatalogWrites encyclopediaWrites calculatorFormulaChanges deletions".split())
    need(prep["controllerSha"] == HEAD, "preparation_controller")
    need(all(cycle[key] == 0 for key in ("applicationBuilds", "encyclopediaWrites", "otherMarketWrites"))
         and all(prep[key] == 0 for key in ("liveCatalogWrites", "encyclopediaWrites", "calculatorFormulaChanges", "deletions")),
         "write_contract")
    need(not cycle.get("leaseReleasePending", False), "lease_release")
    for section in ("retention", "retentionResume", "hostCleanup", "hostCleanupBeforeReserve"):
        if section in daily:
            cycle[section] = cleanup(daily[section])

    runtime = project(prepared.get("runtime"), {
        "runtimeSha": sha40, "runtimeTree": sha40, "runtimeDiffSha256": sha256,
    }, ("runtimeSha", "runtimeTree", "runtimeDiffSha256"))
    need(runtime == {"runtimeSha": PRICING_RUNTIME, "runtimeTree": PRICING_TREE, "runtimeDiffSha256": PRICING_DIFF},
         "pricing_runtime_binding")
    previous = project(prepared.get("sourceInput"), {
        "kind": exact("accepted-generation"), "owner": owner, "generationId": generation,
        **fields(sha256, "receiptSha256 sourceDescriptorSha256"),
        **fields(sha40, "runtimeSha pricingRuntimeSha"),
        "sourceCursor": integer, "sourceObservedAt": timestamp,
    }, "kind owner generationId receiptSha256 sourceDescriptorSha256 runtimeSha pricingRuntimeSha sourceCursor sourceObservedAt".split())
    need(previous["generationId"] == PREVIOUS_GENERATION and previous["runtimeSha"] == SERVING_RUNTIME
         and previous["pricingRuntimeSha"] == PRICING_RUNTIME, "predecessor_binding")
    need(previous["sourceCursor"] == 13313207 and previous["sourceObservedAt"] == "2026-11-25T17:34:57.542Z"
         and previous["sourceDescriptorSha256"] == "c771d329f4da26885ebe0939a02ec283a2efa7b7788d8edb095dcee88674a48e"
         and previous["owner"]["runId"] == "45655051136" and previous["owner"]["attempt"] == "1", "previous_source_binding")
    source = project(prepared.get("source"), {
        "sourceObservedAt": timestamp, "sourceCursor": integer,
        "supplierLatestVerified": exact(True), "sourceDescriptorSha256": sha256,
    }, ("sourceObservedAt", "sourceCursor", "supplierLatestVerified", "sourceDescriptorSha256"))
    pricing = project(prepared.get("pricing"), {
        "completed": exact(True), "runtimeSha": sha40, "generationId": generation,
        **fields(sha256, "generationManifestSha256 sourceDescriptorSha256 fxReceiptSha256 semanticsInputSha256"),
        **fields(timestamp, "sourceObservedAt pricingAsOf finishedAt"),
        "networkAfterFxCapture": integer,
    }, "completed runtimeSha generationId generationManifestSha256 sourceDescriptorSha256 sourceObservedAt pricingAsOf networkAfterFxCapture".split())
    stored = project(prepared.get("privateGeneration"), {
        "owner": owner, "generationId": generation,
        **fields(sha256, "receiptSha256 generationManifestSha256 sourceDescriptorSha256"),
        **fields(integer, "totalBytes storedBytes"),
    }, "owner generationId receiptSha256 generationManifestSha256 sourceDescriptorSha256 totalBytes storedBytes".split())
    need(stored["owner"] == {"runId": str(RUN), "attempt": "1", "revision": HEAD}, "private_owner")
    need(cycle["preparedGenerationId"] == cycle["acceptedGenerationId"] == pricing["generationId"]
         == stored["generationId"] == GENERATION, "generation_binding")
    need(pricing["runtimeSha"] == runtime["runtimeSha"] and pricing["networkAfterFxCapture"] == 0, "pricing_binding")
    need(source["sourceDescriptorSha256"] == pricing["sourceDescriptorSha256"] == stored["sourceDescriptorSha256"]
         and pricing["generationManifestSha256"] == stored["generationManifestSha256"], "manifest_binding")
    need(source["sourceCursor"] == cycle["sourceCursor"] and source["sourceCursor"] >= previous["sourceCursor"]
         and clock(source["sourceObservedAt"]) >= clock(previous["sourceObservedAt"]), "source_progress")
    source_counts = "sourceRows baseSourceRows insertedRows updatedRows unchangedRows removedRows quarantinedRows eligible yearBeforeMinimum yearUnknown unresolvedDetails"
    pricing_counts = "sourceRows admittedRows excludedRows pricedRows sellerOnlyRows unpricedRows cityCount cityLedgerRows cityPriceRows"
    source_reconciliation = project(prepared["source"].get("reconciliation"), {
        **fields(integer, source_counts), "sourceObservedAt": timestamp,
        "allInputRowsAccountedFor": boolean, "minimumYear": exact(2014),
        "inputCoverage": exact("verified_private_source_and_complete_delta"),
        **fields(boolean, "finalAdmissionApplied missingValuesInvented pricesRecalculated publicationReady"),
    }, source_counts.split() + "sourceObservedAt allInputRowsAccountedFor minimumYear inputCoverage finalAdmissionApplied missingValuesInvented pricesRecalculated publicationReady".split())
    pricing_reconciliation = project(prepared["pricing"].get("reconciliation"), {
        **fields(integer, pricing_counts), **fields(timestamp, "sourceObservedAt pricingAsOf"), "generationId": generation,
        **fields(boolean, "allInputRowsAccountedFor priorPricesReused missingValuesInvented localOnlyPricing encyclopediaWritten otherMarketsWritten supplierLatestVerified"),
        **fields(integer, "sourceApiCalls remoteStorageWrites"),
    }, pricing_counts.split() + "sourceObservedAt generationId allInputRowsAccountedFor priorPricesReused missingValuesInvented localOnlyPricing encyclopediaWritten otherMarketsWritten sourceApiCalls remoteStorageWrites".split())
    excluded = prepared["pricing"]["reconciliation"].get("excluded")
    excluded_keys = {"source_withdrawn", "publication_withdrawn", "editorial_hidden", "reviewed_duplicate",
                     "year_unknown", "year_before_minimum", "year_future", "source_date_future", "vehicle_excluded"}
    need(type(excluded) is dict and set(excluded) <= excluded_keys, "excluded_shape")
    safe_excluded = {key: integer(excluded[key]) for key in sorted(excluded)}
    excluded_total = integer(sum(safe_excluded.values()))
    pricing_reconciliation["excluded"] = safe_excluded
    pricing_reconciliation["excludedTotal"] = excluded_total
    sr, pr = source_reconciliation, pricing_reconciliation
    need(sr["sourceRows"] == sr["baseSourceRows"] + sr["insertedRows"] - sr["removedRows"] - sr["quarantinedRows"]
         == sr["insertedRows"] + sr["updatedRows"] + sr["unchangedRows"]
         == sr["eligible"] + sr["yearBeforeMinimum"] + sr["yearUnknown"]
         and sr["unresolvedDetails"] == 0, "source_arithmetic")
    need(pr["sourceRows"] == pr["admittedRows"] + pr["excludedRows"]
         and pr["admittedRows"] == pr["pricedRows"] + pr["sellerOnlyRows"] + pr["unpricedRows"]
         and pr["excludedRows"] == excluded_total and pr["cityLedgerRows"] == pr["admittedRows"]
         and pr["cityPriceRows"] == pr["admittedRows"] * pr["cityCount"], "pricing_arithmetic")
    need(cycle["sourceObservedAt"] == source["sourceObservedAt"] == pricing["sourceObservedAt"]
         == sr["sourceObservedAt"] == pr["sourceObservedAt"], "source_date_binding")
    need(pr["generationId"] == GENERATION and sr["sourceRows"] == pr["sourceRows"], "pricing_reconciliation_generation")
    need(pr.get("pricingAsOf") == pricing["pricingAsOf"], "pricing_date_binding")
    need(sr["allInputRowsAccountedFor"] is True and pr["allInputRowsAccountedFor"] is True
         and all(sr[key] is False for key in ("finalAdmissionApplied", "missingValuesInvented", "pricesRecalculated", "publicationReady"))
         and pr["localOnlyPricing"] is True and pr.get("supplierLatestVerified") is True
         and all(pr[key] is False for key in ("priorPricesReused", "missingValuesInvented", "encyclopediaWritten", "otherMarketsWritten"))
         and pr["sourceApiCalls"] == 0 and pr["remoteStorageWrites"] == 0, "accounting_contract")
    need(clock(run["run_started_at"]) <= clock(source["sourceObservedAt"]) <= clock(cycle["finishedAt"])
         <= clock(run["updated_at"]), "source_run_window")
    need(cycle["deletions"] == sum(cycle.get(name, {}).get("deletedObjects", 0)
         for name in ("retentionResume", "retention")), "retention_arithmetic")
    source["reconciliation"], pricing["reconciliation"] = sr, pr
    prep.update(runtime=runtime, sourceInput=previous, source=source, pricing=pricing, privateGeneration=stored)
    output = {
        "version": 1, "kind": KIND, "status": "verified",
        "runId": RUN, "runAttempt": 1, "headSha": HEAD, "workflow": WORKFLOW,
        "runConclusion": "success", "runUpdatedAt": timestamp(run.get("updated_at")),
        "artifactId": ARTIFACT, "artifactSha256": DIGEST, "archiveBytes": len(archive),
        "requests": calls, "directSupplierRequests": 0, "productionMutations": 0,
        "entrySha256": hashes, "entryBytes": sizes, "cycle": cycle, "preparation": prep,
        "checks": {"exactRunAndArtifact": True, "privateGenerationBinding": True, "pricingRuntimeBinding": True,
                   "sourceDateAndCursorBinding": True, "sourceArithmetic": True, "pricingArithmetic": True},
    }
    text = json.dumps(output, separators=(",", ":"), ensure_ascii=True)
    need(len(text.encode("utf-8")) <= 24576, "output_cap")
    signal.alarm(0)
    print(text)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never print exception messages, signed URLs, tokens, response bodies or arbitrary artifact fields.
        code = str(error) if type(error) is Guard else "inspection_error"
        print(json.dumps({"version": 1, "kind": KIND, "status": "failed", "errorCode": code}, separators=(",", ":")))
        sys.exit(1)
