"""Frozen snapshot parity and bounded SQL timing, not a production speed claim."""
import concurrent.futures, hashlib, json, math, os, pathlib, time, urllib.parse
import psycopg
root=pathlib.Path('/tmp/avtocena-search-pilot')
source=json.loads((root/'source.json').read_text())
cases=json.loads((root/'expected.json').read_text())
dsn=os.environ['SEARCH_PILOT_DATABASE_URL']
parsed=urllib.parse.urlsplit(dsn)
assert parsed.hostname=='127.0.0.1' and parsed.path=='/avtocena_pilot','ephemeral_database_required'
connect=lambda:psycopg.connect(dsn,autocommit=True,options='-c statement_timeout=30000')
with connect() as db:
 db.execute(pathlib.Path('scripts/search-pilot/schema.sql').read_text())
 generation=source['generationId'];db.execute('INSERT INTO search_pilot_generation VALUES (%s,false)',[generation])
 with db.cursor().copy('COPY search_pilot_offer FROM STDIN WITH (FORMAT CSV)') as copy:
  with (root/'china.csv').open('rb') as file:
   while chunk:=file.read(1024*1024):copy.write(chunk)
 db.execute('VACUUM ANALYZE search_pilot_offer')
 assert db.execute('SELECT count(*) FROM search_pilot_visible').fetchone()[0]==0
 with db.transaction():
  assert db.execute('SELECT count(*) FROM search_pilot_offer WHERE generation=%s',[generation]).fetchone()[0]==source['cityRows']
  db.execute('UPDATE search_pilot_generation SET ready=true WHERE generation=%s',[generation])
  db.execute('INSERT INTO search_pilot_active(singleton,generation) VALUES (true,%s)',[generation])
 assert db.execute('SELECT count(*) FROM search_pilot_visible').fetchone()[0]==source['cityRows']
 with connect() as writer:
  writer.execute('INSERT INTO search_pilot_generation VALUES (%s,false)',[generation+'-incomplete'])
  try:
   with writer.transaction():
    writer.execute('UPDATE search_pilot_active SET generation=%s',[generation+'-incomplete'])
    raise AssertionError('unready_generation_was_accepted')
  except psycopg.errors.ForeignKeyViolation:pass
 assert db.execute('SELECT count(*) FROM search_pilot_visible').fetchone()[0]==source['cityRows']
def queries(q,generation):
 clauses=['generation=%s','city=%s','price IS NOT NULL'];args=[generation,q['city']]
 if 'budget' in q:clauses.append('price<=%s');args.append(q['budget'])
 if 'make' in q:clauses.append('make=%s');args.append(q['make'])
 if 'power' in q:clauses.append('power<=%s');args.append(q['power'])
 where=' WHERE '+' AND '.join(clauses);order='DESC' if q['descending'] else 'ASC'
 return 'SELECT id FROM search_pilot_offer'+where+f' ORDER BY price {order},id {order} LIMIT 24 OFFSET %s',args+[q['offset']],'SELECT count(*) FROM search_pilot_offer'+where,args
def sample(db,q):
 started=time.perf_counter()
 with db.transaction():
  db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
  active=db.execute('SELECT a.generation FROM search_pilot_active a JOIN search_pilot_generation g ON g.generation=a.generation AND g.ready').fetchone()
  assert active and active[0]==source['generationId'],'generation_changed'
  sql,args,count,countargs=queries(q,active[0])
  ids=[row[0] for row in db.execute(sql,args).fetchall()];total=db.execute(count,countargs).fetchone()[0]
 elapsed=(time.perf_counter()-started)*1000
 assert ids==q['ids'] and total==q['total'],q['name']+'_parity_failed'
 return elapsed
def plan_summary(plan):
 out=[]
 def visit(node):
  out.append({k:node[k] for k in ['Node Type','Index Name','Actual Rows','Actual Loops','Sort Method','Shared Hit Blocks','Shared Read Blocks'] if k in node})
  for child in node.get('Plans',[]):visit(child)
 visit(plan['Plan']);return out
report={**source,'environment':'ephemeral GitHub Actions PostgreSQL 16; only DB page+count time, no HTML/network/photos','correctness':{'sameSnapshotIdsAndCounts':True,'unpublishedGenerationInvisible':True,'unreadyGenerationBlocked':True,'failedImportPreservesActive':True},'cases':[],'passed':False}
for q in cases:
 with connect() as db:
  first=sample(db,q);sql,args,count,countargs=queries(q,generation)
  plan=db.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,args).fetchone()[0][0]
  countplan=db.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+count,countargs).fetchone()[0][0]
  single=[sample(db,q) for _ in range(30)]
 def worker(_):
  with connect() as db:return [sample(db,q) for _ in range(10)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  four_clients=[v for group in pool.map(worker,range(4)) for v in group]
 def timings(values):
  ordered=sorted(values);return {'samples':len(values),'p50Ms':round(ordered[math.ceil(len(values)*.5)-1],3),'p95Ms':round(ordered[math.ceil(len(values)*.95)-1],3),'maxMs':round(max(values),3)}
 report['cases'].append({'name':q['name'],'matchingCount':q['total'],'pageRows':len(q['ids']),'firstQueryMs':round(first,3),'warm':timings(single),'fourClients':timings(four_clients),'pagePlan':plan,'countPlan':countplan,'pagePlanSummary':plan_summary(plan),'countPlanSummary':plan_summary(countplan),'idsChecksum':hashlib.sha256(json.dumps(q['ids']).encode()).hexdigest()})
with connect() as db:report['relationBytes']=db.execute("SELECT pg_total_relation_size('search_pilot_offer')").fetchone()[0]
report['passed']=True
pathlib.Path('owner-search-pilot-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('SEARCH_PILOT_RESULT',json.dumps({**report,'cases':[{k:v for k,v in q.items() if not k.endswith('Plan')} for q in report['cases']]},ensure_ascii=False))
