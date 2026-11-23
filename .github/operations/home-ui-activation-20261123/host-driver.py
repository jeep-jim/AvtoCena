"""Closed persistent SSH protocol for the existing Node acceptance controller."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import queue
import re
import signal
import stat
import subprocess
import sys
import tarfile
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('native_home', ROOT / '.github/operations/home-ui-adapter-20261123/host-primitives.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class Protocol:
    def __init__(self, reader, writer, nonce, *, interrupt=lambda: os.kill(os.getpid(), signal.SIGUSR1)):
        self.reader, self.writer, self.nonce, self.interrupt = reader, writer, nonce, interrupt
        self.commands, self.replies, self.uploads = queue.Queue(), {}, {}
        self.finished_uploads = set()
        self.sequence, self.closed, self.graceful, self.last_call = 0, False, False, 0
        self.output_lock = threading.Lock()
        self.verdict_directory = None

    def emit(self, value):
        with self.output_lock:
            self.writer.write(json.dumps(value, separators=(',', ':')) + '\n')
            self.writer.flush()

    def read_loop(self):
        try:
            while True:
                line = self.reader.readline(1024 * 1024 + 1)
                if not line:
                    break
                host.need(len(line) <= 1024 * 1024 and line.endswith(b'\n'), 'protocol_frame')
                value = json.loads(line)
                kind, identity = value.get('kind'), value.get('id')
                if kind == 'call':
                    host.need(type(identity) is int and identity == self.last_call + 1 and isinstance(value.get('method'), str), 'protocol_call')
                    self.last_call = identity
                    if value['method'] in ('image', 'private-index'):
                        host.need(identity not in self.uploads, 'protocol_upload_replay')
                        self.uploads[identity] = queue.Queue(maxsize=8)
                    self.commands.put(value)
                elif kind in ('chunk', 'end'):
                    if identity in self.finished_uploads:
                        continue  # Drain a failed upload without blocking rollback control frames.
                    host.need(identity in self.uploads, 'protocol_upload_scope')
                    self.uploads[identity].put(None if kind == 'end' else base64.b64decode(value['data'], validate=True))
                elif kind == 'authority':
                    host.need(identity in self.replies and self.replies[identity].empty(), 'protocol_authority_replay')
                    self.replies[identity].put(value)
                elif kind == 'browser-verdict':
                    verdict = value.get('value')
                    keys = {'schemaVersion', 'release', 'nonce', 'passed', 'functionalPassed', 'speedPassed', 'reportSha256'}
                    host.need(self.verdict_directory is not None and isinstance(verdict, dict) and set(verdict) == keys
                              and verdict['schemaVersion'] == 1 and verdict['release'] == host.SOURCE and verdict['nonce'] == self.nonce
                              and all(type(verdict[key]) is bool for key in ('passed', 'functionalPassed', 'speedPassed'))
                              and re.fullmatch(r'[a-f0-9]{64}', verdict['reportSha256']) is not None, 'protocol_browser')
                    target = self.verdict_directory / ('browser-verdict-' + self.nonce + '.json')
                    host.write_new(target, host.json_bytes(verdict))
                else:
                    raise host.HostError('home_host_protocol_kind')
        except BaseException:
            pass
        self.closed = True
        self.commands.put(None)
        if not self.graceful:
            self.interrupt()

    def authority(self, phase, generation, fingerprint):
        host.need(not self.closed, 'controller_disconnected')
        self.sequence += 1
        identity = self.sequence
        reply = self.replies[identity] = queue.Queue(maxsize=1)
        try:
            self.emit({'kind': 'authority-request', 'id': identity, 'phase': phase})
            value = reply.get(timeout=60)
            host.need(value.get('ok') is True and value.get('generationId') == generation
                      and value.get('acceptedReadModelFingerprint') == fingerprint
                      and value.get('operationId') == 'home-ui-catalog-0509-' + self.nonce
                      and type(value.get('lockedUntilMs')) is int and value['lockedUntilMs'] > time.time() * 1000,
                      'controller_authority')
        finally:
            del self.replies[identity]

    def upload_stream(self, identity):
        source = self.uploads[identity]
        class Stream:
            pending = b''
            ended = False
            announced = False
            def read(inner, maximum):
                if not inner.announced:
                    inner.announced = True
                    self.emit({'kind': 'upload-ready', 'id': identity})
                if inner.pending:
                    result, inner.pending = inner.pending[:maximum], inner.pending[maximum:]
                    return result
                if inner.ended:
                    return b''
                value = source.get(timeout=60)
                if value is None:
                    inner.ended = True
                    return b''
                inner.pending = value
                return inner.read(maximum)
        return Stream()

    def finish_upload(self, identity):
        self.finished_uploads.add(identity)
        source = self.uploads.pop(identity, None)
        if source is not None:
            while True:
                try:
                    source.get_nowait()
                except queue.Empty:
                    break


def private_execute(args, **options):
    process = subprocess.Popen(args, start_new_session=True, **{key: value for key, value in options.items() if key != 'timeout'})
    try:
        output, _ = process.communicate(timeout=options.get('timeout', 1800))
        return subprocess.CompletedProcess(args, process.returncode, output)
    except BaseException:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
        raise


class Driver:
    def __init__(self, protocol):
        self.protocol = protocol
        self.adapter = None
        self.accepted = False
        self.switched = False
        self.completed = set()
        self.browser_directory = None

    def need_phase(self, *names):
        host.need(all(name in self.completed for name in names), 'driver_phase')

    def install_image(self, stream, size):
        adapter = self.adapter
        adapter.guard('image_load')
        host.need(type(size) is int and size > 0 and size == adapter.plan['imageArchiveBytes'], 'image_archive_size')
        capacity = adapter.local.transfer_capacity(ROOT, size)
        target = ROOT / 'image.tar'
        digest, count = hashlib.sha256(), 0
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        try:
            with os.fdopen(fd, 'wb') as handle:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    host.need(count <= size, 'image_archive_size')
                    digest.update(chunk)
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            host.need(count == size and digest.hexdigest() == adapter.plan['imageBuild']['imageArchiveSha256'], 'image_archive_digest')
            with tarfile.open(target, mode='r:') as archive:
                member = archive.getmember('manifest.json')
                host.need(member.isfile() and member.size < 65536, 'image_manifest')
                manifest = json.load(archive.extractfile(member))
                host.need(isinstance(manifest, list) and len(manifest) == 1
                          and set(manifest[0].get('RepoTags') or []) <= {'avtocena-home-build:' + host.SOURCE}, 'image_tag_scope')
            adapter.guard('image_load_verified')
            result = private_execute(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'image', 'load', '--input', str(target)],
                                     env={'PATH': '/usr/bin:/bin'}, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, timeout=300)
            host.need(result.returncode == 0, 'image_load_failed')
            return {'imageId': adapter.plan['imageId'], 'archiveSha256': digest.hexdigest(), 'bytes': count, 'diskBeforeTransfer': capacity}
        finally:
            target.unlink(missing_ok=True)

    def command(self, method, params, identity):
        if method == 'init':
            host.need(self.adapter is None and params['plan']['nonce'] == self.protocol.nonce, 'driver_init')
            self.adapter = host.HostPrimitives(params['plan'], params['reviewedPlanSha256'], params['inventory'], self.protocol.authority)
            self.adapter.locked = True  # The authenticated loader holds the real exclusive fd until exit.
            self.adapter.fresh_inventory()
            self.adapter.prepare_material_directories()
            self.browser_directory = Path(host.ROLLBACK_PARENT) / ('browser-' + self.protocol.nonce)
            self.browser_directory.mkdir(mode=0o700)
            self.completed.add('init')
            return {'initialized': True, 'source': host.SOURCE}
        self.need_phase('init')
        adapter = self.adapter
        if method == 'image':
            host.need('image' not in self.completed, 'driver_image_replay')
            value = self.install_image(self.protocol.upload_stream(identity), params['bytes'])
        elif method == 'private-index':
            host.need('private-index' not in self.completed, 'driver_private_replay')
            value = adapter.install_private_index(self.protocol.upload_stream(identity))
        elif method == 'resources':
            host.need('resources' not in self.completed, 'driver_resources_replay')
            value = adapter.install_resource_bundle({name: base64.b64decode(raw, validate=True) for name, raw in params['files'].items()})
        elif method == 'fresh':
            adapter.fresh_inventory()
            return {'fresh': True}
        elif method == 'start':
            self.need_phase('image', 'private-index', 'resources')
            host.need('start' not in self.completed, 'driver_start_replay')
            value = adapter.start_candidate()
        elif method == 'identity':
            self.need_phase('start')
            adapter.verify_candidate()
            return {'verified': True}
        elif method in ('parity-private', 'parity-public'):
            self.need_phase('start' if method == 'parity-private' else 'switch')
            target = 'candidate' if method == 'parity-private' else 'public'
            def checked_get(*args):
                adapter.guard('parity_request')
                return host.public_get(*args)
            value = host.check_card_price_auth_parity(adapter.guard, get=checked_get, target=target)
        elif method in ('server-private', 'server-public'):
            self.need_phase('parity-private' if method == 'server-private' else 'parity-public')
            adapter.guard(method)
            value = host.run_full_server_gate(ROOT, self.protocol.nonce, method.split('-')[1], private_execute)
            adapter.guard('server_readback')
        elif method == 'switch':
            self.need_phase('server-private')
            host.need(not self.switched, 'driver_switch_replay')
            self.switched = True  # A transport/reload error can follow an actual write.
            adapter.switch(Path(host.ROLLBACK_PARENT) / self.protocol.nonce)
            value = {'switched': True}
        elif method == 'public-identity':
            self.need_phase('switch')
            adapter.local.health('public')
            return {'verified': True}
        elif method == 'browser':
            self.need_phase('server-public')
            protocol = self.protocol
            protocol.verdict_directory = self.browser_directory
            class BrowserOutput(io.StringIO):
                def write(inner, value):
                    previous = inner.getvalue()
                    result = super().write(value)
                    current = inner.getvalue()
                    if 'BROWSER_ACCEPTANCE_REQUIRED ' in current and '\n' in current and '\n' not in previous:
                        protocol.emit({'kind': 'browser-ready', 'nonce': protocol.nonce, 'release': host.SOURCE})
                    return result
            with contextlib.redirect_stdout(BrowserOutput()):
                value = host.wait_browser(ROOT, self.browser_directory, self.protocol.nonce)
        elif method == 'accept':
            self.need_phase('browser')
            adapter.verify_candidate()
            adapter.local.health('public')
            value = {'accepted': True, 'source': host.SOURCE, 'imageId': adapter.plan['imageId'], 'nonce': self.protocol.nonce}
            host.write_new(ROOT / 'accepted.json', host.json_bytes(value))
            self.accepted = True
        elif method == 'rollback':
            host.need(not self.accepted, 'driver_already_accepted')
            if adapter.ingress is not None:
                adapter.rollback()
            else:
                host.inventory.verify_config(host.inventory.LocalIO.config())
                host.inventory.verify_health(host.inventory.LocalIO())
            self.switched = False
            return {'restored': True}
        elif method == 'retained-identity':
            adapter.local.health('retained')
            host.inventory.verify_health(host.inventory.LocalIO())
            return {'verified': True}
        elif method == 'cleanup':
            host.need(not self.accepted and not self.switched, 'driver_cleanup_routed')
            if adapter.candidate is not None:
                adapter.cleanup_candidate()
                adapter.candidate = None
            return {'cleaned': True}
        elif method == 'close':
            host.need(self.accepted or adapter.candidate is None, 'driver_close_unverified')
            return {'closed': True, 'accepted': self.accepted}
        else:
            raise host.HostError('home_host_driver_method')
        self.completed.add(method)
        return value

    def emergency_rollback(self):
        if self.accepted or self.adapter is None:
            return
        adapter = self.adapter
        if self.switched and adapter.ingress is not None:
            adapter.rollback()
            self.switched = False
        if adapter.candidate is not None:
            adapter.cleanup_candidate()
            adapter.candidate = None


def main(reader=sys.stdin.buffer, writer=sys.stdout):
    host.need(type(globals().get('HELD_RUNTIME_LOCK')) is int and re.fullmatch(r'[a-f0-9]{32}', globals().get('SESSION_NONCE', '')), 'loader_required')
    info = os.fstat(HELD_RUNTIME_LOCK)
    host.need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'loader_lock')
    protocol = Protocol(reader, writer, SESSION_NONCE)
    driver = Driver(protocol)
    def disconnected(signum, frame):
        raise host.HostError('home_host_controller_disconnected')
    for signum in (signal.SIGUSR1, signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, disconnected)
    threading.Thread(target=protocol.read_loop, daemon=True).start()
    protocol.emit({'kind': 'ready', 'source': host.SOURCE, 'nonce': SESSION_NONCE})
    try:
        while True:
            command = protocol.commands.get()
            host.need(command is not None, 'controller_disconnected')
            identity = command['id']
            try:
                result = driver.command(command['method'], command.get('params', {}), identity)
                if command['method'] == 'close':
                    protocol.graceful = True
                protocol.emit({'kind': 'result', 'id': identity, 'value': result})
                if command['method'] == 'close':
                    return
            except Exception as error:
                code = str(error) if isinstance(error, (host.HostError, host.inventory.InventoryError)) else 'home_host_operation_failed'
                protocol.emit({'kind': 'error', 'id': identity, 'code': code})
            finally:
                if command['method'] in ('image', 'private-index'):
                    protocol.finish_upload(identity)
    finally:
        # Broken runner/SSH cannot strand a newly routed process. Stop further
        # interruption only during bounded rollback; foreign ingress still wins.
        for signum in (signal.SIGUSR1, signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(signum, signal.SIG_IGN)
        driver.emergency_rollback()


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        # No exception text, Docker Env, index bytes or response bodies on stderr.
        sys.stderr.write('home_activation_host_unverified\n')
        sys.exit(1)
