import contextlib
import importlib.util
import io
import json
import pathlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('incident',pathlib.Path(__file__).resolve().parents[1]/'scripts/regcloud-owner-incident.py')
incident=importlib.util.module_from_spec(spec)
spec.loader.exec_module(incident)

def timing(path,ms,found=True,**extra):
    return 'catalog_storage_read '+json.dumps({'path':path,'ms':ms,'found':found,**extra})

class IncidentTests(unittest.TestCase):
    def test_aggregates_slow_reads_without_paths_or_extra_fields(self):
        secret='private@example.com?token=NEVER_OUTPUT'
        logs='\n'.join([
            timing('catalog/generations/'+secret+'/indexes/projection/china.json',300,trace=secret),
            timing('catalog/generations/other/indexes/projection/europe.json',1300,False,error=secret),
            timing('catalog/manifest.json',600),
            timing('catalog/partner-cache/ajes/queries/'+secret,280),
            timing('catalog/'+secret,450),
        ])
        report=incident.summarize_timings(logs)
        rows={row['category']:row for row in report['storage']['categories']}
        self.assertEqual(report['storage']['acceptedRows'],5)
        self.assertEqual(rows['projectionIndexes'],{'category':'projectionIndexes','count':2,'totalMs':1600,'maxMs':1300,'over1000Ms':1,'negativeOutcomeCount':1,'meanMs':800})
        serialized=json.dumps(report)
        for value in [secret,'china.json','europe.json','catalog/','trace','NEVER_OUTPUT']:
            self.assertNotIn(value,serialized)
        self.assertIn('not page latency',report['coverage'])

    def test_drops_malformed_values_and_never_copies_unknown_labels(self):
        rows=[timing('catalog/manifest.json',bad) for bad in [True,-1,float('nan'),float('inf'),'300',2**54]]
        rows += [timing('https://private.invalid/token',300),timing([],300),timing('catalog/manifest.json',300,'yes'),
                 'catalog_storage_read []','catalog_storage_read {bad','catalog_storage_read '+json.dumps({'ms':300,'found':True}),
                 'home_phase '+json.dumps({'phase':'private-phase','ms':300,'ok':True}),
                 'home_phase '+json.dumps({'phase':[],'ms':300,'ok':True}),
                 'home_phase '+json.dumps({'phase':'snapshot','ms':300,'ok':'yes'})]
        report=incident.summarize_timings('\n'.join(rows))
        self.assertEqual(report['storage']['acceptedRows'],0)
        self.assertEqual(report['storage']['rejectedRows'],12)
        self.assertEqual(report['home']['rejectedRows'],3)
        self.assertEqual(report['storage']['categories'],[])
        self.assertNotIn('private',json.dumps(report))

    def test_home_phases_are_allowlisted_and_trace_is_not_published(self):
        logs='\n'.join(['home_phase '+json.dumps({'phase':'snapshot','ms':120.5,'ok':True,'trace':'PRIVATE'}),
            '2026-11-11T14:00:00.123456789Z home_phase '+json.dumps({'phase':'snapshot','ms':15.5,'ok':False,'generation':'PRIVATE'})])
        report=incident.summarize_timings(logs)
        self.assertEqual(report['home']['acceptedRows'],2)
        self.assertEqual(report['home']['categories'],[{'category':'snapshot','count':2,'totalMs':136.0,'maxMs':120.5,'over1000Ms':0,'negativeOutcomeCount':1,'meanMs':68.0}])
        self.assertNotIn('PRIVATE',json.dumps(report))

    def test_closed_window_uses_only_bounded_logs_and_health_identity(self):
        release='a'*40;argv=['incident',release,'2026-11-11T00:00:00Z','2026-11-11T00:05:00Z']
        captured=io.StringIO()
        logs=SimpleNamespace(stdout=timing('catalog/manifest.json',400),stderr='request_timeout')
        with patch.object(incident.sys,'argv',argv),patch.object(incident,'health',return_value=release) as health,patch.object(incident.pathlib.Path,'read_bytes',return_value=b'unchanged'),patch.object(incident.subprocess,'run',return_value=logs) as run,contextlib.redirect_stdout(captured):
            incident.main()
        self.assertEqual(health.call_count,2)
        run.assert_called_once_with(['docker','logs','--since',argv[2],'--until',argv[3],'--tail','5000','avtocena-production'],capture_output=True,text=True,timeout=25,check=True)
        output=[json.loads(line) for line in captured.getvalue().splitlines()]
        self.assertEqual(output[0]['timings']['storage']['acceptedRows'],1)
        self.assertEqual(output[1],{'productionBefore':release,'productionAfter':release,'nginxUnchanged':True})

    def test_refuses_long_or_open_windows_before_reading_health(self):
        for start,end in [('2026-11-11T00:00:00Z','2026-11-11T00:10:01Z'),('2999-11-11T00:00:00Z','2999-11-11T00:01:00Z')]:
            with self.subTest(start=start),patch.object(incident.sys,'argv',['incident','a'*40,start,end]),patch.object(incident,'health') as health,patch.object(incident.subprocess,'run') as run:
                with self.assertRaisesRegex(AssertionError,'window_not_closed'):incident.main()
                health.assert_not_called();run.assert_not_called()

    def test_refuses_wrong_release_and_oversized_log(self):
        argv=['incident','a'*40,'2026-11-11T00:00:00Z','2026-11-11T00:01:00Z']
        with patch.object(incident.sys,'argv',argv),patch.object(incident,'health',return_value='b'*40),patch.object(incident.subprocess,'run') as run:
            with self.assertRaisesRegex(AssertionError,'production_changed'):incident.main()
            run.assert_not_called()
        with patch.object(incident.sys,'argv',argv),patch.object(incident,'health',return_value='a'*40),patch.object(incident.pathlib.Path,'read_bytes',return_value=b'unchanged'),patch.object(incident.subprocess,'run',return_value=SimpleNamespace(stdout='x'*(32*1024*1024),stderr='')),patch('builtins.print') as emit:
            with self.assertRaisesRegex(AssertionError,'log_window_too_large'):incident.main()
            emit.assert_not_called()

if __name__=='__main__':unittest.main()
