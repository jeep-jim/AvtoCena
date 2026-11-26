"""Read exactly three GitHub metadata endpoints; never contact the catalog or suppliers."""
import datetime
import hashlib
import json
import os
import pathlib
import re
import signal
import sys
import urllib.error
import urllib.request

REPO = "jeep-jim/AvtoCena"
REPO_ID = 1289722938
WORKFLOW = ".github/workflows/catalog-next-china-daily.yml"
BASE = "https://api.github.com/repos/" + REPO
KIND = "china-schedule-metadata-readonly-v1"

class Guard(Exception):
    pass

def need(value, code):
    if not value:
        raise Guard(code)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def deadline(_signum, _frame):
    raise Guard("deadline")

def main():
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(90)
    token = os.environ.get("GITHUB_TOKEN", "")
    need(0 < len(token) <= 4096, "token_configuration")
    headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AvtoCena-fixed-schedule-metadata-reader"}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    calls = 0
    def get(path):
        nonlocal calls
        calls += 1
        need(calls <= 3, "request_cap")
        try:
            response = opener.open(urllib.request.Request(BASE + path, headers=headers, method="GET"), timeout=25)
        except urllib.error.HTTPError:
            raise Guard("github_http_status") from None
        except Exception:
            raise Guard("github_transport") from None
        with response:
            need(response.status == 200, "github_http_status")
            raw = response.read(1048577)
            need(len(raw) <= 1048576, "body_cap")
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            raise Guard("github_json") from None
        need(type(body) is dict, "github_shape")
        return body
    repository = get("")
    need(repository.get("id") == REPO_ID and repository.get("full_name") == REPO, "repository_binding")
    workflow = get("/actions/workflows/catalog-next-china-daily.yml")
    need(type(workflow.get("id")) is int and workflow["id"] > 0 and workflow.get("path") == WORKFLOW,
        "workflow_binding")
    state = workflow.get("state")
    need(type(state) is str and re.fullmatch(r"[a-z_]{1,40}", state), "workflow_state")
    result = get("/actions/workflows/" + str(workflow["id"]) + "/runs?event=schedule&branch=main&per_page=20")
    runs = result.get("workflow_runs")
    need(type(result.get("total_count")) is int and result["total_count"] >= 0
         and type(runs) is list and len(runs) <= 20 and result["total_count"] >= len(runs), "runs_shape")
    projected = []
    for run in runs:
        need(type(run) is dict and type(run.get("id")) is int and run["id"] > 0
             and run.get("workflow_id") == workflow["id"] and run.get("path") == WORKFLOW
             and run.get("event") == "schedule" and run.get("head_branch") == "main"
             and run.get("repository", {}).get("id") == REPO_ID
             and type(run.get("head_sha")) is str and re.fullmatch(r"[a-f0-9]{40}", run["head_sha"]), "run_binding")
        for field in ("created_at", "updated_at"):
            need(type(run.get(field)) is str and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", run[field]), "run_time")
        need(run.get("status") in ("completed", "queued", "in_progress", "waiting", "pending", "requested")
             and run.get("conclusion") in (None, "success", "failure", "neutral", "cancelled", "skipped",
                                          "timed_out", "action_required", "stale", "startup_failure"), "run_status")
        projected.append({k: run.get(k) for k in ("id", "head_sha", "created_at", "updated_at", "status", "conclusion")})
    raw_workflow = pathlib.Path(WORKFLOW).read_bytes()
    need(len(raw_workflow) <= 16384, "source_size")
    crons = re.findall(r"^\s*- cron: '([^'\r\n]+)'\s*$", raw_workflow.decode("utf-8"), re.MULTILINE)
    need(crons == ["0 14 * * *", "17 0,3,6,9,12,15,18,21 * * *"], "source_schedule")
    branch = repository.get("default_branch")
    need(type(branch) is str and re.fullmatch(r"[A-Za-z0-9_./-]{1,200}", branch), "repository_branch")
    need(type(repository.get("archived")) is bool and type(repository.get("disabled")) is bool, "repository_state")
    report = {"version": 1, "kind": KIND, "status": "observed",
        "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "repositoryId": REPO_ID, "defaultBranch": branch, "repositoryArchived": repository["archived"],
        "repositoryDisabled": repository["disabled"], "workflowId": workflow["id"], "workflowPath": WORKFLOW,
        "workflowState": state, "workflowSourceSha256": hashlib.sha256(raw_workflow).hexdigest(),
        "scheduleExpressionsUtc": crons, "matchingScheduleRunTotal": result["total_count"],
        "recentScheduleRuns": projected, "listedRunLimit": 20, "requests": calls,
        "productionRequests": 0, "directSupplierRequests": 0, "productionMutations": 0,
        "githubMutations": 0, "schedulerCauseEstablished": False}
    text = json.dumps(report, separators=(",", ":"), sort_keys=True) + "\n"
    need(len(text.encode("utf-8")) <= 16384, "output_cap")
    signal.alarm(0)
    return text

if __name__ == "__main__":
    try:
        output = main()
        code = 0
    except Exception as error:
        error_code = str(error) if type(error) is Guard else "inspection_error"
        output = json.dumps({"version": 1, "kind": KIND, "status": "failed", "errorCode": error_code},
            separators=(",", ":")) + "\n"
        code = 1
    with open("china-schedule-metadata-20261127.json", "x", encoding="utf-8") as file:
        file.write(output)
    sys.stdout.write(output)
    sys.exit(code)
