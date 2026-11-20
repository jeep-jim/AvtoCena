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
HYPOTHETICAL_NAME = "avtocena-china-ford-dark-6e8e1df79f20"
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
    m = re.search(rb"(?m)^MemAvailable:\s+(\d+) kB$", read("/proc/meminfo", 64 * 1024))
    if m is None:
        raise ValueError("memavailable")
    v = os.statvfs("/var/lib/docker")
    return int(m.group(1)) * 1024, v.f_bavail * v.f_frsize

def observe():
    baseline = config()
    ids = docker_identities()
    free = slot()
    all_health = [health(port, release) for _, release, _, port, _ in ROLES]
    tls = health(443, ROLES[0][1])
    memory, disk = capacity()
    stable = config() and baseline and docker_identities() == ids and slot() == free
    eligible = stable and free and all(all_health) and tls and memory >= 8 * GIB and disk > 20 * GIB
    return {"status": "read_only_sample_eligible_for_review" if eligible else "read_only_hold",
            "hostWrites": 0, "providerCalls": 0, "storageCalls": 0, "startAuthorized": False,
            "gatewayAndRoleIdentityStable": stable, "rolesLoopbackHealthy": all_health,
            "localSni22867Healthy": tls, "hypotheticalPort": HYPOTHETICAL_PORT,
            "hypotheticalSlotFree": free, "memoryAvailableBytes": memory,
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
