"""Assemble the existing full read-only inventory for an observed serving process."""
import json
from pathlib import Path
import re
import sys

sample = json.loads(Path(sys.argv[1]).read_text())
assert sample['readOnly'] is True and sample['activationAuthorized'] is False and sample['stable'] is True
process = sample['processBefore']
assert process == sample['processAfter'] and process['oomKilled'] is False
assert isinstance(process['pid'], int) and process['pid'] > 0 and isinstance(process['restartCount'], int) and process['restartCount'] >= 0
assert re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z', process['startedAt'])
assert len(sample['samples']) == 2 and all(row['health']['verified'] for row in sample['samples'])
source = Path('.github/operations/home-ui-only-20261123/inventory.py').read_text()
# The same checked-in reader verifies the host, the unchanged revision and
# health/ingress before and after a shared lock. The prior sample fixes the PID.
print("import json, sys")
print("reader = {'__name__':'readonly_inventory'}")
print("exec(compile(" + repr(source) + ",'<reviewed-inventory>','exec'), reader)")
print("expected_restart = " + str(process['restartCount']))
print("resources = dict(reader['HISTORICAL_SERVING_RESOURCES'], RestartCount=expected_restart)")
print('''
class StableMountInventory(reader['LocalIO']):
    def inspect(self, name):
        value = super().inspect(name)
        # Docker reports mounts as a collection keyed by destination. Keep
        # every record and attribute when fingerprinting the unordered list.
        value['Mounts'] = sorted(value['Mounts'], key=lambda row: json.dumps(row, sort_keys=True, separators=(',', ':')))
        return value
snapshots = []
original_snapshot = reader['snapshot']
def observed_snapshot(*args):
    result = original_snapshot(*args)
    snapshots.append(result)
    return result
reader['snapshot'] = observed_snapshot
''')
print("try: receipt = reader['run_inventory'](StableMountInventory(), expected_start=" + repr(process['startedAt']) + ", expected_resources=resources)")
print('''except Exception:
    if len(snapshots) == 2:
        print(json.dumps({role:[key for key in first if first[key] != snapshots[1][role].get(key)]
            for role,first in snapshots[0].items()}), file=sys.stderr)
    raise''')
print("assert receipt['status']=='verified_inventory_requires_review' and receipt['mutations']==0 and receipt['supplierRequests']==0")
print("assert receipt['containers']['serving']['pid']==" + str(process['pid']))
print("print(json.dumps(receipt,sort_keys=True))")
