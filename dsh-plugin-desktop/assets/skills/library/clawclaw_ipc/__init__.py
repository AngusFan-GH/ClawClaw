# -*- coding: utf-8 -*-
"""ClawClaw 端上 IPC 客户端（CLAWCLAW_IPC）。

两个原语，和 TS 客户端同形：

    from clawclaw_ipc import connect
    with connect(client_id="my-skill", client_kind="skill") as client:
        pipe = client.get_pipe("clawclaw.request")
        print(pipe.methods)                       # 当前可调的方法名
        r = pipe.invoke("http.fetch", {"method": "GET", "path": "/..."})

载荷契约看 API 文档（同 REST 只公布 path），这里只认字符串方法名——
宿主加能力，本模块零改动。

第三个原语 subscribe 未实现：v1 宿主一个 stream 方法都没有。线协议给它留了
``mode: "stream"``，将来补上是纯增量，本模块也只需加一个方法。

每次调用默认带 60s 超时（宿主实现挂死不该把脚本一起拖死），超时抛
``ClawClawIpcError`` 且 ``code == "E_TIMEOUT"``；确有长调用可传 ``timeout=None``。

**只依赖标准库**：不许在这里 import requests 之类，skill 脚本可能在离线环境跑。
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import struct
import sys
import threading

PROTOCOL_VERSION = 1

# 发现走**约定路径**，不走 env：ClawClaw 的沙箱只 export 一张硬编码白名单，
# 新增 env 到不了 skill 脚本；而 CLAWCLAW_CONFIG_DIR 早已在那张名单里。
# 与宿主 endpoint.ts::clawclaw_ipcDiscoveryPath、agent-cli clawclaw-config-dir.ts 同规则。
CONFIG_DIR_ENV = "CLAWCLAW_CONFIG_DIR"
DISCOVERY_RELPATH = ("clawclaw_ipc", "endpoint.json")


def clawclaw_config_dir():
    return (os.environ.get(CONFIG_DIR_ENV, "").strip()
            or os.path.join(os.path.expanduser("~"), ".clawclaw"))


def discovery_path():
    """`{endpoint, ticket}` 所在的 0600 文件。读不到 = 不在 ClawClaw 环境。"""
    return os.path.join(clawclaw_config_dir(), *DISCOVERY_RELPATH)

MAX_FRAME_BYTES = 1024 * 1024
HANDSHAKE_TIMEOUT_S = 5.0
# 单次调用的默认超时；传 timeout=None 表示无限等（不推荐）。
DEFAULT_CALL_TIMEOUT_S = 60.0
# socket 级 I/O 超时：读线程借它周期性醒来（不算错误），阻塞写在此之后判连接已死。
SOCKET_IO_TIMEOUT_S = 30.0


class ClawClawIpcError(Exception):
    """带稳定错误码的异常；调用方**按 code 分支**，别匹配 message。"""

    def __init__(self, code, message, data=None):
        super().__init__("%s: %s" % (code, message))
        self.code = code
        self.message = message
        self.data = data or {}


class NotClawClawEnv(ClawClawIpcError):
    def __init__(self, message="not running inside ClawClaw"):
        ClawClawIpcError.__init__(self, "E_NOT_CLAWCLAW", message)


class EndpointUntrusted(ClawClawIpcError):
    """对端证明不了自己（端点可能被抢占）。**硬失败，绝不回落**。"""

    def __init__(self, message="clawclaw_ipc endpoint failed to prove ticket possession"):
        ClawClawIpcError.__init__(self, "E_ENDPOINT_UNTRUSTED", message)


class ConsentRequired(ClawClawIpcError):
    """宿主在，只是没授权。提示用户去 ClawClaw 授权，别自己拉 OAuth。"""


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _ticket_id(ticket):
    return hashlib.sha256(ticket.encode("utf-8")).hexdigest()[:16]


def _encode_transcript(role, protocol, endpoint, client_nonce, server_nonce):
    # 长度前缀拼接，避免 `a|bc` 与 `ab|c` 撞出同一条 transcript（与 TS 侧逐字节一致）。
    domain = "clawclaw_ipc-s" if role == "server" else "clawclaw_ipc-c"
    parts = [domain, str(protocol), endpoint, client_nonce, server_nonce]
    out = b""
    for part in parts:
        buf = part.encode("utf-8")
        out += struct.pack(">I", len(buf)) + buf
    return out


def _proof(ticket, role, protocol, endpoint, client_nonce, server_nonce):
    mac = hmac.new(
        ticket.encode("utf-8"),
        _encode_transcript(role, protocol, endpoint, client_nonce, server_nonce),
        hashlib.sha256,
    ).digest()
    return _b64url(mac)


def _close_quietly(sock):
    try:
        sock.close()
    except OSError:
        pass


class PipeClient(object):
    """一条已绑定的 pipe。`methods` 是**当前可调**的方法名列表。"""

    def __init__(self, client, name, channel, methods):
        self._client = client
        self.name = name
        self.channel = channel
        self.methods = list(methods)

    def invoke(self, method, params=None, timeout=DEFAULT_CALL_TIMEOUT_S):
        return self._client._request(
            "%s/%s" % (self.channel, method), params or {}, mode="call", timeout=timeout
        )


class ClawClawIpcClient(object):
    def __init__(self, sock, endpoint, pipes, connection_epoch, initial_buffer=b""):
        self._sock = sock
        self._endpoint = endpoint
        self.pipes = pipes
        self.connection_epoch = connection_epoch
        self._next_id = 1
        self._lock = threading.Lock()
        self._pending = {}
        self._closed = False
        # 握手期读进来的残留字节必须在读线程**启动前**就位——先 start 再赋值
        # 会跟读线程自己的 recv 写并发竞争，字节流一乱全盘皆输。
        self._buffer = initial_buffer
        self._reader = threading.Thread(target=self._read_loop, name="clawclaw_ipc-reader")
        self._reader.daemon = True
        self._reader.start()

    # ─── 连接生命周期 ───

    def close(self):
        if self._closed:
            return
        self._closed = True
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._sock.close()
        self._fail_all(ClawClawIpcError("E_REVOKED", "connection closed"))

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()
        return False

    # ─── 两个原语 ───

    def list_pipes(self):
        return self._request("broker/ListPipes", {})["pipes"]

    def get_pipe(self, name):
        result = self._request("broker/GetPipe", {"pipe": name})
        return PipeClient(self, name, result["channel"], result.get("methods", []))

    # ─── 内部 ───

    def _send(self, frame):
        # 传输层错误归一成 ClawClawIpcError：调用方按稳定 code 分支，不该看到裸 OSError/errno。
        payload = (json.dumps(frame, ensure_ascii=False) + "\n").encode("utf-8")
        if len(payload) > MAX_FRAME_BYTES:
            # 发出去只会让对端按协议违约断连、所有 in-flight 陪葬——在本地拦下。
            raise ClawClawIpcError(
                "E_BAD_REQUEST",
                "request frame exceeds %d bytes; split the payload" % MAX_FRAME_BYTES,
            )
        try:
            with self._lock:
                self._sock.sendall(payload)
        except OSError as err:
            raise ClawClawIpcError("E_REVOKED", "clawclaw_ipc write failed: %s" % err)

    def _alloc_id(self):
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
        return request_id

    def _request(self, method, params, mode=None, timeout=DEFAULT_CALL_TIMEOUT_S):
        request_id = self._alloc_id()
        if self._closed:
            raise ClawClawIpcError("E_REVOKED", "connection closed")
        event = threading.Event()
        box = {}
        self._pending[request_id] = (event, box)
        frame = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        if mode is not None:
            frame["mode"] = mode
        try:
            self._send(frame)
        except Exception:
            self._pending.pop(request_id, None)
            raise
        finished = event.wait(timeout)
        self._pending.pop(request_id, None)
        if not finished and not box:
            # 本地放弃的同时补发 $/cancel，把服务端的并发槽位也还回去。
            self._cancel_request(request_id)
            raise ClawClawIpcError(
                "E_TIMEOUT", "clawclaw_ipc request timed out after %.1fs: %s" % (timeout, method)
            )
        if "error" in box:
            err = box["error"]
            code = err.get("code", "E_INTERNAL")
            message = err.get("message", "request failed")
            if code == "E_CONSENT_REQUIRED":
                raise ConsentRequired(code, message, err.get("data"))
            raise ClawClawIpcError(code, message, err.get("data"))
        return box.get("result")

    def _cancel_request(self, request_id):
        try:
            self._send({"jsonrpc": "2.0", "method": "$/cancel", "params": {"id": request_id}})
        except ClawClawIpcError:
            pass  # 取消尽力而为；连接要是死了，_fail_all 会收拾一切

    def _fail_all(self, error):
        for request_id, (event, box) in list(self._pending.items()):
            box["error"] = {"code": error.code, "message": error.message}
            event.set()
        self._pending.clear()

    def _read_loop(self):
        # 缺省失败原因：对端正常挂断。协议违约会在下面换成更准确的原因。
        error = ClawClawIpcError("E_REVOKED", "connection closed by host")
        try:
            while not self._closed:
                try:
                    chunk = self._sock.recv(65536)
                except socket.timeout:
                    continue  # I/O 超时只是周期性醒一下，连接还活着
                except OSError:
                    break
                if not chunk:
                    break
                self._buffer += chunk
                while True:
                    nl = self._buffer.find(b"\n")
                    if nl < 0:
                        if len(self._buffer) > MAX_FRAME_BYTES:
                            # 与 TS 侧同一条规则：超限属于协议违约，直接断连。
                            # 清空 buffer 继续读只会把巨帧的后半截当成新帧解析。
                            error = ClawClawIpcError(
                                "E_PROTOCOL_MISMATCH",
                                "frame exceeds %d bytes" % MAX_FRAME_BYTES,
                            )
                            return
                        break
                    line = self._buffer[:nl]
                    self._buffer = self._buffer[nl + 1:]
                    if not line:
                        continue
                    if len(line) > MAX_FRAME_BYTES:
                        error = ClawClawIpcError(
                            "E_PROTOCOL_MISMATCH",
                            "frame exceeds %d bytes" % MAX_FRAME_BYTES,
                        )
                        return
                    try:
                        frame = json.loads(line.decode("utf-8"))
                    except (ValueError, UnicodeDecodeError):
                        error = ClawClawIpcError("E_PROTOCOL_MISMATCH", "malformed json frame")
                        return
                    self._on_frame(frame)
        finally:
            # 无论对端挂断、协议违约还是意外异常，都必须唤醒所有等待者——
            # 读线程无声死掉 = 每个 event.wait() 永久挂起。
            if not self._closed:
                _close_quietly(self._sock)
            self._fail_all(error)

    def _on_frame(self, frame):
        request_id = frame.get("id")
        if request_id is None:
            return
        entry = self._pending.get(request_id)
        if not entry:
            return
        event, box = entry
        if "error" in frame:
            box["error"] = frame["error"]
        else:
            box["result"] = frame.get("result")
        event.set()


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _GENERIC_READ = 0x80000000
    _GENERIC_WRITE = 0x40000000
    _OPEN_EXISTING = 3
    _INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    _kernel32.CreateFileW.restype = wintypes.HANDLE
    _kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    ]
    _kernel32.ReadFile.argtypes = [
        wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
    ]
    _kernel32.ReadFile.restype = wintypes.BOOL
    _kernel32.WriteFile.argtypes = [
        wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
    ]
    _kernel32.WriteFile.restype = wintypes.BOOL
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel32.CloseHandle.restype = wintypes.BOOL
    _kernel32.PeekNamedPipe.argtypes = [
        wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
        wintypes.LPVOID, wintypes.LPVOID, wintypes.LPVOID,
    ]
    _kernel32.PeekNamedPipe.restype = wintypes.BOOL

    _ERROR_PIPE_BUSY = 231
    _ERROR_BROKEN_PIPE = 109
    _ERROR_NO_DATA = 232

    class _NamedPipeSocket(object):
        """命名管道 -> 与 socket 兼容的最小字节流接口。"""

        def __init__(self, handle):
            self._handle = handle
            self._timeout = None
            self._closed = False

        def settimeout(self, value):
            self._timeout = value

        def gettimeout(self):
            return self._timeout

        def _peek_available(self):
            total = wintypes.DWORD(0)
            left = wintypes.DWORD(0)
            ok = _kernel32.PeekNamedPipe(
                self._handle, None, 0, None,
                ctypes.byref(total), ctypes.byref(left),
            )
            if not ok:
                err = ctypes.get_last_error()
                if err in (_ERROR_BROKEN_PIPE, _ERROR_NO_DATA):
                    return -1
                return 0
            if total.value == 0:
                return 0
            return total.value

        def recv(self, bufsize):
            if self._closed:
                raise socket.error("pipe closed")
            import time as _time
            if self._timeout is not None:
                deadline = _time.monotonic() + self._timeout
                while True:
                    avail = self._peek_available()
                    if avail < 0:
                        return b""
                    if avail > 0:
                        break
                    if _time.monotonic() >= deadline:
                        raise socket.timeout("timed out")
                    _time.sleep(0.01)
            else:
                while True:
                    avail = self._peek_available()
                    if avail < 0:
                        return b""
                    if avail > 0:
                        break
                    _time.sleep(0.01)

            n = min(bufsize, avail if avail > 0 else bufsize)
            buf = ctypes.create_string_buffer(n)
            read = wintypes.DWORD(0)
            ok = _kernel32.ReadFile(
                self._handle, buf, n, ctypes.byref(read), None,
            )
            if not ok:
                err = ctypes.get_last_error()
                if err in (_ERROR_BROKEN_PIPE, _ERROR_NO_DATA):
                    return b""
                raise socket.error("read failed: %d" % err)
            if read.value == 0:
                return b""
            return buf.raw[:read.value]

        def sendall(self, data):
            if self._closed:
                raise socket.error("pipe closed")
            view = memoryview(data)
            total = len(view)
            sent = 0
            while sent < total:
                chunk = view[sent:].tobytes()
                written = wintypes.DWORD(0)
                ok = _kernel32.WriteFile(
                    self._handle, chunk, len(chunk),
                    ctypes.byref(written), None,
                )
                if not ok:
                    err = ctypes.get_last_error()
                    if err == _ERROR_BROKEN_PIPE:
                        raise socket.error("broken pipe")
                    raise socket.error("write failed: %d" % err)
                if written.value == 0:
                    raise socket.error("write returned 0 bytes")
                sent += written.value

        def shutdown(self, how):
            pass

        def close(self):
            if not self._closed:
                self._closed = True
                if self._handle:
                    _kernel32.CloseHandle(self._handle)
                    self._handle = None

        def fileno(self):
            raise NotImplementedError("named pipe has no usable fileno")


def _open_endpoint(endpoint):
    if sys.platform == "win32":
        # Windows 宿主端点是命名管道 \\.\pipe\clawclaw_ipc-<id>，不是 AF_UNIX socket，
        # 故用 CreateFileW 打开而非 socket.connect。
        pipe_path = endpoint[len("unix:"):] if endpoint.startswith("unix:") else endpoint
        handle = _kernel32.CreateFileW(
            pipe_path, _GENERIC_READ | _GENERIC_WRITE, 0, None, _OPEN_EXISTING, 0, None)
        if handle == _INVALID_HANDLE_VALUE:
            err = ctypes.get_last_error()
            reason = "busy" if err == _ERROR_PIPE_BUSY else "connect failed"
            raise NotClawClawEnv("clawclaw_ipc named pipe %s (error %d)" % (reason, err))
        sock = _NamedPipeSocket(handle)
        sock.settimeout(HANDSHAKE_TIMEOUT_S)
        return sock

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(HANDSHAKE_TIMEOUT_S)
    try:
        sock.connect(endpoint)
    except (FileNotFoundError, ConnectionRefusedError):
        # socket 文件没了 / 没人在 listen（宿主没跑或已退出）：对调用方等价于
        # "不在 ClawClaw 环境"，允许回落。注意与"连上了但证明不了自己"
        # （EndpointUntrusted，禁止回落）是两回事。
        _close_quietly(sock)
        raise NotClawClawEnv("clawclaw_ipc endpoint is not accepting connections")
    except OSError:
        _close_quietly(sock)
        raise
    return sock


def _read_frame(sock, buffer_box):
    while True:
        nl = buffer_box["buf"].find(b"\n")
        if nl >= 0:
            line = buffer_box["buf"][:nl]
            buffer_box["buf"] = buffer_box["buf"][nl + 1:]
            return json.loads(line.decode("utf-8"))
        chunk = sock.recv(65536)
        if not chunk:
            raise EndpointUntrusted("clawclaw_ipc endpoint closed during handshake")
        buffer_box["buf"] += chunk


def connect(client_id=None, client_kind=None, client_version=None, endpoint=None, ticket=None):
    """握手并返回客户端。

    握手是**双向证明、服务端先自证**：拿不出 server_proof 的对面直接判定端点不可信
    （可能被抢占），抛 EndpointUntrusted 而**不是**悄悄回落——否则抢占就成了逼降级的手段。
    """
    if not (endpoint and ticket):
        path = discovery_path()
        try:
            with open(path, "r", encoding="utf-8") as fh:
                found = json.load(fh)
        except (IOError, OSError):
            # 文件不在 = 没有宿主通道。**唯一**允许回落自己 OAuth 的情况。
            raise NotClawClawEnv()
        except ValueError as exc:
            # 文件在却读不成 JSON：宿主侧坏了，不是"不在 ClawClaw 里"。退化成
            # NotClawClawEnv 会让调用方以为可以回落，把该被看见的故障静默掉。
            raise ClawClawIpcError("E_TICKET_INVALID", "malformed %s: %s" % (path, exc))
        endpoint = endpoint or (found.get("endpoint") or "").strip()
        ticket = ticket or (found.get("ticket") or "").strip()

    if not endpoint or not ticket:
        raise NotClawClawEnv()

    sock = _open_endpoint(endpoint)
    try:
        client_nonce = _b64url(secrets.token_bytes(16))
        hello = {
            "type": "session_hello",
            "protocol_min": PROTOCOL_VERSION,
            "protocol_max": PROTOCOL_VERSION,
            "client_nonce": client_nonce,
            "ticket_id": _ticket_id(ticket),
        }
        if client_id or client_kind or client_version:
            hello["client"] = {"kind": client_kind, "id": client_id, "version": client_version}
        sock.sendall((json.dumps(hello) + "\n").encode("utf-8"))

        box = {"buf": b""}
        challenge = _read_frame(sock, box)
        if challenge.get("type") == "session_hello_error":
            code = challenge.get("code", "rejected")
            raise ClawClawIpcError(
                "E_PROTOCOL_MISMATCH" if code == "protocol_mismatch" else "E_TICKET_INVALID",
                "clawclaw_ipc handshake rejected: %s" % code,
            )
        if challenge.get("type") != "session_challenge":
            raise EndpointUntrusted("unexpected handshake frame: %s" % challenge.get("type"))

        server_nonce = challenge.get("server_nonce") or ""
        expected = _proof(ticket, "server", PROTOCOL_VERSION, endpoint, client_nonce, server_nonce)
        provided = challenge.get("server_proof") or ""
        if not server_nonce or not hmac.compare_digest(expected, provided):
            raise EndpointUntrusted()

        sock.sendall((json.dumps({
            "type": "session_prove",
            "client_proof": _proof(ticket, "client", PROTOCOL_VERSION, endpoint, client_nonce, server_nonce),
        }) + "\n").encode("utf-8"))

        ack = _read_frame(sock, box)
        if ack.get("type") != "session_hello_ack":
            code = ack.get("code", "rejected")
            raise ClawClawIpcError("E_TICKET_INVALID", "clawclaw_ipc handshake rejected: %s" % code)

        # 常驻期用有限的 I/O 超时（而不是 None）：读线程周期性醒来查关闭标志，
        # 阻塞写不会无限持锁挂死其它线程。
        sock.settimeout(SOCKET_IO_TIMEOUT_S)
        # 握手期已读进 buffer 的残留字节经构造函数交给读线程，先于线程启动就位。
        return ClawClawIpcClient(
            sock,
            endpoint,
            ack.get("pipes", []),
            ack.get("connection_epoch", ""),
            initial_buffer=box["buf"],
        )
    except ClawClawIpcError:
        _close_quietly(sock)
        raise
    except socket.timeout:
        _close_quietly(sock)
        raise EndpointUntrusted("clawclaw_ipc handshake timed out")
    except (ValueError, UnicodeDecodeError):
        _close_quietly(sock)
        raise EndpointUntrusted("malformed handshake frame")
    except Exception:
        _close_quietly(sock)
        raise


def http_request(*args, **kwargs):
    from .http import http_request as _impl
    return _impl(*args, **kwargs)


__all__ = [
    "connect",
    "http_request",
    "ClawClawIpcClient",
    "PipeClient",
    "ClawClawIpcError",
    "NotClawClawEnv",
    "EndpointUntrusted",
    "ConsentRequired",
    "PROTOCOL_VERSION",
    "discovery_path",
    "DEFAULT_CALL_TIMEOUT_S",
]
