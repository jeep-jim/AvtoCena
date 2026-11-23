"""Restore host CPU availability on the observed serving container, preserving rollback identity."""
import contextlib
import fcntl
import json
import os
import pathlib
import stat
import subprocess

import incumbent_inventory as inv

# Observed in the independent read-only run 45167815717.
STARTED = '2026-11-23T06:36:17.946542183Z'
RESTARTS = 3
HOST_CORES = 8
ORIGINAL = 2
OBSERVED_PID = 133418
ROLLBACKS = {'chinaRollback': 'e30facd9dc08d28b6e7d8b4423842b027e9b975befcf5bf52de09f29da60d6a7',
             'legacyRollback': '21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78'}


class LockedReader(inv.LocalIO):
    # run_inventory executes under the exclusive lock held by main.
    lock = staticmethod(contextlib.nullcontext)


def observed(io, cores):
    expected = {**inv.HISTORICAL_SERVING_RESOURCES, 'RestartCount': RESTARTS, 'NanoCpus': cores*10**9}
    report = inv.run_inventory(io, expected_start=STARTED, expected_resources=expected)
    assert report['status'] == 'verified_inventory_requires_review'
    assert report['containers']['serving']['pid'] == OBSERVED_PID and report['rollbackPins'] == ROLLBACKS
    return report


def set_cpu(cores):
    assert cores in (ORIGINAL, HOST_CORES)
    subprocess.run(['/usr/bin/docker', 'container', 'update', '--cpus', str(cores), inv.SERVING_ID],
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   timeout=20, check=True)


def cgroup_quota():
    entries = pathlib.Path('/proc', str(OBSERVED_PID), 'cgroup').read_text().splitlines()
    groups = [line[3:] for line in entries if line.startswith('0::/')]
    assert len(groups) == 1
    root = pathlib.Path('/sys/fs/cgroup')
    path = (root / groups[0].lstrip('/')).resolve()
    assert path.is_relative_to(root) and inv.SERVING_ID in path.name
    quota, period = (path/'cpu.max').read_text().split()
    assert int(period) > 0 and int(quota) > 0 and int(quota) % int(period) == 0
    return int(quota) // int(period)


def apply(io, update=set_cpu, quota=cgroup_quota, read=observed):
    before = io.inspect(inv.ROLES[0][1])['HostConfig'].copy()
    cores = before['NanoCpus'] // 10**9
    assert cores in (ORIGINAL, HOST_CORES) and quota() == cores
    current = read(io, cores)
    if cores == HOST_CORES:
        return current, False
    desired = {**before, 'NanoCpus': HOST_CORES*10**9}
    try:
        update(HOST_CORES)
        assert io.inspect(inv.ROLES[0][1])['HostConfig'] == desired and quota() == HOST_CORES
        after = read(io, HOST_CORES)
        for role in ROLLBACKS:
            assert after['containers'][role] == current['containers'][role]
        current_serving = dict(current['containers']['serving'])
        after_serving = dict(after['containers']['serving'])
        for row in (current_serving, after_serving):
            row.pop('hostConfigSha256')
            row.pop('resources')
        assert current_serving == after_serving
        return after, True
    except BaseException:
        actual = io.inspect(inv.ROLES[0][1])
        if (actual['Id'] == inv.SERVING_ID and actual['State']['StartedAt'] == STARTED
                and actual['HostConfig']['NanoCpus'] == desired['NanoCpus']):
            update(ORIGINAL)
            assert io.inspect(inv.ROLES[0][1])['HostConfig']['NanoCpus'] == before['NanoCpus'] and quota() == ORIGINAL
        raise


def main():
    assert os.cpu_count() == HOST_CORES
    fd = os.open(inv.LOCK_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        after, changed = apply(LockedReader())
        print(json.dumps({'cpuUpdated': changed, 'effectiveCores': HOST_CORES, 'inventory': after}, sort_keys=True))
    finally:
        os.close(fd)


if __name__ == '__main__':
    main()
