import json
import pathlib
import urllib.error
import urllib.request

RELEASE = '463fd22559a2f9c5acd60f8f5e4b269689215c84'
checks = []
for agent, path, expected in [
    ('Mozilla/5.0', '/api/health', 200),
    ('Amazonbot/0.1', '/cars?market=japan', 403),
    ('ReflectionBot/1.0', '/cars?market=korea', 403),
    ('Amazonbot/0.1', '/robots.txt', 200),
    ('ReflectionBot/1.0', '/robots.txt', 200),
    ('Googlebot/2.1', '/api/health', 200),
    ('YandexBot/3.0', '/api/health', 200),
]:
    req = urllib.request.Request('https://avtocena.com' + path,
                                 headers={'User-Agent': agent, 'Connection': 'close'})
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status, body = response.status, response.read(1_000_001)
    assert status == expected, (agent, path, status)
    if path == '/api/health':
        data = json.loads(body)
        assert data.get('ok') is True and data.get('releaseSha') == RELEASE
    if path == '/robots.txt':
        assert body == b'User-agent: *\nDisallow: /\n'
    checks.append(dict(agent=agent, path=path, status=status))
result = {'release': RELEASE, 'publicVerified': True, 'checks': checks}
pathlib.Path('owner-bot-block-public.json').write_text(json.dumps(result, indent=2) + '\n')
print('OWNER_BOT_BLOCK_PUBLIC_VERIFIED', json.dumps(result))
