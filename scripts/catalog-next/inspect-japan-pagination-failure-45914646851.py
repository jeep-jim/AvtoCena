#!/usr/bin/env python3
"""Inspect the fixed failed release 45914646851. Four GitHub GETs only.
No supplier, site, private-storage or host access; no extraction or writes.
An inspection failure does not establish any production outcome.
"""
import base64
import datetime
import hashlib
import io
import json
import math
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
RUN = 45914646851
HEAD = "dbc3b715c235e413426b7d7cb600b22fba76b4ee"
WORKFLOW = ".github/workflows/catalog-next-china-photo-release.yml"
ARTIFACT = 15162023947
ARCHIVE_BYTES = 9165
DIGEST = "41075cfeb2f726c316cba0330e82f74e1b63988e72385bbeb98a03e8e4bf29c0"
NAME = "china-photo-code-release-result"
REQUIRED = ("catalog-next-china-photo-release-report.json", "catalog-next-japan-browser-report.json",
            "catalog-next-japan-source-failure-report.json", "image-receipt.json")
OPTIONAL = ("catalog-next-crm-china-operations-report.json", "catalog-next-japan-photo-retry-report.json",
            "china-crm-collection-controls-report.json", "japan-photo-retry-browser-report.json",
            "japan-pagination24-browser-report.json", "japan-catalog-city-report.json",
            "image-storage-proof.json", "image-restoration-report.json",
            "catalog-next-photo-browser-report.json", "catalog-next-photo-japan-browser-report.json")
FILES = REQUIRED + OPTIONAL
GENERATION = "gen_china_45875678028_1"
SERVING_RUNTIME = "a5ca426eec2663eb17c2df69fe2bfed46e2b8740"
PRICING_RUNTIME = "64c6338e0db23c8999096bceefbf113c0136fe15"
BASE = "https://api.github.com/repos/" + REPOSITORY + "/actions/"
SAFE_INTEGER = 9007199254740991
KIND = "japan-pagination24-failed-release-inspection-v1"


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


RUNTIME = "889c5150803f7973fc371d1d90491bb38cbabf82"
RUNTIME_TREE = "c9d6371dab51839ace654703509d1272656adf93"
SCOPE = "catalog-japan-pagination24-v1"
MANIFEST = "58263ea4dc5642c9ff6f544830e9d3536ba702fb729a7a8c33b049b70b737038"
IMAGE = "sha256:f220217289e20f819e5825b897e2c22394adc01d612f73b54c9fef9bff1eef66"
FAILURE = "china_daily_release_japan_browser_failed"
STAGES = set(("preconditions plain_first plain_warm brand_directory_api power_api pagination_plain_page_two "
              "power_ui brand_directory_rail power_list pagination_power_page_two power_detail home_visibility "
              "catalog_visibility completion_city_hydration brand_directory_filter completion_petrol_power_toggle "
              "completion_petrol_power_page_two completion_detail_power completion_delivered_calculation release_after").split())
