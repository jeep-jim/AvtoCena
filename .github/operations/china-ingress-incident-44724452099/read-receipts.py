"""Observe only the four historical ingress markers; return no values from disk."""
import json
import os
from pathlib import Path
import re
import stat

RUN = "44724452099"
APP = "85296f6b8797aaa93227b69da7e9e9e928e8f9b5"
OLD = "83ff17075e9188dcf227c8752dc064248d5f42e0"
ROOT = Path("/opt/avtocena/releases") / APP / "china-switch-runs" / RUN / "ingress-rollback"
NAMES = ("expect.json", "rollback.json", "candidate-policy-rollback.json", "ingress.json")
CAP = 4096
DFLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FFLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK

def matches(s, rx=r"[a-f0-9]{64}"):
    return isinstance(s, str) and re.fullmatch(rx, s, flags=re.ASCII) is not None

def private(st, owner, directory):
    return st.st_uid == owner and (stat.S_ISDIR if directory else stat.S_ISREG)(st.st_mode) and not st.st_mode & 0o077

def read_dir(path, owner):
    """No traversal via symlink, including any ancestors."""
    fd = os.open("/", DFLAGS)
    try:
        for part in path.parts[1:]:
            nextfd = os.open(part, DFLAGS, dir_fd=fd)
            os.close(fd)
            fd = nextfd
        if not private(os.fstat(fd), owner, True):
            raise PermissionError
        result, fd = fd, None
        return result
    finally:
        if fd is not None:
            os.close(fd)

def no_dupes(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError
    return result

def read_marker(dirfd, name, owner):
    try:
        fd = os.open(name, FFLAGS, dir_fd=dirfd)
    except FileNotFoundError:
        return "missing", None
    except OSError:
        return "unreadable_or_unsafe", None
    try:
        with os.fdopen(fd, "rb", closefd=True) as f:
            s = os.fstat(f.fileno())
            if not private(s, owner, False) or not 0 < s.st_size <= CAP:
                return "unreadable_or_unsafe", None
            data = f.read(CAP + 1)
            ended = os.fstat(f.fileno())
            if len(data) != s.st_size or s.st_mtime_ns != ended.st_mtime_ns or s.st_size != ended.st_size:
                return "unreadable_or_unsafe", None
            v = json.loads(data, object_pairs_hook=no_dupes)
        return ("observed", v) if type(v) is dict else ("invalid_shape", None)
    except (UnicodeError, ValueError, RecursionError):
        return "invalid_shape", None
    except OSError:
        return "unreadable_or_unsafe", None

def expectation(v):
    return (set(v) == {"before", "candidate", "oldContainerId", "candidateContainerId", "candidateProcess",
                       "candidateRestartBefore", "candidateRestartAfter"} and
            all(matches(v[x]) for x in ("before", "candidate", "oldContainerId", "candidateContainerId")) and
            v["before"] != v["candidate"] and v["oldContainerId"] != v["candidateContainerId"] and
            (v["candidateRestartBefore"], v["candidateRestartAfter"]) == ("no", "unless-stopped") and
            isinstance(v["candidateProcess"], list) and len(v["candidateProcess"]) == 3 and
            matches(v["candidateProcess"][0], r"[^\s]{1,80}") and
            type(v["candidateProcess"][1]) is int and 0 < v["candidateProcess"][1] <= 2**31 and
            type(v["candidateProcess"][2]) is int and 0 <= v["candidateProcess"][2] <= 2**31)

def rollback(v):
    return (set(v) == {"status", "runtimeRelease", "nginxSha256", "doNotAssumeChinaControlRestored", "candidateRestartPolicyRollbackPending"} and
            v["status"] == "old_ingress_restored" and v["runtimeRelease"] == OLD and matches(v["nginxSha256"]) and
            v["doNotAssumeChinaControlRestored"] is True and type(v["candidateRestartPolicyRollbackPending"]) is bool)

def policy(v):
    return v == {"status": "candidate_restart_policy_restored", "policy": "no", "candidateProcessUnchanged": True} and v["candidateProcessUnchanged"] is True

def ingress(v):
    return (
        set(v) == {"status", "runtimeRelease", "generationId", "controlSha256", "oldContainerRetained",
                   "protectedCanariesUnchanged", "protectedMarketsReadback", "nginxBeforeSha256", "nginxAfterSha256",
                   "candidateRestartPolicy", "candidateProcessUnchanged", "publicationDataWrites"} and
        v["status"] == "china_public_ingress_verified" and v["runtimeRelease"] == APP and
        matches(v["generationId"], r"gen_[0-9]{13}_[a-z0-9]{1,64}") and
        all(matches(v[k]) for k in ("nginxBeforeSha256", "nginxAfterSha256", "controlSha256")) and
        v["nginxBeforeSha256"] != v["nginxAfterSha256"] and
        all(v[k] is True for k in ("oldContainerRetained", "protectedCanariesUnchanged", "candidateProcessUnchanged")) and
        v["candidateRestartPolicy"] == "unless-stopped" and type(v["publicationDataWrites"]) is int and
        v["publicationDataWrites"] == 0 and type(v["protectedMarketsReadback"]) is dict and
        set(v["protectedMarketsReadback"]) == {"korea", "uae", "europe", "georgia"} and
        all(x in ("matched", "preexisting_unavailable") for x in v["protectedMarketsReadback"].values()))

def collect(path=ROOT, owner=0):
    statuses = {n: "not_checked" for n in NAMES}
    out = {"kind": "historical_china_ingress_receipts_v1", "runId": RUN, "markers": statuses}
    try:
        fd = read_dir(path, owner)
    except FileNotFoundError:
        return {**out, "directory": "missing", "phase": "no_receipt_directory"}
    except OSError:
        return {**out, "directory": "unreadable_or_unsafe", "phase": "unknown"}
    receipts = {}
    try:
        for name, validates in zip(NAMES, (expectation, rollback, policy, ingress)):
            s, value = read_marker(fd, name, owner)
            if s == "observed":
                if validates(value):
                    receipts[name] = value
                    s = "valid"
                else:
                    s = "invalid_shape"
            statuses[name] = s
    finally:
        os.close(fd)

    e, r, p, i = (receipts.get(n) for n in NAMES)
    phase = "unknown"
    if e and r and not i and statuses[NAMES[3]] == "missing" and r["nginxSha256"] == e["before"]:
        phase = "old_ingress_restored_with_backup"
        if p and r["candidateRestartPolicyRollbackPending"]:
            phase = "old_ingress_and_candidate_policy_restored"
    elif e and i and statuses[NAMES[1]] == statuses[NAMES[2]] == "missing" and (
            i["nginxBeforeSha256"], i["nginxAfterSha256"]) == (e["before"], e["candidate"]):
        phase = "candidate_ingress_success_receipt"
    elif e and all(statuses[n] == "missing" for n in NAMES[1:]):
        phase = "backup_present_no_terminal_receipt"
    elif all(x == "missing" for x in statuses.values()):
        phase = "receipt_directory_created_no_markers"
    return {**out, "directory": "present_private", "phase": phase,
            "rollbackMatchesBackup": bool(e and r and r["nginxSha256"] == e["before"]),
            "candidatePolicyWasAttempted": r["candidateRestartPolicyRollbackPending"] if r else None}

if __name__ == "__main__":
    print(json.dumps(collect(), separators=(",", ":"), sort_keys=True))
