/*!
 * worker.js - worker object for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/worker_threads.html#worker_threads_class_worker
 */

'use strict';

const cp = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {setupRefs, toBuffer} = require('../internal/utils');
const encoding = require('../internal/encoding');
const {MessagePort, activate} = require('./common');
const Packet = require('./packet');
const Parser = require('./parser');
const stdio = require('./stdio');
const {types} = Packet;

const {
  basename,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep
} = path;

/*
 * Constants
 */

const tail = normalize('/lib/process/worker.js');
const fullPath = join(resolve(__dirname, '..', '..'), tail);
const children = new Set();

let uid = 1;
let exitBound = false;
let existsCheck = null;

/**
 * Worker
 * @extends EventEmitter
 */

class Worker extends EventEmitter {
  constructor(file, options) {
    super();

    if (options == null)
      options = Object.create(null);

    if (typeof file !== 'string')
      throw new TypeError('"file" must be a string.');

    if (typeof options !== 'object')
      throw new TypeError('"options" must be an object.');

    this._id = uid;
    this._eval = null;
    this._child = null;
    this._parser = new Parser(this);
    this._ports = new Map();
    this._writable = true;
    this._exited = false;
    this._exitCode = -1;
    this._stdioRef = null;
    this._stdioRefs = 0;
    this._stdio = [null, null, null];

    this.stdin = null;
    this.stdout = null;
    this.stderr = null;

    uid += 1;
    uid >>>= 0;

    children.add(this);

    bindExit();

    this._init(file, options);
  }

  get onmessage() {
    const listeners = this.listeners('message');

    if (listeners.length === 0)
      return null;

    return listeners[0];
  }

  set onmessage(func) {
    this.removeAllListeners('message');
    if (typeof func === 'function')
      this.addListener('message', func);
  }

