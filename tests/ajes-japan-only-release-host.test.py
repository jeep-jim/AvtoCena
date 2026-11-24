import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('aj_release_host',ROOT/'.github/operations/ajes-japan-only-20261124/release-host.py')
host=importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
SOURCE='b'*40


class ReleaseHostTests(unittest.TestCase):
    def test_each_fixed_http_probe_reports_timeout_without_changing_deadline_or_retrying(self):
        self.assertEqual(set(host.HTTP_PROBES.values()),{'retired-report','china-ajes','china-existing',
            'korea-ajes','korea-existing','japan-boundary','crm-ajes','crm-china','crm-korea','health'})
        for path,probe in host.HTTP_PROBES.items():
            with self.subTest(probe=probe):
                connection=mock.Mock()
                connection.request.side_effect=TimeoutError('PRIVATE_FIXTURE 192.0.2.1 /root/secret?password=PRIVATE_FIXTURE')
                with mock.patch.object(host.native.http.client,'HTTPConnection',return_value=connection) as factory:
                    with self.assertRaises(host.native.HostError) as caught:host.public_json('candidate',path)
                self.assertEqual(str(caught.exception),'home_host_aj_http_'+probe+'_timeout_no_status')
                factory.assert_called_once_with('127.0.0.1',3003,timeout=90)
                connection.request.assert_called_once_with('GET',path,headers={
                    'Host':'avtocena.com','Accept':'application/json','Connection':'close'})
                connection.getresponse.assert_not_called();connection.close.assert_called_once_with()

    def test_http_probe_failure_keeps_received_status_and_redacts_body_and_exception(self):
        cases=[(TimeoutError('PRIVATE_FIXTURE'),'timeout',503),
               (host.native.http.client.IncompleteRead(b'PRIVATE_FIXTURE'),'transport',502),
               (b'PRIVATE_FIXTURE /root/secret?password=PRIVATE_FIXTURE','json',200),
               (b'\xffPRIVATE_FIXTURE','json',403)]
        for payload,kind,status in cases:
            with self.subTest(kind=kind,status=status):
                connection=mock.Mock();response=connection.getresponse.return_value;response.status=status
                if isinstance(payload,Exception):response.read.side_effect=payload
                else:response.read.return_value=payload
                with mock.patch.object(host.native.http.client,'HTTPConnection',return_value=connection):
                    with self.assertRaises(host.native.HostError) as caught:host.public_json('retained','/api/health')
                self.assertEqual(str(caught.exception),'home_host_aj_http_health_'+kind+'_'+str(status))
                self.assertNotIn('PRIVATE_FIXTURE',str(caught.exception))
                response.read.assert_called_once_with(20*1024*1024+1)
                connection.close.assert_called_once_with()

    def test_http_probe_scope_and_successful_http_contract_are_unchanged(self):
        with mock.patch.object(host.native.http.client,'HTTPConnection') as factory:
            with self.assertRaisesRegex(host.native.HostError,'^home_host_aj_http_probe_scope$'):
                host.public_json('candidate','/api/health?password=PRIVATE_FIXTURE')
            factory.assert_not_called()
        connection=mock.Mock();response=connection.getresponse.return_value
        response.status=410;response.read.return_value=b'{"error":"source_retired"}'
        context=object()
        with mock.patch.object(host.native.ssl,'create_default_context',return_value=context),\
             mock.patch.object(host.native.http.client,'HTTPSConnection',return_value=connection) as factory:
            self.assertEqual(host.public_json('public','/api/catalog/korea-report?id=ajes-korea-retired'),
                             (410,{'error':'source_retired'}))
        factory.assert_called_once_with('avtocena.com',timeout=90,context=context)
        connection.close.assert_called_once_with()

    def test_candidate_preserves_japan_access_and_runtime_mounts(self):
        original={'AVTOCENA_CALCULATION_VERSION':host.CALCULATION,'AVTOCENA_CHINA_REGCLOUD_RUNTIME':'1',
                  'AJES_API_PASSWORD':'fixture-only','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY':'fixture-only',
                  'NODE_OPTIONS':'--trace-warnings --max-old-space-size=6144','UNRELATED_SETTING':'unchanged'}
        serving={'Config':{'Env':[key+'='+value for key,value in original.items()]}}
        with mock.patch.object(host,'SOURCE',SOURCE),mock.patch.object(host,'BUILD','c'*64):
            value=host.candidate_spec({'imageId':'sha256:'+'d'*64,'nonce':'e'*32},serving)
        env=dict(row.split('=',1) for row in value['Env'])
        self.assertEqual(env['AJES_API_PASSWORD'],original['AJES_API_PASSWORD'])
        self.assertEqual(env['YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'],original['YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'])
        self.assertEqual(env['AVTOCENA_CALCULATION_VERSION'],original['AVTOCENA_CALCULATION_VERSION'])
        self.assertEqual(env['UNRELATED_SETTING'],'unchanged')
        self.assertEqual(env['AVTOCENA_HOME_INHERITED_NODE_OPTIONS'],original['NODE_OPTIONS'])
        self.assertNotIn('NODE_OPTIONS',env)
        self.assertTrue(all(row.endswith(':ro') for row in value['HostConfig']['Binds']))
        self.assertEqual(value['HostConfig']['PortBindings'],{'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'3003'}]})

    def test_local_docker_rejects_foreign_container_mutations(self):
        with mock.patch.object(host,'SOURCE',SOURCE):
            local=host.Local({'nonce':'a'*32,'imageId':'sha256:'+'b'*64},transport=lambda *args:self.fail('unexpected Docker request'))
        for method,route in [('POST','/containers/avtocena-production/stop?t=10'),('DELETE','/images/anything'),('POST','/containers/avtocena-china-grid-dark-22867cbcfaee/update')]:
            with self.assertRaises(host.native.HostError):local.docker(method,route)

    def test_docker_http_failure_identifies_operation_without_body_or_identity(self):
        identity='c'*64
        plan={'nonce':'a'*32,'imageId':'sha256:'+'b'*64}
        private=b'{"message":"PRIVATE_FIXTURE /root/private/file AJES_API_PASSWORD=PRIVATE_FIXTURE"}'
        cases=[('GET','/images/'+plan['imageId']+'/json',404,'image_inspect'),
               ('GET','/containers/json?all=1',503,'container_list'),
               ('GET','/info',500,'daemon_info'),
               ('GET','/containers/'+identity+'/json',404,'container_inspect'),
               ('GET','/containers/'+identity+'/logs?stdout=1&stderr=1&tail=100',400,'container_logs'),
               ('POST','/containers/'+identity+'/start',500,'container_start'),
               ('POST','/containers/'+identity+'/stop?t=10',304,'container_stop'),
               ('POST','/containers/'+identity+'/wait?condition=not-running',409,'container_wait'),
               ('DELETE','/containers/'+identity+'?v=false&force=false',409,'container_delete')]
        for method,route,status,category in cases:
            with self.subTest(method=method,category=category,status=status):
                local=host.Local(plan,transport=lambda *args:(status,private))
                local.owned.add(identity)
                with self.assertRaises(host.native.HostError) as caught:local.docker(method,route)
                self.assertEqual(str(caught.exception),'home_host_aj_docker_http_'+method.lower()+'_'+category+'_'+str(status))
                for forbidden in ('PRIVATE_FIXTURE','/root/',identity,plan['imageId'],'AJES_API_PASSWORD'):
                    self.assertNotIn(forbidden,str(caught.exception))
        local=host.Local(plan,transport=lambda *args:(400,private))
        with self.assertRaisesRegex(host.native.HostError,'^home_host_aj_docker_http_post_container_create_400$'):
            local.create({'Image':plan['imageId'],'Env':['AJES_API_PASSWORD=PRIVATE_FIXTURE']})

    def test_docker_diagnostics_preserve_exact_accepted_statuses(self):
        plan={'nonce':'a'*32,'imageId':'sha256:'+'b'*64}
        for status in (200,201,204):
            raw=b'' if status==204 else b'{"verified":true}'
            local=host.Local(plan,transport=lambda *args:(status,raw))
            self.assertEqual(local.docker('GET','/info'),None if status==204 else {'verified':True})
        local=host.Local(plan,transport=lambda *args:('PRIVATE_FIXTURE',b'PRIVATE_FIXTURE'))
        with self.assertRaisesRegex(host.native.HostError,'^home_host_aj_docker_http_get_daemon_info_invalid$'):
            local.docker('GET','/info')

    def test_stopped_container_configured_port_is_not_mistaken_for_free(self):
        identity='c'*64
        def transport(method,route,body):
            self.assertEqual(method,'GET');self.assertIsNone(body)
            if route=='/containers/json?all=1':return 200,json.dumps([{'Id':identity,'Ports':[]}]).encode()
            self.assertEqual(route,'/containers/'+identity+'/json')
            return 200,json.dumps({'Id':identity,'State':{'Running':False},'HostConfig':{'PortBindings':{
                '3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'3003'}]}}}).encode()
        with mock.patch.object(host,'SOURCE',SOURCE):
            local=host.Local({'nonce':'a'*32,'imageId':'sha256:'+'b'*64},transport=transport)
        with self.assertRaisesRegex(host.native.HostError,'aj_port_reserved'):local.free_port()

    def test_phase_order_cannot_skip_functional_speed_or_browser_gate(self):
        protocol=type('Protocol',(),{'nonce':'a'*32})()
        for action in ['start','switch','browser','accept']:
            driver=host.Driver(protocol)
            driver.host=mock.Mock()
            driver.completed={'init'}
            with self.assertRaises(host.native.HostError):driver.command(action,{},1)
            self.assertEqual(driver.host.mock_calls,[])

    def test_failed_rollback_never_cleans_a_potentially_routed_process(self):
        driver=host.Driver(None);driver.host=mock.Mock();driver.switched=True
        driver.host.rollback.side_effect=RuntimeError('foreign ingress')
        with self.assertRaises(RuntimeError):driver.emergency_rollback()
        driver.host.cleanup.assert_not_called()

    def test_accepted_release_is_not_rolled_back_by_disconnect(self):
        driver=host.Driver(None);driver.host=mock.Mock();driver.accepted=True;driver.switched=True
        driver.emergency_rollback();self.assertEqual(driver.host.mock_calls,[])

    def test_japan_boundary_and_retired_report_are_obligatory(self):
        def respond(target,path):
            if path.startswith('/api/crm/'):return 401,{'error':'unauthorized'}
            if 'korea-report' in path:return 410,{'error':'source_retired'}
            if 'market=japan' in path:return 503,{'ok':False,'error':'japan_search_unavailable','reason':'client_ip_missing'}
            market='china' if 'market=china' in path else 'korea'
            return 200,{'ok':True,'total':1,'items':[{'id':'1'*24,'market':market,'sourceId':'che168_feed' if market=='china' else 'encar_feed'}]}
        with mock.patch.object(host,'public_json',side_effect=respond):
            self.assertTrue(host.check_aj_contract('candidate',lambda phase:None)['passed'])
        def bad(target,path):
            status,value=respond(target,path)
            if 'market=korea' in path:value['items'][0]['id']='ajes-korea-old'
            return status,value
        with mock.patch.object(host,'public_json',side_effect=bad):
            with self.assertRaises(host.native.HostError):host.check_aj_contract('candidate',lambda phase:None)

    def test_server_gate_requires_all_51_samples_and_enforced_original_baseline(self):
        baseline=json.loads((ROOT/'docs/operations/2026-11-11-accepted-speed-baseline.json').read_text())
        routes=list(dict.fromkeys(row['path'] for row in baseline['samples']))
        phases=[{'path':path,'performanceGate':phase,'functionalPassed':True} for path in routes for phase in ['warm','after_ttl','after_directory_ttl']]
        summary={'performanceGate':'summary','marketScope':'','functionalPassed':True,'acceptedBaselineEnforced':True,
                 'samples':51,'routes':routes,'acceptedBaselineRoutes':routes}
        def execute(args,**kwargs):
            self.assertEqual(kwargs['timeout'],1800)
            self.assertEqual(kwargs['env']['AVTOCENA_RELEASE_MARKETS'],'')
            self.assertEqual(kwargs['env']['AVTOCENA_SPEED_BASELINE_MODE'],'enforce')
            self.assertEqual(args[-1],SOURCE)
            return subprocess.CompletedProcess(args,0,('\n'.join(json.dumps(row) for row in [*phases,summary])+'\n').encode())
        # Root-owned file validation is independently tested by the reused host
        # helpers; local CI files belong to its unprivileged runner account.
        def local_file(path,**kwargs):return Path(path).read_bytes(),None
        with mock.patch.object(host,'private_execute',side_effect=execute),mock.patch.object(host,'regular',side_effect=local_file),mock.patch.object(host,'SOURCE',SOURCE):
            self.assertEqual(len(host.full_server_gate('a'*32,'private')['phases']),51)
            phases.pop()
            with self.assertRaises(host.native.HostError):host.full_server_gate('a'*32,'private')

    def failed_server_output(self,rows,phase='private'):
        output=b'PRIVATE_FIXTURE not JSON\n["PRIVATE_FIXTURE"]\n'+b'\n'.join(json.dumps(row).encode() for row in rows)
        def execute(args,**kwargs):
            self.assertEqual(kwargs['timeout'],1800)
            self.assertEqual(kwargs['env']['AVTOCENA_RELEASE_MARKETS'],'')
            self.assertEqual(kwargs['env']['AVTOCENA_SPEED_BASELINE_MODE'],'enforce')
            self.assertEqual(kwargs['stderr'],subprocess.DEVNULL)
            return subprocess.CompletedProcess(args,1,output)
        with mock.patch.object(host,'private_execute',side_effect=execute) as process,\
             mock.patch.object(host,'regular',side_effect=lambda path,**kwargs:(Path(path).read_bytes(),None)):
            with self.assertRaises(host.native.HostError) as caught:host.full_server_gate('a'*32,phase)
        process.assert_called_once()
        self.assertNotIn('PRIVATE_FIXTURE',str(caught.exception))
        return str(caught.exception)

    def test_nonzero_server_gate_preserves_last_verified_request_failure(self):
        baseline=json.loads((ROOT/'docs/operations/2026-11-11-accepted-speed-baseline.json').read_text())
        routes=list(dict.fromkeys(row['path'] for row in baseline['samples']))
        first={'performanceRequest':'failed','path':routes[0],'errorType':'HTTPError'}
        last={'performanceRequest':'failed','path':routes[3],'errorType':'TimeoutError',
              'message':'PRIVATE_FIXTURE /root/secret?password=PRIVATE_FIXTURE','body':'PRIVATE_FIXTURE'}
        self.assertEqual(self.failed_server_output([first,last]),'home_host_aj_server_gate_failed_private_route_4_timeout')
        last['errorType']='JSONDecodeError'
        self.assertEqual(self.failed_server_output([first,last],'public'),'home_host_aj_server_gate_failed_public_route_4_json')
        for field,value in [('path','/PRIVATE_FIXTURE?password=PRIVATE_FIXTURE'),('errorType','PRIVATE_FIXTURE'),('errorType',{})]:
            with self.subTest(field=field,value=value):
                bad=dict(last);bad[field]=value
                self.assertEqual(self.failed_server_output([first,bad]),'home_host_aj_server_gate_failed_private_generic')

    def test_only_blocking_failed_accepted_baseline_json_identifies_speed_regression(self):
        baseline=json.loads((ROOT/'docs/operations/2026-11-11-accepted-speed-baseline.json').read_text())
        route=baseline['samples'][0]['path']
        row={'speedBaseline':'after_ttl','path':route,'blocking':True,'passed':False,'private':'PRIVATE_FIXTURE'}
        self.assertEqual(self.failed_server_output([row],'public'),
                         'home_host_aj_server_gate_failed_public_route_1_accepted_speed_regression')
        for change in ({'blocking':False},{'passed':True},{'speedBaseline':'PRIVATE_FIXTURE'},{'path':'/PRIVATE_FIXTURE'}):
            self.assertEqual(self.failed_server_output([{**row,**change}]),'home_host_aj_server_gate_failed_private_generic')
        self.assertEqual(self.failed_server_output([{'performanceGate':'summary','functionalPassed':True}]),
                         'home_host_aj_server_gate_failed_private_generic')


if __name__=='__main__':unittest.main()
