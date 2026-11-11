#!/usr/bin/env python3
"""Owner-requested crawler blocking; retain the exact November 8 application."""
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

RELEASE = '463fd22559a2f9c5acd60f8f5e4b269689215c84'
ROOT = pathlib.Path(__file__).resolve().parent
CONFIG = pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf')
RULES = pathlib.Path('/etc/nginx/conf.d/avtocena-owner-blocked-crawlers.conf')
BEGIN = '  # BEGIN owner crawler block 2026-11-11\n'
END = '  # END owner crawler block 2026-11-11\n'
GATE = (BEGIN + '  if ($ac_owner_crawler_robots) {\n'
        '    return 200 "User-agent: *\\nDisallow: /\\n";\n'
        '  }\n'
        '  if ($ac_owner_blocked_crawler) { return 403; }\n' + END)


def run(*args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, check=True,
                          timeout=timeout).stdout


def render_rules():
    networks = []
    sources = []
    for name, url in [('amazonbot', 'https://developer.amazon.com/amazonbot/ip-addresses/'),
                      ('reflectionbot', 'https://reflection.ai/bot/ips.json')]:
        raw = (ROOT / (name + '.json')).read_bytes()
        data = json.loads(raw)
        assert data['source'] == url
        rows = [ipaddress.ip_network(value, strict=True) for value in data['prefixes']]
        assert 0 < len(rows) < 10000 and len(rows) == len(set(rows))
        assert all(n.is_global and n.prefixlen >= (16 if n.version == 4 else 32) for n in rows)
        networks.extend(rows)
        sources.append(dict(name=name, source=url, count=len(rows),
                            creationTime=data['creationTime'], sha256=hashlib.sha256(raw).hexdigest()))
    text = '# Owner-approved named crawlers only; official address snapshots.\n'
    text += 'geo $ac_owner_crawler_ip {\n  default 0;\n'
    text += ''.join('  ' + str(n) + ' 1;\n' for n in networks) + '}\n'
    text += '''map $http_user_agent $ac_owner_crawler_ua {
  default 0;
  ~*(Amazonbot|Reflectionbot) 1;
}
map "$ac_owner_crawler_ip:$ac_owner_crawler_ua" $ac_owner_blocked_crawler {
  default 0;
  "1:0" 1;
  "0:1" 1;
  "1:1" 1;
}
map "$ac_owner_blocked_crawler:$uri" $ac_owner_crawler_robots {
  default 0;
  "1:/robots.txt" 1;
}
'''
    return text, sources


def patch_config(text):
    clean = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), '', text, flags=re.S)
    pattern = r'(^[ \t]*server_name[ \t]+avtocena\.com(?:[ \t]+www\.avtocena\.com)?;[ \t]*\n)'
    result, count = re.subn(pattern, lambda m: m[0] + GATE, clean, flags=re.M)
    assert count == 2, 'unexpected_public_server_count'
    assert re.findall(r'proxy_pass\s+[^;]+;', result) == re.findall(r'proxy_pass\s+[^;]+;', text)
    return result