ERROR_CODES = set(["japan_browser_api_scope","japan_browser_arguments","japan_browser_brand_directory_duplicate","japan_browser_brand_directory_rows","japan_browser_brand_directory_unavailable","japan_browser_brand_filter_names","japan_browser_brand_rail_false_empty","japan_browser_brand_rail_layout","japan_browser_brand_rail_names","japan_browser_calculation_binding","japan_browser_calculation_breakdown","japan_browser_calculation_changed","japan_browser_calculation_city","japan_browser_calculation_detail_binding","japan_browser_calculation_ledger","japan_browser_calculation_observed","japan_browser_calculation_parameters","japan_browser_calculation_response","japan_browser_calculation_response_size","japan_browser_calculation_source_price","japan_browser_calculation_total","japan_browser_calculation_visible_car","japan_browser_calculation_visible_city","japan_browser_calculation_visible_total","japan_browser_catalog_warning","japan_browser_check_failed","japan_browser_city_after_toggle","japan_browser_city_hydration","japan_browser_code_scope","japan_browser_continuation_cursor","japan_browser_continuation_query","japan_browser_continuation_scope","japan_browser_detail_city","japan_browser_detail_http","japan_browser_detail_javascript","japan_browser_detail_link","japan_browser_detail_power_input","japan_browser_detail_supplier_power","japan_browser_detail_unknown_power","japan_browser_excluded_vehicle_visible","japan_browser_exhausted_count","japan_browser_false_exact_count","japan_browser_http","japan_browser_identifier","japan_browser_known_after_unknown","japan_browser_list_count","japan_browser_list_supplier_power","japan_browser_list_unknown_power","japan_browser_local_power","japan_browser_observation_expired","japan_browser_oracle_binding","japan_browser_output","japan_browser_overview_city","japan_browser_overview_http","japan_browser_overview_javascript","japan_browser_overview_link","japan_browser_page_errors","japan_browser_pagination_count","japan_browser_pagination_cursor","japan_browser_pagination_duplicate","japan_browser_pagination_emitted_cursor","japan_browser_pagination_evidence","japan_browser_pagination_exhausted_cursor","japan_browser_pagination_fuel","japan_browser_pagination_kind","japan_browser_pagination_page","japan_browser_pagination_plain_http","japan_browser_pagination_plain_javascript","japan_browser_pagination_power_javascript","japan_browser_pagination_query","japan_browser_pagination_scope","japan_browser_pagination_ui_city","japan_browser_pagination_ui_first_count","japan_browser_pagination_ui_first_identity","japan_browser_pagination_ui_next_count","japan_browser_pagination_ui_next_identity","japan_browser_pagination_ui_next_link","japan_browser_petrol","japan_browser_petrol_api_fuel","japan_browser_petrol_calculation_sample","japan_browser_petrol_catalog_delivered","japan_browser_petrol_detail_city_link","japan_browser_petrol_false_zero","japan_browser_petrol_initial_toggle","japan_browser_petrol_page_http","japan_browser_petrol_page_two_count","japan_browser_petrol_page_two_identity","japan_browser_petrol_page_two_query","japan_browser_petrol_page_two_rows","japan_browser_petrol_toggle_query","japan_browser_petrol_ui_city","japan_browser_petrol_ui_count","japan_browser_petrol_ui_identity","japan_browser_petrol_ui_shown","japan_browser_power_order_duplicate","japan_browser_power_order_no_known_sample","japan_browser_power_order_pages","japan_browser_power_order_unlabelled","japan_browser_power_page_http","japan_browser_power_page_number","japan_browser_power_summary","japan_browser_release_changed","japan_browser_report_exists","japan_browser_report_failed","japan_browser_rows","japan_browser_short_page_with_more","japan_browser_supplier_power","japan_browser_ui_count","japan_browser_ui_identity","japan_browser_ui_stale","japan_browser_ui_supplier_power","japan_browser_ui_unknown_power","japan_browser_unavailable_or_stale","japan_browser_unknown_unlabelled","japan_browser_usability_partial","japan_browser_usability_rows","japan_browser_vehicle_policy_no_sample","japan_browser_warm_changed"])
FLAGS = ("passed japanFreshnessPassed japanPowerApiPassed japanUiPassed japanVisibilityPassed readOnlyBrowserFence "
         "japanPetrolPowerUiPassed japanDetailPowerInputPassed japanDeliveredCalculationPassed japanFullPagesPassed "
         "japanPagination24Passed japanCatalogWarningRemovedPassed japanBrandDirectoryPassed japanKnownPowerOrderPassed "
         "japanVehiclePolicyPassed japanQuietCatalogPassed").split()
REASONS = set(("client_ip_missing not_configured market_not_supported invalid_query visitor_restricted request_failed "
               "request_timeout connect_timeout response_too_large query_too_large empty_response invalid_response "
               "identity_mismatch quota_invalid quota_exhausted quota_busy local_busy directory_unavailable "
               "cursor_expired source_disabled operation_failed").split())
