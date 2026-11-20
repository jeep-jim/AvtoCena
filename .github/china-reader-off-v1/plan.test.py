import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from plan import approved_event, equal_health, parse, verify_checkout

base={'version':1,'kind':'china-regcloud-reader-image-v1','appSha':'a'*40,'previousSha':'b'*40,
      'previousCalculator':'c'*64,'candidateCalculator':'d'*64,'privateIndexSha256':'e'*64,
      'reviewedDeltaSha256':'f'*64,'mayLoadImage':False,'mayActivate':False,'mayPublishCatalog':False}

class Plan(unittest.TestCase):
    def test_unchanged_reuse_is_not_implied(self):
        p=parse(json.dumps(base).encode())
        self.assertNotEqual(p['previousCalculator'],p['candidateCalculator'])
        self.assertFalse(p['mayActivate'])

    def test_authority_refused(self):
        for patch in [{'mayActivate':True}, {'mayPublishCatalog':True}, {'mayLoadImage':'true'},
                      {'appSha':'evil; true'},{'unknown':'not allowed'}]:
            with self.assertRaises(ValueError):
                parse(json.dumps(base|patch).encode())

    def test_real_push_actor_only(self):
        env=dict(GITHUB_EVENT_NAME='push',GITHUB_REF='refs/heads/main',
                 GITHUB_REPOSITORY='jeep-jim/AvtoCena',GITHUB_RUN_ATTEMPT='1')
        approved_event(env)
        for k in env:
            with self.assertRaises(ValueError):
                approved_event(env|{k:'other'})

    def test_incumbent_sha_and_namespace_are_both_fenced(self):
        h=dict(ok=True,releaseSha=base['previousSha'],calculationVersion=base['previousCalculator'])
        equal_health(h,base)
        for k in h:
            with self.assertRaises(ValueError):
                equal_health(h|{k:'wrong'},base)

    def test_exact_reviewed_diff_and_clean_sha_required(self):
        with tempfile.TemporaryDirectory() as td:
            def git(*args): return subprocess.check_output(['git','-C',td,*args],stderr=subprocess.DEVNULL)
            git('init')
            file=Path(td)/'app.txt'
            def commit(text):
                file.write_text(text)
                git('add','app.txt')
                git('-c','user.name=fixture','-c','user.email=test@example.invalid','commit','-m',text)
                return git('rev-parse','HEAD').decode().strip()
            before=commit('previous')
            after=commit('candidate')
            delta=git('diff','--no-ext-diff','--raw','--no-renames','--abbrev=40','-z',before,after,'--')
            p=base|dict(previousSha=before,appSha=after,reviewedDeltaSha256=hashlib.sha256(delta).hexdigest())
            verify_checkout(p,td)
            with self.assertRaises(ValueError):
                verify_checkout(p|{'reviewedDeltaSha256':'0'*64},td)
            file.write_text('local modification')
            with self.assertRaises(ValueError):
                verify_checkout(p,td)

if __name__=='__main__':
    unittest.main()