def request(url, agent='Mozilla/5.0', headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': agent, 'Connection': 'close', **(headers or {})})
    try:
        response = urllib.request.urlopen(req, timeout=8)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(1_000_001)


def self_test():
    rules, sources = render_rules()
    fixture = 'server {\n  server_name avtocena.com www.avtocena.com;\n}\n' * 2
    assert patch_config(patch_config(fixture)) == patch_config(fixture)
    assert patch_config(fixture).replace(GATE, '') == fixture
    for invalid in ['', 'server {\n  server_name another.example;\n}\n']:
        try:
            patch_config(invalid)
        except AssertionError:
            pass
        else:
            raise AssertionError('unexpected_vhost_accepted')
    print('OWNER_BOT_BLOCK_STATIC_TESTS_PASS', json.dumps(sources), flush=True)


def nginx_test(rules):
    # The synthetic-IP header is used only by this isolated loopback test process.
    # Production geo uses the connection address, never a visitor-controlled header.
    with tempfile.TemporaryDirectory(prefix='avtocena-bot-test-') as directory:
        root = pathlib.Path(directory)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        test_rules = rules.replace('geo $ac_owner_crawler_ip', 'geo $http_x_validation_ip $ac_owner_crawler_ip', 1)
        conf = root / 'nginx.conf'
        conf.write_text('daemon off; master_process off;\npid ' + str(root / 'nginx.pid') + ';\n'
                        'error_log ' + str(root / 'error.log') + ';\nevents {}\nhttp {\naccess_log off;\n'
                        + test_rules + '\nserver {\nlisten 127.0.0.1:' + str(port) + ';\n'
                        + GATE + 'location / { return 204; }\n}\n}\n')
        run('nginx', '-t', '-p', directory, '-c', str(conf))
        process = subprocess.Popen(['nginx', '-p', directory, '-c', str(conf)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            base = 'http://127.0.0.1:' + str(port)
            for attempt in range(25):
                try:
                    assert request(base + '/api/health')[0] == 204
                    break
                except urllib.error.URLError:
                    time.sleep(.1)
            else:
                raise AssertionError('isolated_nginx_not_ready')
            for agent in ['Amazonbot/0.1', 'ReflectionBot/1.0', 'Mozilla/5.0 (amazonbot/0.1)', 'REFLECTIONBOT']:
                assert request(base + '/cars?market=japan', agent)[0] == 403
                status, body = request(base + '/robots.txt', agent)
                assert status == 200 and b'Disallow: /' in body
            for addr in ['23.21.228.180', '100.29.63.24', '3.94.199.128', '16.216.88.127', '16.216.89.255', '16.216.94.1']:
                assert request(base + '/cars', headers={'X-Validation-IP': addr})[0] == 403
            for agent in ['Mozilla/5.0', 'Googlebot/2.1', 'YandexBot/3.0']:
                assert request(base + '/api/health', agent, {'X-Forwarded-For': '16.216.88.127'})[0] == 204
            assert request(base + '/cars', headers={'X-Validation-IP': '8.8.8.8'})[0] == 204
        finally:
            process.terminate()
            process.wait(timeout=10)
    print('OWNER_BOT_BLOCK_NGINX_TESTS_PASS', flush=True)


def origin(path, agent='Mozilla/5.0', headers=None):
    args = ['curl', '--silent', '--show-error', '--max-time', '12', '--noproxy', '*',
            '--resolve', 'avtocena.com:443:127.0.0.1', '-A', agent, '-w', '\n%{http_code}',
            '-H', 'Connection: close']
    for key, value in (headers or {}).items():
        args += ['-H', key + ': ' + value]
    body, status = run(*args, 'https://avtocena.com' + path, timeout=15).rsplit('\n', 1)
    return int(status), body


def exact_health(agent='Mozilla/5.0', headers=None):
    status, body = origin('/api/health', agent, headers)
    health = json.loads(body)
    assert status == 200 and health.get('ok') is True and health.get('releaseSha') == RELEASE
    return health


def atomic_write(path, data, stat=None):
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.st_mode & 0o7777 if stat else 0o644)
        if stat:
            os.chown(temporary, stat.st_uid, stat.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    self_test()
    if sys.argv[1:] == ['--self-test']:
        return
    run_id = sys.argv[1]
    assert re.fullmatch(r'[0-9]+', run_id)
    assert os.geteuid() == 0
    os.umask(0o077)
    lock = open('/run/lock/avtocena-runtime-change.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    rules, sources = render_rules()
    nginx_test(rules)
    before_health = exact_health()
    before_id = run('docker', 'inspect', '--format', '{{.Id}} {{.Image}} {{.State.StartedAt}}', 'avtocena-production').strip()
    old_config, stat = CONFIG.read_text(), CONFIG.stat()
    new_config = patch_config(old_config)
    old_rules = RULES.read_text() if RULES.exists() else None
    rules_stat = RULES.stat() if RULES.exists() else None
    evidence = pathlib.Path('/opt/avtocena/owner-bot-blocks') / run_id
    evidence.mkdir(mode=0o700, parents=True, exist_ok=False)
    (evidence / 'nginx-before.conf').write_text(old_config)
    if old_rules is not None:
        (evidence / 'rules-before.conf').write_text(old_rules)

    def interrupted(signum, frame):
        raise RuntimeError('crawler_block_interrupted_' + str(signum))
    for sig in [signal.SIGTERM, signal.SIGHUP]:
        signal.signal(sig, interrupted)
    try:
        atomic_write(RULES, rules, rules_stat)
        atomic_write(CONFIG, new_config, stat)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        # Old workers may still complete existing requests; every probe opens a new connection.
        time.sleep(1)
        after_health = exact_health()
        checks = []
        for agent in ['Amazonbot/0.1', 'ReflectionBot/1.0']:
            for path in ['/', '/cars?market=japan', '/api/catalog/search?market=korea', '/api/health']:
                status, _ = origin(path, agent)
                assert status == 403, 'crawler_not_blocked'
                checks.append(dict(agent=agent, path=path, status=status))
            status, body = origin('/robots.txt', agent)
            assert status == 200 and body == 'User-agent: *\nDisallow: /\n'
            checks.append(dict(agent=agent, path='/robots.txt', status=status, disallowAll=True))
        for agent in ['Googlebot/2.1', 'YandexBot/3.0']:
            exact_health(agent)
        exact_health(headers={'X-Forwarded-For': '16.216.88.127'})
        assert run('docker', 'inspect', '--format', '{{.Id}} {{.Image}} {{.State.StartedAt}}', 'avtocena-production').strip() == before_id
        receipt = dict(release=RELEASE, appliedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       runId=run_id, sources=sources, checks=checks, health=after_health,
                       originalContainerUnchanged=True, upstreamUnchanged=True, applicationRestarted=False,
                       feedsChanged=False, nginxSyntaxPassed=True, isolatedNginxTestsPassed=True,
                       rulesSha256=hashlib.sha256(rules.encode()).hexdigest())
        (evidence / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print('OWNER_BOT_BLOCK_ACTIVE ' + json.dumps(receipt), flush=True)
    except BaseException:
        for sig in [signal.SIGTERM, signal.SIGHUP]:
            signal.signal(sig, signal.SIG_IGN)
        atomic_write(CONFIG, old_config, stat)
        if old_rules is None:
            RULES.unlink(missing_ok=True)
        else:
            atomic_write(RULES, old_rules, rules_stat)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        exact_health()
        print('OWNER_BOT_BLOCK_PREVIOUS_CONFIG_RESTORED', flush=True)
        raise


if __name__ == '__main__':
    main()
