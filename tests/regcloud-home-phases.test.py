import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('home', pathlib.Path(__file__).resolve().parents[1]/'scripts/regcloud-home-phases.py')
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)

class SafetyTests(unittest.TestCase):
    def test_exact_stopped_baseline(self):
        row={'State':{'Running':False},'Config':{'Image':'avtocena-regcloud:'+'a'*40},'HostConfig':{'Privileged':False}}
        home.baseline(row,'a'*40)
        for section,key,value in [('State','Running',True),('Config','Image','other'),('HostConfig','Privileged',True)]:
            import copy
            changed=copy.deepcopy(row);changed[section][key]=value
            with self.assertRaises(ValueError):home.baseline(changed,'a'*40)

    def test_log_allowlist(self):
        import json
        row={'trace':'12345678-1234-1234-1234-123456789012','phase':'snapshot','ms':8.5,'ok':True,
             'policyDate':'2026-10-28','completedPolicyDate':'2026-10-28','generation':'gen_123_abc','error':'PRIVATE','url':'PRIVATE'}
        value=home.phase_row('home_phase '+json.dumps(row))
        self.assertNotIn('PRIVATE',str(value));self.assertEqual(value['generation'],'gen_123_abc')
        for key,bad in [('phase','secret'),('trace','secret'),('ms',float('nan')),('ok','yes'),('policyDate','secret')]:
            self.assertIsNone(home.phase_row('home_phase '+json.dumps({**row,key:bad})))
        self.assertIsNone(home.phase_row('raw application secret'))
        for phase in ['snapshotOverview','snapshotEditorial:uae']:
            self.assertEqual(home.phase_row('home_phase '+json.dumps({**row,'phase':phase}))['phase'],phase)
        self.assertIsNone(home.phase_row('home_phase '+json.dumps({**row,'phase':'snapshotEditorial:private'})))

    def test_environment_preserves_guards(self):
        result=home.runtime_env(['SECRET=preserved','CATALOG_RATE_TIMEOUT_MS=2500','AVTOCENA_RELEASE_SHA=old'], 'a'*40,'b'*64)
        self.assertIn('SECRET=preserved\n',result);self.assertIn('CATALOG_RATE_TIMEOUT_MS=2500\n',result)
        self.assertNotIn('=old',result);self.assertIn('CATALOG_HOME_PHASE_TIMING=1',result)
        with self.assertRaises(ValueError):home.runtime_env(['x=bad\nvalue'],'a'*40,'b'*64)

    def test_refuses_changed_production_before_create(self):
        row={'State':{'Running':False},'Config':{'Image':'avtocena-regcloud:'+'a'*40},'HostConfig':{'Privileged':False}}
        with patch.object(home,'inspect',return_value=row),patch.object(home,'production',return_value='c'*40),patch.object(home,'command') as command:
            with self.assertRaises(ValueError):home.probe('a'*40,'b'*40,'d'*64,pathlib.Path('/tmp'),'e'*40)
            command.assert_not_called()

    def test_cleanup_after_start_failure(self):
        import tempfile
        from types import SimpleNamespace
        row={'State':{'Running':False},'Config':{'Image':'avtocena-regcloud:'+'a'*40,'Env':['SECRET=private']},'HostConfig':{'Privileged':False}}
        calls=[]
        with tempfile.TemporaryDirectory() as tmp:
            directory=pathlib.Path(tmp)
            config=directory/'nginx';config.write_text('unchanged')
            (directory/'calculation-v1.json').write_text('same index')
            def command(*args):
                calls.append(args)
                if args[1:3]==('image','inspect'):return 'b'*40
                if args[1]=='cp':pathlib.Path(args[-1]).write_text('same index')
                if args[1]=='start':raise RuntimeError('start failure')
                return ''
            with patch.object(home,'CONFIG',config),patch.object(home,'inspect',return_value=row),patch.object(home,'production',return_value='e'*40),patch.object(home,'command',side_effect=command),patch.object(home,'emit'),patch.object(home.subprocess,'run',return_value=SimpleNamespace(stdout='',stderr='')):
                with self.assertRaisesRegex(RuntimeError,'start failure'):
                    home.probe('a'*40,'b'*40,'d'*64,directory,'e'*40)
            self.assertTrue(any(call[1]=='stop' for call in calls))
            self.assertTrue(any(call[1]=='rm' for call in calls))
            self.assertFalse((directory/'runtime.env').exists())
            self.assertEqual(config.read_text(),'unchanged')

if __name__=='__main__':unittest.main()
