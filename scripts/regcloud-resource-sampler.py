#!/usr/bin/env python3
"""Read-only host sampler. Publish only resource numbers, never Docker env/secrets."""
import json, os, pathlib, shutil, subprocess, time
OUT=pathlib.Path('/opt/avtocena/metrics')
OUT.mkdir(mode=0o755,parents=True,exist_ok=True)
previous=None
while True:
    try:
        now=time.time()
        cpu=list(map(int,pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
        total=sum(cpu);idle=cpu[3]+cpu[4]
        percent=None if previous is None else max(0,min(100,100*(1-(idle-previous[1])/max(1,total-previous[0]))))
        previous=(total,idle)
        mem={line.split(':')[0]:int(line.split()[1])*1024 for line in pathlib.Path('/proc/meminfo').read_text().splitlines()}
        disk=shutil.disk_usage('/')
        payload={'version':1,'sampledAt':int(now*1000),'cpu':{'usedPercent':percent,'cores':os.cpu_count()},'memory':{'total':mem['MemTotal'],'available':mem['MemAvailable'],'used':mem['MemTotal']-mem['MemAvailable']},'disk':{'total':disk.total,'used':disk.used,'available':disk.free}}
        tmp=OUT/'resources.tmp'
        tmp.write_text(json.dumps(payload));tmp.chmod(0o644);tmp.replace(OUT/'resources.json')
    except Exception:
        # Leave the last sample with its original time; API rejects stale data.
        pass
    time.sleep(5)
