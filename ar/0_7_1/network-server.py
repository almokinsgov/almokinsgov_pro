#!/usr/bin/env python3
"""Small LAN HTTP/HTTPS server for GIS AR Viewer development and phone testing."""

from __future__ import annotations

import argparse
import functools
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import socket
import ssl
import sys
import threading
from urllib.parse import urlsplit
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.7.1"


def discover_ipv4_addresses() -> list[str]:
    """Return likely usable LAN IPv4 addresses, best candidates first."""
    candidates: list[str] = []

    # The UDP connect asks the OS which interface it would route through. No
    # application data is sent and failure is harmless on an offline machine.
    for target in (("8.8.8.8", 80), ("1.1.1.1", 80)):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(target)
            candidates.append(sock.getsockname()[0])
            break
        except OSError:
            pass
        finally:
            sock.close()

    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_STREAM):
            candidates.append(info[4][0])
    except OSError:
        pass

    try:
        _host, _aliases, addresses = socket.gethostbyname_ex(socket.gethostname())
        candidates.extend(addresses)
    except OSError:
        pass

    clean: list[str] = []
    for value in candidates:
        try:
            ip = ipaddress.ip_address(value)
        except ValueError:
            continue
        if ip.version != 4 or ip.is_loopback or ip.is_link_local or ip.is_unspecified:
            continue
        text = str(ip)
        if text not in clean:
            clean.append(text)

    def rank(value: str) -> tuple[int, str]:
        ip = ipaddress.ip_address(value)
        # Prefer normal private LAN ranges before VPN/public interface values.
        if ip.is_private:
            if value.startswith("192.168."):
                return (0, value)
            if value.startswith("10."):
                return (1, value)
            if value.startswith("172."):
                return (2, value)
            return (3, value)
        return (4, value)

    return sorted(clean, key=rank)


def choose_ip(explicit: str | None = None) -> str:
    if explicit:
        return explicit.strip()
    addresses = discover_ipv4_addresses()
    return addresses[0] if addresses else "127.0.0.1"


class DevHandler(SimpleHTTPRequestHandler):
    server_version = f"GISARViewer/{VERSION}"

    def _sensitive_path(self) -> bool:
        name = PurePosixPath(urlsplit(self.path).path).name.lower()
        return (
            name.endswith((".key", ".p12", ".pfx"))
            or "key.pem" in name
            or name == "rootca-key.pem"
        )

    def do_GET(self) -> None:
        if self._sensitive_path():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self._sensitive_path():
            self.send_error(404)
            return
        super().do_HEAD()

    def end_headers(self) -> None:
        # Development-friendly headers. ArcGIS requests are still made by the
        # browser directly to their original service URLs.
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Permissions-Policy", "geolocation=(self), camera=(self)")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))
        sys.stdout.flush()


class CertificateBootstrapHandler(DevHandler):
    _allowed = {"/certs/rootca.crt", "/certs/rootca.pem"}

    def _allowed_path(self) -> bool:
        return urlsplit(self.path).path.lower() in self._allowed

    def do_GET(self) -> None:
        if not self._allowed_path():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if not self._allowed_path():
            self.send_error(404)
            return
        super().do_HEAD()


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def make_server(root: Path, bind: str, port: int, *, cert: Path | None = None, key: Path | None = None, bootstrap: bool = False) -> ReusableThreadingHTTPServer:
    handler_class = CertificateBootstrapHandler if bootstrap else DevHandler
    handler = functools.partial(handler_class, directory=str(root))
    server = ReusableThreadingHTTPServer((bind, port), handler)
    if cert and key:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certfile=str(cert), keyfile=str(key))
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def print_urls(scheme: str, port: int, display_ip: str, addresses: list[str]) -> None:
    print(f"\n{scheme.upper()} phone URL")
    print(f"  {scheme}://{display_ip}:{port}/")
    extras = [ip for ip in addresses if ip != display_ip]
    if extras:
        print("\nOther detected network addresses")
        for ip in extras:
            print(f"  {scheme}://{ip}:{port}/")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve GIS AR Viewer to devices on the local network.")
    parser.add_argument("--port", type=int, default=8080, help="Port for the main server. Default: 8080")
    parser.add_argument("--bind", default="0.0.0.0", help="Bind address. Default: 0.0.0.0")
    parser.add_argument("--display-ip", help="IP address to print for phone access when multiple adapters exist.")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent), help="Directory to serve.")
    parser.add_argument("--https", action="store_true", help="Serve the main app using HTTPS.")
    parser.add_argument("--cert", default="certs/lan-cert.pem", help="HTTPS certificate path relative to --root.")
    parser.add_argument("--key", default="certs/lan-key.pem", help="HTTPS key path relative to --root.")
    parser.add_argument("--bootstrap-port", type=int, default=0, help="Optional HTTP port to run alongside HTTPS for root CA download.")
    parser.add_argument("--print-ip", action="store_true", help="Print the selected LAN IPv4 address and exit.")
    parser.add_argument("--list-ips", action="store_true", help="Print detected LAN IPv4 addresses as JSON and exit.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    addresses = discover_ipv4_addresses()
    display_ip = choose_ip(args.display_ip)

    if args.print_ip:
        print(display_ip)
        return 0
    if args.list_ips:
        print(json.dumps(addresses))
        return 0

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"Server root does not exist: {root}", file=sys.stderr)
        return 2

    cert: Path | None = None
    key: Path | None = None
    scheme = "http"
    if args.https:
        scheme = "https"
        cert = Path(args.cert)
        key = Path(args.key)
        if not cert.is_absolute():
            cert = root / cert
        if not key.is_absolute():
            key = root / key
        if not cert.exists() or not key.exists():
            print("HTTPS certificate files were not found.", file=sys.stderr)
            print(f"Expected certificate: {cert}", file=sys.stderr)
            print(f"Expected key:         {key}", file=sys.stderr)
            print("Run setup-network-https.bat first.", file=sys.stderr)
            return 3

    print(f"GIS AR Viewer network server v{VERSION}")
    print(f"Serving directory: {root}")
    print(f"Listening on: {args.bind}:{args.port}")
    print_urls(scheme, args.port, display_ip, addresses)

    main_server = make_server(root, args.bind, args.port, cert=cert, key=key)
    bootstrap_server = None
    bootstrap_thread = None

    if args.https and args.bootstrap_port:
        bootstrap_server = make_server(root, args.bind, args.bootstrap_port, bootstrap=True)
        bootstrap_thread = threading.Thread(target=bootstrap_server.serve_forever, name="http-bootstrap", daemon=True)
        bootstrap_thread.start()
        print("\nCertificate bootstrap URL")
        print(f"  http://{display_ip}:{args.bootstrap_port}/certs/rootCA.crt")
        print("Use this only to copy your local development CA certificate to your own phone.")

    print("\nKeep this window open while using the app on your phone.")
    print("The phone and PC should be on the same local network.")
    print("Press Ctrl+C to stop.\n")

    try:
        main_server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        main_server.shutdown()
        main_server.server_close()
        if bootstrap_server:
            bootstrap_server.shutdown()
            bootstrap_server.server_close()
        if bootstrap_thread:
            bootstrap_thread.join(timeout=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
