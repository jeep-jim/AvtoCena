import unittest, importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('h2', Path(__file__).resolve().parents[1] / 'scripts/regcloud-http2-config.py')
h2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h2)
class TestHttp2(unittest.TestCase):
    def test_supported_versions_and_idempotence(self):
        source='server {\n listen 80;\n}\nserver {\n listen 443 ssl default_server;\n ssl_reject_handshake on;\n}\nserver {\n listen 443 ssl;\n server_name avtocena.com;\n location / { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Real-IP $remote_addr; }\n}\n'
        for version in ['1.18.0','1.24.0','1.26.3','1.28.0']:
            result=h2.enable_http2(source, version)
            self.assertEqual(result.count('http2'), 2)
            self.assertEqual(h2.enable_http2(result, version), result)
            self.assertIn('listen 80;', result)
            self.assertIn('proxy_pass http://127.0.0.1:3000; proxy_set_header X-Real-IP $remote_addr;', result)
            self.assertIn('ssl_reject_handshake on;', result)
            self.assertNotIn('proxy_cache', result)
    def test_ipv6_and_comments(self):
        source='server {\n listen [::]:443 ssl; # tls\n}\n'
        self.assertIn('listen [::]:443 ssl http2; # tls', h2.enable_http2(source,'1.24.0'))
    def test_refuse_unknown_or_explicit_policy(self):
        for source,version in [('listen 80;','1.24.0'),(' listen 443 ssl;','unknown'),(' listen 443 ssl;','1.8.0'),(' listen 443 ssl;\n http2 off;','1.26.0'),(' listen 443 ssl;\n http2 on;\n listen 443 ssl default_server;','1.26.0')]:
            with self.assertRaises(ValueError): h2.enable_http2(source,version)
if __name__ == '__main__': unittest.main()