DISPOSITIONS = set(("source source_recovery memory_cache saved_cache cooldown_recovery local_recovery "
                    "policy_empty shared_or_cached rejected unavailable").split())
OMISSIONS = set(("catalog_receipt_missing catalog_receipt_malformed source_receipts_missing source_receipts_malformed "
                 "source_receipt_malformed source_receipt_duplicate source_receipt_limit source_read_calls_mismatch "
                 "source_receipts_limited_unknown source_receipts_limited source_evidence_malformed").split())


def exact_keys(value, names):
    need(type(value) is dict and set(value) == set(names.split()), "evidence_keys")


def signed_integer(value):
    need(type(value) is int and abs(value) <= SAFE_INTEGER, "report_signed_integer")
    return value


def bounded_int(value, low, high):
    need(type(value) is int and low <= value <= high, "report_integer_range")
    return value


def number(value):
    need(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= SAFE_INTEGER, "report_number")
    return value


def nullable(check):
    return lambda value: None if value is None else check(value)


def enum(allowed):
    def check(value):
        need(type(value) is str and value in allowed, "report_enum")
        return value
    return check


def stage(value):
    return value if type(value) is str and value in STAGES else "unclassified"


def reason(value):
    if value is None:
        return None
    need(type(value) is str and (value in REASONS or re.fullmatch(r"http_[1-5][0-9]{2}", value)), "report_reason")
    return value


def cache_control(value):
    need(type(value) is str and 0 < len(value) <= 512, "cache_control")
    simple = {"public", "private", "no-cache", "no-store", "must-revalidate", "proxy-revalidate",
              "immutable", "no-transform", "must-understand"}
    numeric = {"max-age", "s-maxage", "stale-while-revalidate", "stale-if-error"}
    parts = value.split(",")
    need(len(parts) <= 16, "cache_control")
    output = []
    for part in parts:
        part = part.strip().lower()
        if part in simple:
            output.append(part)
            continue
        match = re.fullmatch(r"([a-z-]+)=(0|[1-9][0-9]{0,9})", part)
        need(match is not None and match[1] in numeric and int(match[2]) <= 2147483647, "cache_control")
        output.append(match[1] + "=" + str(int(match[2])))
    return ", ".join(output)


def response_headers(value):
    need(type(value) is dict, "headers_object")
    output, omitted = {}, []
    known = ("cache-control", "age", "etag", "via")
    for key, label in (("cacheControl", "cache-control"), ("ageSeconds", "age"), ("etag", "etag"), ("via", "via")):
        if key not in value:
            continue
        try:
            item = value[key]
            if key == "cacheControl":
                output[key] = cache_control(item)
            elif key == "ageSeconds":
                output[key] = bounded_int(item, 0, 2147483647)
            elif key == "etag":
                exact_keys(item, "weak sha256")
                output[key] = {"weak": boolean(item["weak"]), "sha256": sha256(item["sha256"])}
            else:
                exact_keys(item, "hops protocols")
                bounded_int(item["hops"], 1, 8)
                need(type(item["protocols"]) is list and len(item["protocols"]) <= 8, "via_protocols")
                output[key] = {"hops": item["hops"], "protocols": [
                    enum({"1.0", "1.1", "2", "2.0", "3", "3.0"})(p) for p in item["protocols"]]}
        except Guard:
            omitted.append(label)
    incoming = value.get("omitted", [])
    need(type(incoming) is list and len(incoming) <= 4, "headers_omissions")
    omitted += [enum(set(known))(v) for v in incoming]
    output["omitted"] = sorted(set(omitted))
    return output


def transport(value):
    return project(value, {
        **fields(nullable(timestamp), "requestedAt receivedAt"),
        "durationMs": nullable(number), "responseHeaders": response_headers,
    })


