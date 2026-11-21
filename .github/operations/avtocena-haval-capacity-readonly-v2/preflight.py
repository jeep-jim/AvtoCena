"""Read-only observer for the already installed China grid and two rollback processes."""
import hashlib
import http.client
import json
import os
import re
import socket
import ssl
import stat
import subprocess
import sys
import time

HOST = "avtocena.com"
CONFIG = "/etc/nginx/conf.d/avtocena-prepare.conf"
CONFIG_SHA = "b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f"
CALC = "4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90"
ROLES = (
    ("avtocena-china-grid-dark-22867cbcfaee", "22867cbcfaee27b2e8917b6bf880e44827f67b60",
     "8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8", 3002, True),
    ("avtocena-china-candidate-85296f6b8797", "85296f6b8797aaa93227b69da7e9e9e928e8f9b5",
     "0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984", 3000, True),
    ("avtocena-production", "83ff17075e9188dcf227c8752dc064248d5f42e0",
     "4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd", 3001, False),
)
INCUMBENT_ID = "52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d"
HYPOTHETICAL_PORT = 3003
HYPOTHETICAL_NAME = "avtocena-haval-0d577596d14b"
CANDIDATE = "0d577596d14bbd5c4f6eafa48fb9b153ae7ef2ec"
TREE = "a2d52f40104ea8cc3162a21b182478d0225ef997"
RUNTIME_LOCK = "/run/lock/avtocena-runtime-change.lock"
GIB = 1024 ** 3
HEX64 = re.compile(r"[a-f0-9]{64}")

def run(*argv):
    result = subprocess.run(argv, check=True, timeout=7, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL).stdout
    if len(result) > 256 * 1024:
        raise ValueError("output_bound")
    return result

def read(path, limit):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
            raise ValueError("not_regular")
        value = f.read(limit + 1)
    if len(value) > limit:
        raise ValueError("file_bound")
    return value

def config():
    raw = read(CONFIG, 1024 * 1024)
    pattern = rb"(?m)^[\t ]*proxy_pass[\t ]+http://127\.0\.0\.1:(\d+);[\t ]*$"
    return (hashlib.sha256(raw).hexdigest() == CONFIG_SHA
            and re.findall(pattern, raw) == [b"3002"])

def docker_identities():
    objects = json.loads(run("docker", "inspect", "--type", "container", *(r[0] for r in ROLES)))
    result = []
    if len(objects) != len(ROLES):
        raise ValueError("role_count")
    for obj, (name, release, image, port, enabled) in zip(objects, ROLES, strict=True):
        host, state, cfg = obj["HostConfig"], obj["State"], obj["Config"]
        inputs = dict(x.split("=", 1) for x in cfg["Env"] if "=" in x)
        pid, identity, started = state["Pid"], obj["Id"], state["StartedAt"]
        policy = host["RestartPolicy"]["Name"]
        if not (HEX64.fullmatch(identity) and (port != 3002 or identity == INCUMBENT_ID) and
                type(pid) is int and pid > 0 and started and state["Running"] is True and
                not state["Restarting"] and obj["Name"] == "/" + name and
                obj["Image"] == "sha256:" + image and
                cfg["Labels"].get("org.opencontainers.image.revision") == release and
                inputs.get("AVTOCENA_RELEASE_SHA") == release and
                inputs.get("AVTOCENA_CALCULATION_VERSION") == CALC and
                inputs.get("AVTOCENA_CHINA_REGCLOUD_RUNTIME") in (("1",) if enabled else (None, "0")) and
                host["Privileged"] is False and
                host["PortBindings"] == {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(port)}]} and
                policy in ("no", "on-failure", "always", "unless-stopped") and
                (port != 3002 or policy == "unless-stopped")):
            raise ValueError("role_exact")
        result.append((identity, pid, started, obj["RestartCount"], policy))
    return result

def slot():
    listeners = run("ss", "-H", "-ltn", f"sport = :{HYPOTHETICAL_PORT}")
    # Active Docker port publication may exist without docker-proxy. A stopped
    # container with the candidate name also blocks a future separate start.
    rows = run("docker", "ps", "--all", "--format", "{{.Names}}\t{{.Ports}}").decode().splitlines()
    occupied = any(n == HYPOTHETICAL_NAME or re.search(rf":{HYPOTHETICAL_PORT}->", ports)
                   for n, ports in (row.split("\t", 1) for row in rows))
    return not listeners.strip() and not occupied

class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        self.sock = self._context.wrap_socket(socket.create_connection(("127.0.0.1", 443), self.timeout),
                                              server_hostname=HOST)

def health(port, release):
    conn = (LocalTLS(HOST, timeout=4, context=ssl.create_default_context()) if port == 443
            else http.client.HTTPConnection("127.0.0.1", port, timeout=4))
    try:
        conn.request("GET", "/api/health?avtocenaReleaseProbe=" + str(time.monotonic_ns()),
                     headers={"Host": HOST, "Cache-Control": "no-cache", "Connection": "close"})
        res = conn.getresponse()
        data = res.read(8193)
        if res.status != 200 or len(data) > 8192:
            return False
        d = json.loads(data)
        return d.get("ok") is True and d.get("releaseSha") == release and d.get("calculationVersion") == CALC
    finally:
        conn.close()

