#!/usr/bin/env python3
"""Never publish raw runner/actor stderr, receipt, response data or replica keys."""
import datetime as dt,json,os,pathlib,re,sys
EXPECTED_GENERATION='gen_1795166586455_china44710087159'
EXPECTED_CONTROL='9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62'
HELD={
 'china_daily_dry:plan_sha','china_daily_dry:plan_scope','china_daily_dry:storage_scope','china_daily_dry:local_input_pin',
 'china_daily_dry:no_network_write','china_daily_dry:no_supplier_or_foreign_read','china_daily_dry:read_scope_or_budget',
 'china_daily_dry:accepted_pointer','china_daily_dry:archive_pin','china_daily_dry:native_continuity','china_daily_dry:args','china_daily_dry:local_file',
 'china_daily_source:receipt_sha','china_daily_source:archive_receipt','china_daily_source:archive_scope','china_daily_source:archive_manifest',
 'china_daily_source:archive_report_manifest','china_daily_source:report_shard_scope','china_daily_source:report_shard_wire','china_daily_source:report_shard_integrity',
 'china_daily_source:report_sha','china_daily_source:report_source','china_daily_source:snapshot_binding','china_daily_source:replica_manifest',
 'china_daily_source:replica_shard_integrity','china_daily_source:bootstrap_not_permitted','china_daily_source:bootstrap_receipt_required','china_daily_source:checkpoint_binding',
 'china_own_regcloud:stage_authority','china_own_regcloud:active_cut_changed','china_own_regcloud:accepted_ref','china_own_regcloud:storage_scope',
 'china_own_regcloud:ready_sha','china_own_regcloud:ready_scope','china_own_regcloud:runtime_ready_sha','china_own_regcloud:runtime_ready_scope',
 'auto_api_saved_replica_required','auto_api_invalid_saved_replica_cursor','auto_api_invalid_snapshot_config','source_validation_unverified',
}
def need(ok):
    if not ok:raise ValueError('dry_evidence_scope')
def int_between(v,lo,hi):return type(v) is int and lo<=v<=hi
def read(p):
    blob=p.read_bytes()
    need(0<len(blob)<=8192)
    return json.loads(blob)
def iso(ms):return dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc).isoformat(timespec='milliseconds')
def inspect(folder,rc):
    if rc!=0:
        reason='actor_failed'
        try:
            err=read(folder/'actor.stderr')
            candidate=err.get('reason','') if err.get('status')=='held' else ''
            if isinstance(candidate,str) and candidate in HELD:reason=candidate
        except (OSError,TypeError,ValueError,AttributeError):pass
        return {'status':'china_daily_source_preflight_held','reason':reason,'publication':False,'scheduleHeld':True}
    e=read(folder/'actor.stdout')
    need(e.get('version')==1 and e.get('kind')=='china-independent-daily-dry-evidence-v1' and e.get('market')=='china' and
         e.get('generationId')==EXPECTED_GENERATION and e.get('controlSha256')==EXPECTED_CONTROL and e.get('revision')==5 and
         e.get('sourceObservedAt')=='2026-11-19T05:02:36.435Z' and e.get('sourceRows')==290044 and
         e.get('currentStageDraftValidUntil')==1795237356435 and type(e.get('currentStageDraftExpired')) is bool and
         type(e.get('legalHorizonProven')) is bool and
         int_between(e.get('acceptedLegalUntil'),e['currentStageDraftValidUntil'],10**14) and
         int_between(e.get('signedStorageGets'),1,12000) and int_between(e.get('distinctObjects'),1,e['signedStorageGets']) and
         type(e.get('supplierRequests')) is int and e['supplierRequests']==0 and type(e.get('storageWrites')) is int and e['storageWrites']==0 and
         e.get('publicationAuthorized') is False and e.get('cursorAdvanceAuthorized') is False and
         e.get('scheduleHeld') is True and e.get('scheduledUtc')=='14:00' and e.get('nextArchiveMustBeFresh') is True)
    n=e.get('nativeResume',{})
    need(n.get('mode')=='local_replica_and_changes' and n.get('initialCursor')==13123821 and
         n.get('snapshotBinding')=='032dde88cb625f29ed2cce31398eb131b98dca8a30ac352819597aab3689ad64' and
         all(re.fullmatch(r'[a-f0-9]{64}',n.get(k,'')) for k in ('replicaSha256','journalBinding')) and
         re.fullmatch(r'\d{1,20}',n.get('artifactRunId','')))
    return {'status':'china_daily_source_preflight_verified','generationId':EXPECTED_GENERATION,'revision':5,
            'archiveReplicaVerified':True,'sourceObservedAt':e['sourceObservedAt'],'sourceRows':e['sourceRows'],
            'cursor':13123821,'draftExpired':e['currentStageDraftExpired'],'draftValidUntil':iso(e['currentStageDraftValidUntil']),
            'acceptedLegalUntil':iso(e['acceptedLegalUntil']) if e['legalHorizonProven'] else None,'legalHorizonProven':e['legalHorizonProven'],'signedStorageGets':e['signedStorageGets'],
            'supplierRequests':0,'storageWrites':0,'publication':False,'cursorAdvanced':False,'scheduleHeld':True,'scheduledUtc':'14:00'}
if __name__=='__main__':
    try:
        root=pathlib.Path(sys.argv[1]);rc=int(sys.argv[2])
        report=inspect(root,rc);print(json.dumps(report,separators=(',',':')))
        code=0 if report.get('status')=='china_daily_source_preflight_verified' else 1
    except (OSError,ValueError,OverflowError,TypeError,KeyError,AttributeError,IndexError):
        print('{"status":"china_daily_source_preflight_held","reason":"dry_evidence_scope","publication":false,"scheduleHeld":true}')
        code=1
    raise SystemExit(code)
