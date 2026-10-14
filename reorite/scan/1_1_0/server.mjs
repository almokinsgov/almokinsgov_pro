import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.txt', 'text/plain; charset=utf-8'],
  ['.zip', 'application/zip'],
  ['.wasm', 'application/wasm'], ['.traineddata', 'application/octet-stream'], ['.gz', 'application/gzip'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'], ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
  ['.wav', 'audio/wav'], ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg']
]);
const reservedDirectories = /^(?:references|docs|script|scripts|archive|backup|backups|node_modules)$/i;
const sensitiveNames = /(?:credentials|secret|private[_-]?key|api[_-]?keys?|aws[_-]?keys?)/i;

function respond(response, status, message, method = 'GET') {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(method === 'HEAD' ? undefined : `${message}\n`);
}

function parseRequestPath(rawUrl) {
  // Inspect the raw request target before URL normalization can hide traversal.
  if (!rawUrl || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) return { status: 400 };
  const rawPath = rawUrl.split('?')[0];
  let pathname;
  try { pathname = decodeURIComponent(rawPath); } catch { return { status: 400 }; }
  if (/[\u0000-\u001f\u007f\\#]/.test(pathname)) return { status: 400 };
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || part.startsWith('.') ||
    part.includes(':') || reservedDirectories.test(part) || sensitiveNames.test(part))) {
    return { status: 403 };
  }
  return { pathname, parts };
}

async function resolvePublicFile(baseDir, parts) {
  const base = path.resolve(baseDir);
  const baseStat = await lstat(base);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) return { status: 403 };
  // A link above a custom public root is also an escape route, even when the root itself is a regular directory.
  for (let ancestor = path.dirname(base); ; ancestor = path.dirname(ancestor)) {
    if ((await lstat(ancestor)).isSymbolicLink()) return { status: 403 };
    if (path.dirname(ancestor) === ancestor) break;
  }
  const canonicalBase = await realpath(base);
  let current = base;
  // Check every component, including junctions on Windows, so links never expose other files.
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) return { status: 403 };
    if (index < parts.length - 1 && !entry.isDirectory()) return { status: 404 };
  }
  const canonicalFile = await realpath(current);
  const relative = path.relative(canonicalBase, canonicalFile);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    return { status: 403 };
  }
  const stat = await lstat(current);
  if (!stat.isFile()) return { status: 404 };
  const mimeType = mimeTypes.get(path.extname(current).toLowerCase());
  if (!mimeType) return { status: 403 };
  return { filename: current, stat, mimeType };
}

export function createAppServer({
  rootDir = projectRoot,
  lexiconsDir = null, tls
} = {}) {
  const handler = async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      respond(response, 405, 'Method not allowed', method);
      return;
    }
    const parsed = parseRequestPath(request.url);
    if (parsed.status) {
      respond(response, parsed.status, parsed.status === 400 ? 'Invalid path' : 'Forbidden', method);
      return;
    }
    if (parsed.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    let parts = parsed.parts;
    let base = rootDir;
    if (parts[0] === 'Lexicons' && lexiconsDir) {
      base = lexiconsDir;
      parts = parts.slice(1);
    } else if (parts.length === 0 || parsed.pathname.endsWith('/')) {
      parts = [...parts, 'index.html'];
    }
    try {
      const file = await resolvePublicFile(base, parts);
      if (file.status) {
        respond(response, file.status, file.status === 403 ? 'Forbidden' : 'Not found', method);
        return;
      }
      response.writeHead(200, {
        'Content-Type': file.mimeType,
        'Content-Length': file.stat.size
      });
      if (method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(file.filename);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      const missing = ['ENOENT', 'ENOTDIR'].includes(error.code);
      respond(response, missing ? 404 : 500, missing ? 'Not found' : 'Unable to read asset', method);
    }
  };
  return tls ? https.createServer(tls, handler) : http.createServer(handler);
}

export async function startServer({ host = '127.0.0.1', port = 5534, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const server = createAppServer(options);
  await new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  const actualPort = server.address().port;
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return { server, host, port: actualPort, url: `${options.tls?'https':'http'}://${urlHost}:${actualPort}` };
}

function cliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--port', '--host', '--root', '--cert', '--key'].includes(arg) || !args[index + 1]) throw new Error(`Unknown or incomplete option: ${arg}`);
    const value = args[++index];
    if (arg === '--port') {
      if (!/^\d+$/.test(value)) throw new Error('Port must be an integer from 0 to 65535.');
      options.port = Number(value);
    } else if(arg==='--host') options.host = value;
    else if(arg==='--root'){options.rootDir=path.resolve(value);options.lexiconsDir=null;}
    else options[arg.slice(2)]=path.resolve(value);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = cliOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node server.mjs [--port 5534] [--host 127.0.0.1] [--root directory] [--cert certificate.pem --key private-key.pem]');
    else {
      if(!!options.cert!==!!options.key)throw new Error('Provide both --cert and --key for HTTPS.');
      if(options.cert){options.tls={cert:await readFile(options.cert),key:await readFile(options.key)};delete options.cert;delete options.key;}
      const { server, url } = await startServer(options);
      console.log(`ReoRite Scan 1.1.0: ${url}`);
      if(options.host==='0.0.0.0' || options.host==='::'){
        const protocol=options.tls?'https':'http';console.log(`This computer: ${protocol}://localhost:${server.address().port}/`);
        for(const records of Object.values(networkInterfaces()))for(const record of records||[])if(!record.internal && record.family==='IPv4')console.log(`Network: ${protocol}://${record.address}:${server.address().port}/`);
        if(!options.tls)console.log('Live camera and Polly signing need HTTPS on other devices. Use image import and available device voices over HTTP; phone Take photo depends on browser support.');
      }
      console.log('Press Ctrl+C to stop.');
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
    }
  } catch (error) {
    console.error(`Cannot start ReoRite Scan 1.1.0: ${error.message}`);
    process.exitCode = 1;
  }
}
