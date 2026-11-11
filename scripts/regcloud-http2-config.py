"""Only add HTTP/2 to existing TLS listeners; preserve upstream/cache/auth directives."""
import re

def enable_http2(text: str, version: str) -> str:
    found = re.search(r'(\d+)\.(\d+)\.(\d+)', version)
    if not found:
        raise ValueError('unknown_nginx_version')
    current = tuple(map(int, found.groups()))
    if current < (1, 9, 5):
        raise ValueError('unsupported_nginx_version')
    modern = current >= (1, 25, 1)
    if re.search(r'^\s*http2\s+off\s*;', text, re.M):
        raise ValueError('explicit_http2_off_requires_review')
    pattern = re.compile(r'^(?P<indent>[ \t]*)listen[ \t]+(?P<args>(?:443|\[::\]:443)[ \t]+[^;\n]*\bssl\b[^;\n]*);(?P<comment>[ \t]*(?:#[^\n]*)?)$', re.M)
    matches = list(pattern.finditer(text))
    if not 1 <= len(matches) <= 4:
        raise ValueError('unexpected_tls_listener_count')
    enabled = len(re.findall(r'^\s*http2\s+on\s*;', text, re.M))
    if enabled:
        if enabled != len(matches):
            raise ValueError('partially_enabled_configuration_requires_review')
        return text
    def replace(match):
        args = match.group('args')
        if re.search(r'\bhttp2\b', args):
            return match.group(0)
        if modern:
            return match.group(0) + '\n' + match.group('indent') + 'http2 on;'
        return match.group('indent') + 'listen ' + args + ' http2;' + match.group('comment')
    return pattern.sub(replace, text)

if __name__ == '__main__':
    import pathlib, subprocess, sys
    path = pathlib.Path(sys.argv[1])
    if path != pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf'):
        raise ValueError('unexpected_configuration_path')
    version = subprocess.check_output(['nginx', '-v'], stderr=subprocess.STDOUT, text=True)
    old = path.read_text()
    new = enable_http2(old, version)
    path.write_text(new)
    print('NGINX_TRANSPORT_VERSION', version.strip())
    print('HTTP2_CONFIG_CHANGED', new != old)