def capacity():
    raw = read("/proc/meminfo", 64 * 1024)
    values = {k.decode(): int(n)*1024 for k,n in re.findall(rb"(?m)^(MemTotal|MemAvailable):\s+(\d+) kB$", raw)}
    total, available = values.get("MemTotal",0), values.get("MemAvailable",0)
    if not 0 < available <= total:
        raise ValueError("ram_scope")
    v = os.statvfs("/var/lib/docker")
    return total, available, v.f_bavail * v.f_frsize

def memory_signals():
    """Pressure and OOM are diagnostic host-wide counts; no command lines."""
    pressure = {}
    try:
        raw = read("/proc/pressure/memory", 4096)
        for prefix, n in re.findall(rb"(?m)^(some|full) avg10=([0-9]+(?:\.[0-9]+)?) ", raw):
            v = float(n)
            if 0 <= v <= 100:
                pressure[prefix.decode()] = v
    except (OSError,ValueError):
        pass
    oom = None
    try:
        raw = read("/proc/vmstat", 64 * 1024)
        m = re.search(rb"(?m)^oom_kill (\d+)$",raw)
        if m is not None: oom = int(m.group(1))
    except (OSError,ValueError):
        pass
    return {"psiSomeAvg10Pct":pressure.get("some"),"psiFullAvg10Pct":pressure.get("full"),"oomKillTotal":oom}

def build_types():
    """Host process labels only, aggregate exact obvious names, never argv/env."""
    maint = {b"buildkitd", b"buildctl", b"buildx", b"docker-buildx", b"buildkit-runc"}
    compilers = {b"gcc", b"g++", b"cc1", b"cc1plus", b"clang", b"clang++", b"rustc", b"ld.lld"}
    counts = {"buildkitFamily":0,"nativeCompilerFamily":0}
    missed = 0
    with os.scandir("/proc") as items:
        for ix, ent in enumerate(items):
            if ix >= 4096:
                return {"observed":False,"reason":"process_bound"}
            if not ent.name.isdecimal(): continue
            try:
                comm = read("/proc/"+ent.name+"/comm",128).strip()
            except (OSError,ValueError):
                missed+=1
                continue
            if comm in maint: counts["buildkitFamily"]+=1
            if comm in compilers: counts["nativeCompilerFamily"]+=1
    return {"observed":True,"unreadablePidEntries":missed,**counts}

def runtime_lock_quiet():
    # Only observe the already-established lane. No open-for-write, flock,
    # lock creation, or examination of command lines/process secrets.
    path = os.stat(RUNTIME_LOCK, follow_symlinks=False)
    if not stat.S_ISREG(path.st_mode) or path.st_uid != 0 or path.st_mode & 0o022:
        raise ValueError("runtime_lock_identity")
    identity = (os.major(path.st_dev), os.minor(path.st_dev), path.st_ino)
    for match in re.finditer(rb"(?<!\S)([0-9a-fA-F]+):([0-9a-fA-F]+):(\d+)(?!\S)", read("/proc/locks", 1024 * 1024)):
        if (int(match[1], 16), int(match[2], 16), int(match[3])) == identity:
            return False
    return True

def observe():
    quiet_before = runtime_lock_quiet()
    mem_total_before, mem_before, disk_before = capacity()
    pressure_before=memory_signals()
    baseline = config()
    ids = docker_identities()
    free = slot()
    all_health = [health(port, release) for _, release, _, port, _ in ROLES]
    tls = health(443, ROLES[0][1])
    mem_total, mem_after, disk_after = capacity()
    if mem_total != mem_total_before:
        raise ValueError("memory_topology_changed")
    memory, disk = min(mem_before,mem_after), min(disk_before,disk_after)
    stable = config() and baseline and docker_identities() == ids and slot() == free
    build_presence=build_types()
    pressure_after=memory_signals()
    quiet_after = runtime_lock_quiet()
    quiet = quiet_before and quiet_after
    oom_start, oom_end = pressure_before["oomKillTotal"], pressure_after["oomKillTotal"]
    oom_during_sample = None if oom_start is None or oom_end is None else oom_end>oom_start
    eligible = oom_during_sample is not True and quiet and stable and free and all(all_health) and tls and memory >= 8 * GIB and disk > 20 * GIB
    return {"status": "read_only_sample_eligible_for_review" if eligible else "read_only_hold",
            "hostWrites": 0, "providerCalls": 0, "storageCalls": 0, "startAuthorized": False,
            "candidateSource": CANDIDATE, "candidateTree": TREE,
            "candidateName": HYPOTHETICAL_NAME, "runtimeLockQuietAtBothReads": quiet,
            "sampledUnixEpoch": int(time.time()),
            "gatewayAndRoleIdentityStable": stable, "rolesLoopbackHealthy": all_health,
            "localSni22867Healthy": tls, "hypotheticalPort": HYPOTHETICAL_PORT,
            "hypotheticalSlotFree": free, "memoryAvailableBytes": memory,
            "memoryTotalBytes": mem_total, "memoryAvailableSamplesBytes": [mem_before,mem_after],
            "memoryPressure": [pressure_before,pressure_after], "oomObservedDuringSample": oom_during_sample,
            "possibleBuildProcessTypes": build_presence,
            "dockerFilesystemFreeBytes": disk}

if __name__ == "__main__":
    try:
        if len(sys.argv) != 1:
            raise ValueError("scope")
        observed = observe()
    except Exception:
        observed = {"status": "read_only_probe_unverified", "hostWrites": 0,
                    "providerCalls": 0, "storageCalls": 0, "startAuthorized": False}
    print(json.dumps(observed, sort_keys=True))
    raise SystemExit(0 if observed["status"] == "read_only_sample_eligible_for_review" else 2)