def response_evidence(value):
    need(type(value) is dict and set(value) <= set(("version mime encoding bodyClass bytesRead truncated readStatus identifier").split()),
         "response_evidence_keys")
    output = project(value, {
        "version": exact(1), "mime": enum({"json", "html", "text", "other", "missing"}),
        "encoding": enum({"identity", "gzip", "other", "missing"}),
        "bodyClass": enum(set(("empty bot_refusal ban_refusal sql_syntax sql_unknown_column sql_unsupported_function "
                              "json_unclassified html_unclassified text_unclassified binary_unclassified unclassified").split())),
        "bytesRead": lambda v: bounded_int(v, 0, 4096), "truncated": boolean,
        "readStatus": enum({"complete", "limit", "timeout", "aborted", "read_error", "no_body", "chunk_limit"}),
    }, ("version", "mime", "encoding", "bodyClass", "bytesRead", "truncated", "readStatus"))
    status, count, truncated = output["readStatus"], output["bytesRead"], output["truncated"]
    need(status != "limit" or count == 4096 and truncated, "response_evidence_limit")
    need(status != "complete" or not truncated, "response_evidence_complete")
    need(status != "no_body" or count == 0 and not truncated and output["bodyClass"] == "empty", "response_evidence_empty")
    need(status not in {"timeout", "aborted", "read_error", "chunk_limit"} or truncated, "response_evidence_truncated")
    if "identifier" in value:
        columns = set("id year auction_type status finish marka_name model_name grade auction_date time kpp priv kuzov color eng_v mileage rate serial lot pw".split())
        functions = {"concat_ws", "length", "trim", "count"}
        allowed = columns if output["bodyClass"] == "sql_unknown_column" else functions if output["bodyClass"] == "sql_unsupported_function" else set()
        need(not truncated, "response_evidence_identifier")
        output["identifier"] = enum(allowed)(value["identifier"])
    return output


def source_attempt(value):
    if value is None:
        return None
    output = project(value, {"startedAt": timestamp, "finishedAt": timestamp,
                            "httpStatus": nullable(lambda v: bounded_int(v, 100, 599))},
                     ("startedAt", "finishedAt", "httpStatus"))
    if "responseEvidence" in value:
        need(output["httpStatus"] is not None and not 200 <= output["httpStatus"] <= 299, "response_evidence_status")
        output["responseEvidence"] = response_evidence(value["responseEvidence"])
    return output


