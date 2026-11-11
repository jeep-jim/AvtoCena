"""Exercise the exact production config transformer, including repeated deploys."""
import pathlib,subprocess,tempfile,unittest

SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/regcloud-deploy-production.sh'

class ResponseBuffers(unittest.TestCase):
 def test_preserves_routes_security_and_is_idempotent(self):
  original='server {\n  listen 443 ssl;\n  location / {\n    limit_req zone=robots;\n    proxy_pass http://127.0.0.1:3001;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_read_timeout 120s;\n  }\n}\n'
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory)/'nginx.conf';p.write_text(original)
   for _ in range(2):
    subprocess.run(['bash',str(SCRIPT),'--configure-response-buffers',str(p)],check=True)
   result=p.read_text()
   for line in original.splitlines():self.assertIn(line,result)
   self.assertEqual(result.count('proxy_buffer_size 32k;'),1)
   self.assertEqual(result.count('proxy_buffers 8 32k;'),1)
   self.assertEqual(result.count('proxy_busy_buffers_size 64k;'),1)
 def test_unknown_layout_is_not_changed(self):
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory)/'nginx.conf';p.write_text('server {}\n')
   result=subprocess.run(['bash',str(SCRIPT),'--configure-response-buffers',str(p)],capture_output=True)
   self.assertNotEqual(result.returncode,0)
   self.assertEqual(p.read_text(),'server {}\n')

if __name__=='__main__':unittest.main()
