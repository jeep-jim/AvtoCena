#!/usr/bin/env bash
# Only an exact, already-loaded image. No public configuration or data writes.
set -euo pipefail
umask 077
exec 9>/run/lock/avtocena-runtime-change.lock
flock -n 9
readonly old=avtocena-production release=85296f6b8797aaa93227b69da7e9e9e928e8f9b5
readonly incumbent=83ff17075e9188dcf227c8752dc064248d5f42e0
readonly legacy=4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90
readonly build=985e189a47a6a956936515d4c93d7f57ade5a49a9ae7b1fa0ff7c2ee8a3da831
readonly image=sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984
readonly candidate=avtocena-china-candidate-85296f6b8797
readonly base="/opt/avtocena/releases/$release" probe="/opt/avtocena/releases/$release/china-private"
readonly envkey="/opt/avtocena/releases/$release/china-dark-boot.env"
test -e /opt/avtocena/PRODUCTION_ACTIVE
test "$(docker image inspect --format '{{.Id}}' "avtocena-regcloud:$release")" = "$image"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$release"
! docker container inspect "$candidate" >/dev/null 2>&1
awk '/^MemAvailable:/ {if ($2 < 2097152) exit 1; seen=1} END {if (!seen) exit 1}' /proc/meminfo
test "$(df --output=avail -k / | tail -1)" -gt 4194304
test ! -e "$base" || { test -d "$base" && test ! -L "$base" && test "$(stat -c '%u %a' "$base")" = '0 700'; }
install -d -m 0700 "$base" "$probe"
test "$(realpath "$probe")" = "$probe" && test "$(stat -c '%u %a' "$probe")" = '0 700'
test ! -e "$envkey"
candidate_id=
ok=0
cleanup(){
  rm -f -- "$envkey"
  if [ "$ok" = 0 ] && [[ "$candidate_id" =~ ^[a-f0-9]{64}$ ]]; then
    docker stop --time 15 "$candidate_id" >/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM HUP INT
read -r old_port old_id old_image < <(
 docker inspect --type container "$old" | python3 -c '
import json,os,re,sys
old,calc,release,build,filename=sys.argv[1:]; d=json.load(sys.stdin)[0]; cfg=d["Config"]; host=d["HostConfig"]; m=d["Mounts"]
assert d["State"]["Running"] and not host["Privileged"] and cfg["Labels"]["avtocena.role"]=="production"
assert len(m)==1 and m[0]["Source"]=="/opt/avtocena/metrics" and m[0]["Destination"]=="/run/avtocena-metrics" and not m[0]["RW"]
assert set(host["PortBindings"])=={"3000/tcp"}; [b]=host["PortBindings"]["3000/tcp"]
assert b["HostIp"]=="127.0.0.1" and b["HostPort"] in ["3000","3001"]
env=dict(s.split("=",1) for s in cfg["Env"])
assert all(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*",k) and not re.search(r"[\x00\r\n]",v) for k,v in env.items())
assert env["AVTOCENA_RELEASE_SHA"]==old and env["AVTOCENA_CALCULATION_VERSION"]==calc and env.get("AVTOCENA_CHINA_REGCLOUD_RUNTIME")!="1"
assert env.get("JSON_STORAGE_DRIVER")=="object" and env.get("YC_OBJECT_STORAGE_ENDPOINT","").rstrip("/")=="https://s3.regru.cloud"
assert env.get("YC_OBJECT_STORAGE_BUCKET")=="avtocena-staging-8120751" and env.get("YC_OBJECT_STORAGE_PREFIX","").strip("/")=="migration-staging/full-20261011"
assert env.get("YC_OBJECT_STORAGE_REGION")=="us-east-1" and env.get("YC_OBJECT_STORAGE_ACCESS_KEY_ID") and env.get("YC_OBJECT_STORAGE_SECRET_ACCESS_KEY")
env.update(AVTOCENA_RELEASE_SHA=release,AVTOCENA_BUILD_CALCULATION_VERSION=build,AVTOCENA_CHINA_REGCLOUD_RUNTIME="1")
with open(filename,"x") as f: f.write("".join(k+"="+v+"\n" for k,v in env.items()))
assert re.fullmatch(r"[0-9a-f]{64}",d["Id"]) and re.fullmatch(r"sha256:[0-9a-f]{64}",d["Image"])
print(b["HostPort"],d["Id"],d["Image"])
 ' "$incumbent" "$legacy" "$release" "$build" "$envkey"
)
[[ "$old_id" =~ ^[a-f0-9]{64}$ && "$old_port" =~ ^300[01]$ ]]
port=$((6001-old_port))
public_health(){
 curl -fsS --noproxy '*' --resolve avtocena.com:443:127.0.0.1 --max-time 10 --max-filesize 8192 https://avtocena.com/api/health |
  python3 -c 'import json,sys;v=json.load(sys.stdin);assert v["ok"] is True and v["releaseSha"]==sys.argv[1] and v["calculationVersion"]==sys.argv[2]' "$incumbent" "$legacy"
}
ingress(){
  /usr/sbin/nginx -T 2>/dev/null |
  python3 -c 'import hashlib,re,sys;s=sys.stdin.buffer.read();a,b=(x.encode() for x in sys.argv[1:]);assert re.search(rb"proxy_pass\s+http://127\.0\.0\.1:"+a+rb"(?:/|;)",s);assert not re.search(rb"(?:127\.0\.0\.1|localhost|\[::1\]):"+b+rb"(?!\d)",s);print(hashlib.sha256(s).hexdigest())' "$old_port" "$port"
}
nginx_before=$(ingress)
public_health
candidate_id=$(docker run -d --name "$candidate" --label avtocena.role=china-release-standby --restart no  --memory 8g --cpus 2 --pids-limit 512 --log-opt max-size=10m --log-opt max-file=3  --env-file "$envkey" --mount type=bind,src=/opt/avtocena/metrics,dst=/run/avtocena-metrics,readonly  --mount "type=bind,src=$probe,dst=/run/avtocena-china-switch,readonly"  -p "127.0.0.1:$port:3000" "$image")
rm -f -- "$envkey"
[[ "$candidate_id" =~ ^[a-f0-9]{64}$ ]]
for i in $(seq 1 30); do
 if curl -fsS --noproxy '*' --max-time 3 --max-filesize 8192 "http://127.0.0.1:$port/api/health" 2>/dev/null |
  python3 -c 'import json,sys;v=json.load(sys.stdin);assert v["ok"] is True and v["releaseSha"]==sys.argv[1] and v["calculationVersion"]==sys.argv[2]' "$release" "$legacy" 2>/dev/null; then ok=1; break; fi
 sleep 1
done
test "$ok" = 1
ok=0
test "$(docker inspect --format '{{.Id}}' "$old")" = "$old_id"
test "$(ingress)" = "$nginx_before"
public_health
ok=1
printf '{"status":"china_loopback_candidate_only","incumbentRelease":"%s","incumbentImage":"%s","incumbentPort":%s,"candidateRelease":"%s","candidateImage":"%s","candidatePort":%s,"publication":false,"nginxChanged":false}\n' "$incumbent" "$old_image" "$old_port" "$release" "$image" "$port"