def source_receipt(value):
    # Whitelist projection only. Never echo arbitrary fields, raw errors or URLs.
    return project(value, {
        "version": exact(1), "readId": lambda v: matching(v, r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"),
        "runtimeSha": nullable(sha40), **fields(timestamp, "readStartedAt readFinishedAt"),
        "table": nullable(enum({"stats", "main"})),
        "kind": nullable(enum({"list", "detail", "count", "models", "makes", "colors"})),
        "page": nullable(lambda v: bounded_int(v, 1, 1000000)),
        "pageSize": nullable(lambda v: bounded_int(v, 1, 500)),
        **fields(nullable(sha256), "canonicalQuerySha256 wireQuerySha256"),
        "disposition": enum(DISPOSITIONS), "sourceAttempted": nullable_boolean, "reason": reason,
        "sourceAttempt": source_attempt, "emptyValidation": exact(True),
    }, ("version", "readId", "runtimeSha", "readStartedAt", "readFinishedAt", "table", "kind", "page",
        "pageSize", "canonicalQuerySha256", "wireQuerySha256", "disposition", "sourceAttempted", "reason", "sourceAttempt"))


def source_evidence(value, budget):
    need(type(value) is dict, "source_evidence_object")
    status = enum({"missing", "omitted", "partial", "recorded"})(value.get("status"))
    raw = value.get("sourceReadReceipts", [])
    need(type(raw) is list and len(raw) <= 8, "source_receipts_limit")
    output = {"status": status, "sourceReadReceipts": [], "receiptDetailsOmitted": 0}
    for key in ("runtimeMatchesExpected", "sourceReadReceiptsLimited"):
        if key in value:
            output[key] = nullable_boolean(value[key])
    if "omittedReceipts" in value:
        output["omittedReceipts"] = nullable(integer)(value["omittedReceipts"])
    omissions = value.get("omissions", [])
    need(type(omissions) is list and len(omissions) <= 32, "source_omissions")
    output["omissions"] = sorted(set(enum(OMISSIONS)(v) for v in omissions))
    wrapper = value.get("catalogReadReceipt")
    if wrapper is not None:
        output["catalogReadReceipt"] = project(wrapper, {
            "version": exact(1), "readId": lambda v: matching(v, r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"),
            "runtimeSha": nullable(sha40), **fields(timestamp, "readStartedAt readFinishedAt"),
            "sourceReadCalls": lambda v: bounded_int(v, 0, 8),
        }, ("version", "readId", "runtimeSha", "readStartedAt", "readFinishedAt", "sourceReadCalls"))
    for item in raw:
        if budget[0] <= 0:
            output["receiptDetailsOmitted"] += 1
            continue
        try:
            receipt = source_receipt(item)
        except Guard:
            output["receiptDetailsOmitted"] += 1
            continue
        budget[0] -= 1
        output["sourceReadReceipts"].append(receipt)
    return output


def japan_response(value, budget):
    output = project(value, {
        "stage": stage, "status": nullable(lambda v: bounded_int(v, 100, 599)),
        **fields(nullable_boolean, "ok stale partial interrupted scanLimited hasMore"),
        **fields(nullable(integer), "shown received total"), "observedAt": nullable(timestamp),
    }, ("stage", "status", "ok", "shown", "received", "observedAt", "stale", "partial", "interrupted", "scanLimited", "hasMore", "total"))
    output.update(transport(value))
    if "sourceReadEvidence" in value:
        try:
            output["sourceReadEvidence"] = source_evidence(value["sourceReadEvidence"], budget)
        except Guard:
            output["sourceReadEvidence"] = {"status": "omitted", "omissions": ["source_evidence_malformed"]}
    return output


def japan_report(value, run, cycle):
    need(type(value) is dict and type(value.get("version")) is int and value["version"] == 1
         and value.get("kind") == "catalog-japan-browser-v1" and value.get("codeScope") == SCOPE
         and value.get("release") == RUNTIME and value.get("passed") is False, "failed_japan_binding")
    matching(value.get("nonce"), r"[a-f0-9]{32}")
    need(clock(run["run_started_at"]) <= clock(value.get("checkedAt")) <= clock(cycle["finishedAt"])
         <= clock(run["updated_at"]), "japan_time")
    for key in ("productionMutations", "directSupplierApiRequests"):
        need(type(value.get(key)) is int and value[key] == 0, "japan_write_scope")
    output = project(value, {
        **fields(boolean, " ".join(FLAGS)),
        **fields(integer, "productionMutations directSupplierApiRequests supplierImageRequests explicitJapanApiRequests japanPreviewCalculationRequests"),
        "checkedAt": timestamp, "nonce": lambda v: matching(v, r"[a-f0-9]{32}"),
        "generationManifestSha256": exact(MANIFEST), "oracleSha256": sha256,
    })
    output.update({"version": 1, "kind": "catalog-japan-browser-v1", "codeScope": SCOPE, "release": RUNTIME})
    error = value.get("error")
    need(type(error) is dict, "japan_error")
    output["error"] = {"stage": stage(error.get("stage")),
                       "code": error.get("code") if type(error.get("code")) is str and error["code"] in ERROR_CODES else "unclassified",
                       "timeout": boolean(error.get("timeout"))}
    checks = value.get("checks", {})
    need(type(checks) is dict, "japan_checks")
    responses = checks.get("responses", [])
    need(type(responses) is list and len(responses) <= 32, "japan_responses_limit")
    # Preserve the failing/latest observations first in the shared receipt budget;
    # return observations in their original order. Earlier omissions are explicit.
    selected = responses[-16:]
    budget = [8]
    safe = [japan_response(item, budget) for item in reversed(selected)]
    output["responses"] = list(reversed(safe))
    output["earlierResponsesOmitted"] = len(responses) - len(selected)
    health = checks.get("health", [])
    need(type(health) is list and len(health) <= 2, "health_limit")
    output["health"] = []
    for item in health:
        entry = project(item, {"stage": enum({"before", "after"}),
                               "status": lambda v: bounded_int(v, 100, 599), "ok": nullable_boolean,
                               "releaseSha": nullable(sha40), "calculationVersion": nullable(sha256)},
                        ("stage", "status", "ok", "releaseSha", "calculationVersion"))
        entry.update(transport(item))
        output["health"].append(entry)
    output["globalJapanTotalVerified"] = False
    output["acceptanceSucceeded"] = False
    return output


def saved_failure(value):
    need(type(value) is dict and type(value.get("version")) is int and value["version"] == 1
         and value.get("kind") == "japan-usability-saved-failure-v1"
         and type(value.get("supplierRequests")) is int and value["supplierRequests"] == 0
         and type(value.get("writes")) is int and value["writes"] == 0, "saved_failure_binding")
    records = value.get("records")
    need(type(records) is list and len(records) <= 3, "saved_failure_records")
    output = {"version": 1, "kind": "japan-usability-saved-failure-v1", "records": [],
              "supplierRequests": 0, "writes": 0, "sameRequestCorrelationVerified": False}
    if "readStatus" in value:
        need(value["readStatus"] == "configuration_unavailable" and not records, "saved_failure_configuration")
        output["readStatus"] = "configuration_unavailable"
        return output
    slots = ("stats-list-1", "stats-count", "stats-latest")
    need(len(records) == 3 and [v.get("slot") for v in records if type(v) is dict] == list(slots), "saved_failure_slots")
    outcomes = set(("visitor_restricted request_failed request_timeout connect_timeout quota_exhausted quota_busy "
                    "local_busy invalid_response empty_response query_too_large response_too_large identity_mismatch").split())
    def outcome(item):
        need(item is None or type(item) is str and (item in outcomes or re.fullmatch(r"http_[1-5][0-9]{2}", item)), "saved_outcome")
        return item
    for item in records:
        record = project(item, {
            "slot": enum(set(slots)),
            "readStatus": enum({"ok", "missing", "unavailable", "deadline", "byte_limit"}),
            **fields(nullable(timestamp), "startedAt finishedAt"),
            "kind": nullable(enum({"list", "detail", "count", "models", "makes", "colors"})),
            "outcome": outcome, "page": nullable(lambda v: bounded_int(v, 1, 1000000)),
            "pageSize": nullable(lambda v: bounded_int(v, 1, 500)),
            "httpStatus": nullable(lambda v: bounded_int(v, 100, 599)),
            "sqlSha256": nullable(sha256), "sqlBytes": nullable(integer),
        }, ("slot", "readStatus"))
        provider = item.get("providerCode")
        need(provider is None or type(provider) is str and re.fullmatch(r"(?:bot|ban)[0-9]{0,13}", provider), "saved_provider_code")
        record["providerKind"] = None if provider is None else "bot" if provider.startswith("bot") else "ban"
        output["records"].append(record)
    return output


def image_cleanup(value):
    common = "version kind completed status uncertain"
    need(type(value) is dict, "image_cleanup_object")
    if value.get("completed") is False:
        exact_keys(value, common + " errorCode")
        need(type(value["version"]) is int and value["version"] == 1
             and value["kind"] == "china-terminal-app-image-cleanup-v1"
             and value["status"] == "pending" and type(value["uncertain"]) is bool
             and value["errorCode"] in {"operation_failed", "authority_unavailable", "transport_unknown",
                                       "proof_invalid", "delete_not_confirmed"}, "image_cleanup_pending")
        return value
    exact_keys(value, common + " imagesRemoved runtimeSha imageId witnessSha256 diskFreeBytesBefore "
               "diskFreeBytesAfter measuredFreeBytesChange reason")
    reasons = {"removed": {"exact_terminal_image"}, "already_absent": {"already_absent"},
               "protected": {"current_or_rollback", "container_reference", "pinned_image",
                             "retained_bootstrap", "ineligible_image"},
               "not_applicable": {"no_terminal_image"}}
    need(type(value["version"]) is int and value["version"] == 1
         and value["kind"] == "china-terminal-app-image-cleanup-v1" and value["completed"] is True
         and value["uncertain"] is False and value["status"] in reasons
         and value["reason"] in reasons[value["status"]], "image_cleanup_status")
    count = integer(value["imagesRemoved"])
    need(count == (1 if value["status"] == "removed" else 0), "image_cleanup_count")
    if value["status"] == "not_applicable":
        need(value["runtimeSha"] is None and value["imageId"] is None, "image_cleanup_no_target")
    else:
        sha40(value["runtimeSha"])
        matching(value["imageId"], r"sha256:[a-f0-9]{64}")
    sha256(value["witnessSha256"])
    before, after = integer(value["diskFreeBytesBefore"]), integer(value["diskFreeBytesAfter"])
    need(signed_integer(value["measuredFreeBytesChange"]) == after - before, "image_cleanup_bytes")
    return value



def main():
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(120)
    need(type(RUN) is int and 0 < RUN <= SAFE_INTEGER and type(ARTIFACT) is int
         and 0 < ARTIFACT <= SAFE_INTEGER and type(ARCHIVE_BYTES) is int
         and 0 < ARCHIVE_BYTES <= 8 * 1024 * 1024
         and type(HEAD) is str and re.fullmatch(r"[a-f0-9]{40}", HEAD) is not None
         and type(DIGEST) is str and re.fullmatch(r"[a-f0-9]{64}", DIGEST) is not None, "unbound_template")
    token = os.environ.get("GITHUB_TOKEN", "")
    need(0 < len(token) <= 4096, "configuration")
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
         and run.get("conclusion") == "failure" and run.get("head_sha") == HEAD
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
        need(0 < len(infos) <= 64 and sum(not i.is_dir() for i in infos) == 11
             and len({i.filename for i in infos}) == len(infos), "zip_entries")
        for item in infos:
            parts = item.filename.split("/")
            need(not item.filename.startswith("/") and not "\\" in item.filename
                 and all(p not in (".", "..") for p in parts)
                 and item.orig_filename == item.filename, "zip_path")
            name = parts[-1]
            if name not in FILES:
                continue
            cap = 128 * 1024 if name == "catalog-next-japan-browser-report.json" else 64 * 1024
            need(name not in reports and not item.is_dir() and not item.flag_bits & 1
                 and stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG)
                 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                 and 0 < item.file_size <= cap, "zip_entry")
            with bundle.open(item) as stream:
                raw = stream.read(cap + 1)
            need(len(raw) == item.file_size and len(raw) <= cap, "entry_size")
            reports[name], raw_reports[name], hashes[name] = parse(raw), raw, hashlib.sha256(raw).hexdigest()
    need(set(REQUIRED) <= set(reports), "required_evidence")
    cycle, japan, failures, image = [reports[name] for name in REQUIRED]
    need(type(cycle) is dict and type(cycle.get("version")) is int and cycle["version"] == 1
         and cycle.get("kind") == "china-code-cycle-v1" and cycle.get("market") == "china"
         and cycle.get("completed") is False and cycle.get("published") is False
         and cycle.get("status") == "rolled_back" and cycle.get("runtimeSha") == RUNTIME
         and cycle.get("retainedRuntime") == SERVING_RUNTIME and cycle.get("leaseReleased") is True
         and cycle.get("retentionPreserved") is True and not cycle.get("leaseReleasePending")
         and cycle.get("errorCode") == FAILURE, "rolled_back_cycle")
    zero_fields = "sourceRequests generationRestores priceCalculations generationWrites encyclopediaWrites otherMarketWrites deletions".split()
    need(all(type(cycle.get(k)) is int and cycle[k] == 0 for k in zero_fields), "cycle_write_scope")
    need(type(image) is dict and image.get("runtimeSha") == RUNTIME and image.get("runtimeTree") == RUNTIME_TREE
         and image.get("archiveRoundTripVerified") is True and image.get("imageId") == IMAGE, "image_binding")
    if "codeScope" in image:
        need(image["codeScope"] == SCOPE, "image_scope")
    safe_cycle = project(cycle, {
        **fields(boolean, "completed published leaseReleased retentionPreserved recovered hostCleanupPending appImageCleanupPending"),
        **fields(integer, " ".join(zero_fields)),
        "runtimeSha": exact(RUNTIME), "retainedRuntime": exact(SERVING_RUNTIME),
        "finishedAt": timestamp, "status": exact("rolled_back"), "errorCode": exact(FAILURE),
    })
    for key in ("hostCleanup", "hostCleanupBeforeReserve"):
        if key in cycle:
            safe_cycle[key] = cleanup(cycle[key])
    for key in ("appImageCleanup", "appImageCleanupBeforeReserve"):
        if key in cycle:
            safe_cycle[key] = image_cleanup(cycle[key])
    terminal_cleanup = safe_cycle.get("appImageCleanup", {})
    need(terminal_cleanup.get("completed") is True and terminal_cleanup.get("status") == "removed"
         and terminal_cleanup.get("runtimeSha") == RUNTIME and terminal_cleanup.get("imageId") == IMAGE
         and terminal_cleanup.get("imagesRemoved") == 1
         and terminal_cleanup.get("measuredFreeBytesChange") == 1191686144, "terminal_image_cleanup")
    safe_japan = japan_report(japan, run, cycle)
    safe_failures = saved_failure(failures)
    optional = sorted(set(reports) - set(REQUIRED))
    output = {
        "version": 1, "kind": KIND, "status": "verified_failed_release",
        "runId": RUN, "headSha": HEAD, "runConclusion": "failure", "runAttempt": 1,
        "artifactId": ARTIFACT, "artifactSha256": DIGEST, "archiveBytes": len(archive),
        "archiveFileCount": sum(not item.is_dir() for item in infos),
        "entrySha256": hashes, "entryBytes": {key: len(value) for key, value in raw_reports.items()},
        "optionalRecognizedEntries": optional, "optionalContentsProjected": False,
        "ignoredEntryCount": len(infos) - len(reports),
        "requests": calls, "directSupplierRequests": 0, "publicSiteRequests": 0,
        "hostRequests": 0, "productionMutations": 0,
        "cycle": safe_cycle, "japan": safe_japan, "savedSourceFailure": safe_failures,
        "image": {"runtimeSha": RUNTIME, "runtimeTree": RUNTIME_TREE, "imageId": IMAGE, "archiveRoundTripVerified": True},
        "checks": {"exactRunAndArtifact": True, "rolledBackCycle": True, "candidateNotAccepted": True,
                   "retainedRuntimeBinding": True, "leaseReleased": True,
                   "failedJapanReport": True, "imageBinding": True, "terminalImageRemoved": True,
                   "globalJapanTotalVerified": False, "savedFailureSameRequestVerified": False},
        "limitations": {"currentPublicRuntimeNotProbed": True, "privateStateNotRead": True,
                        "savedFailuresAreLatestSharedObjects": True, "receiptAbsenceDoesNotProveNoSourceAttempt": True,
                        "sourceFailureCauseNotInferred": True, "cleanupBytesAreObservedDeltaNotImageLogicalSize": True}}
    encoded = json.dumps(output, separators=(",", ":"), ensure_ascii=True)
    need(calls == 4 and len(encoded.encode("utf-8")) <= 32768, "output_cap")
    signal.alarm(0)
    print(encoded)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is Guard else "inspection_error"
        print(json.dumps({"version": 1, "kind": KIND, "status": "failed", "errorCode": code}, separators=(",", ":")))
        sys.exit(1)