  _init(file, options) {
    const bin = process.execPath || process.argv[0];
    const args = (process.execArgv || []).slice();

    if (!options.eval) {
      if (!isAbsolute(file)
          && !file.startsWith('./')
          && !file.startsWith('../')
          && !file.startsWith('.' + sep)
          && !file.startsWith('..' + sep)) {
        const err = new TypeError('The worker script filename '
                                + `must be a path. Received "${file}".`);

        err.code = 'ERR_WORKER_PATH';

        throw err;
      }

      file = resolve(file);

      const ext = extname(file);

      if (ext !== '.js' && ext !== '.mjs') {
        const err = new TypeError('The worker script extension '
                                + 'must be ".js" or ".mjs". '
                                + `Received "${ext}".`);

        err.code = 'ERR_WORKER_UNSUPPORTED_EXTENSION';

        throw err;
      }
    }

    if (!process.env.BTHREADS_WORKER_ID) {
      // Require bthreads on boot, but make
      // sure we're not bundled or something.
      if (__filename.endsWith(tail)) {
        if (existsCheck == null) {
          try {
            existsCheck = fs.statSync(fullPath).isFile();
          } catch (e) {
            existsCheck = false;
          }
        }

        if (existsCheck)
          args.push('-r', __dirname);
      }
    }

    if (options.eval) {
      const filename = tmpFile(this._id);
      const code = evalScript('[worker eval]', file);
      const options = { mode: 0o600, flag: 'wx' };

      fs.writeFileSync(filename, code, options);

      this._eval = filename;

      args.push(filename);
    } else {
      args.push(file);
    }

    const opt = {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: Object.assign({}, process.env, {
        BTHREADS_WORKER_ID: this._id.toString(10),
        BTHREADS_WORKER_DATA: encoding.stringify(options.workerData),
        BTHREADS_WORKER_STDIN: options.stdin ? '1' : '0',
        BTHREADS_WORKER_EVAL: options.eval ? '1' : '0'
      })
    };

    this._child = cp.spawn(bin, args, opt);
    this._stdioRef = this._child.stdout;

    this._child.unref();
    this._child.stdin.unref();
    this._child.stdout.unref();

    this._child.on('error', (err) => {
      this.emit('error', err);
    });

    this._child.once('exit', (code, signal) => {
      this._handleExit(code, signal);
    });

    // Event order for a child suddenly exiting.
    //
    // Node v8.0.0:
    // 1. stdout end
    // 2. stdin error (ECONNRESET)
    // 3. stdin close
    // 4. child exit
    //
    // Node v11.x.x (fixed with setImmediate wrapper):
    // 1. stdin error (EPIPE)
    // 2. stdout end
    // 3. child exit
    // 4. stdin close
    let ended = false;

    this._child.stdin.on('error', (err) => {
      if (err.code === 'EPIPE'
          || err.code === 'ECONNRESET') {
        setImmediate(() => {
          if (!ended)
            this.emit('error', err);
        });
      } else {
        this.emit('error', err);
      }
    });

    this._child.stdin.on('close', () => {
      this._writable = false;
    });

    this._child.stdout.on('error', (err) => {
      this.emit('error', err);
    });

    this._child.stdout.on('end', () => {
      ended = true;
    });

    this._child.stdout.on('data', (data) => {
      try {
        this._parser.feed(data);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this._parser.on('error', (err) => {
      this.emit('error', err);
    });

    this._parser.on('packet', (pkt) => {
      try {
        this._handleMessage(pkt);
      } catch (e) {
        this.emit('error', e);
      }
    });

    setupRefs(this._child, this, 'message');

    let stdin = null;

    if (options.stdin)
      stdin = new stdio.Writable(this, 0);

    const stdout = new stdio.Readable(this, 1);
    const stderr = new stdio.Readable(this, 2);

    if (!options.stdout) {
      stdout.increments = false;
      pipeWithoutWarning(stdout, process.stdout);
    }

    if (!options.stderr) {
      stderr.increments = false;
      pipeWithoutWarning(stderr, process.stderr);
    }

    this._stdio[0] = stdin;
    this._stdio[1] = stdout;
    this._stdio[2] = stderr;

    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
  }

  _handleMessage(pkt) {
    const port = this._ports.get(pkt.port);

    if (port) {
      port._handleMessage(pkt);
      return;
    }

    if (pkt.port !== 0)
      return;

    switch (pkt.type) {
      case types.MESSAGE: {
        this.emit('message', pkt.value);
        break;
      }

      case types.STDIO_READ: {
        const stream = this._stdio[pkt.value];

        if (stream)
          stream._moreData();

        break;
      }

      case types.STDIO_WRITE: {
        const [fd, data, enc] = pkt.value;
        const stream = this._stdio[fd];

        if (stream)
          stream.push(toBuffer(data), enc);

        break;
      }

      case types.ERROR: {
        this.emit('error', pkt.value);
        this._terminate(1);
        break;
      }

      case types.OPEN: {
        this.emit('online');
        break;
      }

      default: {
        throw new Error(`Parent received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _handleExit(code, signal) {
    children.delete(this);

    this._cleanup();
    this._exited = true;

    if (this._exitCode !== -1)
      code = this._exitCode;

    for (const port of this._ports.values())
      port.close();

    if (!this.stdout._readableState.ended)
      this.stdout.push(null);

    if (!this.stderr._readableState.ended)
      this.stderr.push(null);

    this.emit('exit', code >>> 0);
    this.removeAllListeners();
  }

  _cleanup() {
    if (this._eval) {
      try {
        fs.unlinkSync(this._eval);
      } catch (e) {
        this.emit('error', e);
      }
      this._eval = null;
    }
  }

  _send(pkt) {
    if (this._exited)
      return this;

    if (this._writable)
      this._child.stdin.write(pkt.encode());

    return this;
  }

  _attach(id) {
    const port = new MessagePort();

    port._id = id;
    port._parent = this;
    port._active = true;

    if (port._id === 0)
      throw new Error('Message port ID collision.');

    this._ports.set(port._id, port);

    return port;
  }

  postMessage(value, transferList) {
    if (this._exited)
      throw new Error('Worker is terminated.');

    activate(transferList, this);

    return this._send(new Packet(types.MESSAGE, 0, value));
  }

  ref() {
    this._child.ref();
    return this;
  }

  _terminate(code) {
    if (this._exited)
      return;

    this._child.kill('SIGTERM');
    this._exitCode = code >>> 0;
    this._exited = true;
  }

  terminate(callback) {
    if (this._exited)
      throw new Error('Worker is terminated.');

    if (typeof callback === 'function')
      this.once('exit', code => callback(null, code));

    this._terminate(1);

    return this;
  }

  unref() {
    this._child.unref();
    return this;
  }
}

/*
 * Helpers
 */

function tmpFile(id) {
  const x = (Math.random() * 0x100000000) >>> 0;
  const y = (Math.random() * 0x100000000) >>> 0;
  const z = x.toString(32) + y.toString(32);
  const name = `worker-${process.pid}-${id}-${z}.js`;

  return resolve(os.tmpdir(), name);
}

function evalScript(name, body) {
  const cwd = process.cwd();
  const file = join(cwd, name);
  const paths = [];

  let dir = cwd;

  for (;;) {
    if (basename(dir) !== 'node_modules')
      paths.push(join(dir, 'node_modules'));

    const next = resolve(dir, '..');

    if (next === dir)
      break;

    dir = next;
  }

  // See: internal/bootstrap/node.js
  return ''
    + '__dirname = ".";'
    + `__filename = ${JSON.stringify(name)};`
    + `module.id = ${JSON.stringify(name)};`
    + `module.filename = ${JSON.stringify(file)};`
    + 'module.paths.length = 0;'
    + `module.paths.push(...${JSON.stringify(paths)});`
    + 'require.main = null;'
    + 'global.__dirname = __dirname;'
    + 'global.__filename = __filename;'
    + 'global.exports = exports;'
    + 'global.module = module;'
    + 'global.require = require;'
    + 'return require("vm").runInThisContext('
    + `${JSON.stringify(body)}, { filename: `
    + `${JSON.stringify(name)}, displayErrors: true });`;
}

function pipeWithoutWarning(source, dest) {
  const sourceMaxListeners = source._maxListeners;
  const destMaxListeners = dest._maxListeners;

  source.setMaxListeners(Infinity);
  dest.setMaxListeners(Infinity);

  try {
    source.pipe(dest);
  } finally {
    source._maxListeners = sourceMaxListeners;
    dest._maxListeners = destMaxListeners;
  }
}

function bindExit() {
  if (exitBound)
    return;

  exitBound = true;

  listenExit(() => {
    for (const child of children)
      child._terminate();
  });
}

function listenExit(handler) {
  const onSighup = () => {
    process.exit(1 | 0x80);
  };

  const onSigint = () => {
    process.exit(2 | 0x80);
  };

  const onSigterm = () => {
    process.exit(15 | 0x80);
  };

  const onError = (err) => {
    if (err && err.stack)
      console.error(String(err.stack));
    else
      console.error(String(err));

    process.exit(1);
  };

  process.once('exit', handler);

  if (process.listenerCount('SIGHUP') === 0)
    process.once('SIGHUP', onSighup);

  if (process.listenerCount('SIGINT') === 0)
    process.once('SIGINT', onSigint);

  if (process.listenerCount('SIGTERM') === 0)
    process.once('SIGTERM', onSigterm);

  if (process.listenerCount('uncaughtException') === 0)
    process.once('uncaughtException', onError);

  if (process.listenerCount('unhandledRejection') === 0)
    process.once('unhandledRejection', onError);

  process.on('newListener', (name) => {
    switch (name) {
      case 'SIGHUP':
        process.removeListener(name, onSighup);
        break;
      case 'SIGINT':
        process.removeListener(name, onSigint);
        break;
      case 'SIGTERM':
        process.removeListener(name, onSigterm);
        break;
      case 'uncaughtException':
        process.removeListener(name, onError);
        break;
      case 'unhandledRejection':
        process.removeListener(name, onError);
        break;
    }
  });
}

/*
 * Expose
 */

module.exports = Worker;
