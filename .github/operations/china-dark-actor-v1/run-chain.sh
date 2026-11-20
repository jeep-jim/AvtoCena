#!/usr/bin/env bash
# Same authenticated Actions job; no broad runtime deploy / provider cursor.
set -euo pipefail
umask 077
[[ $# == 8 ]]
readonly host=$1 pin=$2 actorpin=$3 hostpin=$4 flip_pin=$5 compose_pin=$6 ingress=$7 owner_ingress=$8
[[ "$host" =~ ^/opt/avtocena/releases/85296f6b8797aaa93227b69da7e9e9e928e8f9b5/china-switch-runs/[1-9][0-9]{0,19}$ ]]
for n in "$pin" "$actorpin" "$hostpin" "$flip_pin" "$compose_pin"; do [[ "$n" =~ ^[a-f0-9]{64}$ ]]; done
[[ "$ingress" == false && "$owner_ingress" == none || "$ingress" == true && "$owner_ingress" =~ ^[a-f0-9]{64}$ ]]
for spec in "$actorpin  $host/china-dark-control-switch.mjs" "$hostpin  $host/host-control-dispatch.py" "$flip_pin  $host/flip_ingress.py" "$compose_pin  $host/compose-ingress.py"; do
 printf '%s\n' "$spec" | sha256sum --strict --check --status
done
cmd=(/usr/bin/python3 "$host/host-control-dispatch.py" "$host" "$pin" "$actorpin")
"${cmd[@]}" activate > "$host/dark.json"
cat "$host/dark.json"
if [[ "$ingress" == false ]]; then exit 0; fi
dark_pin="$(python3 - "$host/dark.json" <<'PY'
import json,sys,re
d=json.load(open(sys.argv[1]));assert d['status']=='china_dark_control_verified' and re.fullmatch('[a-f0-9]{64}',d['controlSha256'])
print(d['controlSha256'])
PY
)"
restore_dark(){
 # Ingress restores its own Nginx before returning error. This second CAS is
 # allowed only if the old live gateway and exact unchanged new control both
 # independently verify when it acquires the same host lease.
 if "${cmd[@]}" rollback-control "$dark_pin"; then return 0; fi
 echo '{"status":"exact_control_rollback_unverified_do_not_repeat"}' >&2
 return 1
}
if ! "${cmd[@]}" read-control > "$host/control.json"; then restore_dark; exit 1; fi
if ! ingress_pin="$(python3 "$host/compose-ingress.py" "$host" "$actorpin" "$pin" "$owner_ingress")"; then restore_dark; exit 1; fi
[[ "$ingress_pin" =~ ^[a-f0-9]{64}$ ]]
if ! "${cmd[@]}" ingress "$ingress_pin:$flip_pin"; then restore_dark; exit 1; fi
