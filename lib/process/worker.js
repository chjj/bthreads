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
const path = require('path');
const utils = require('../internal/utils');
const encoding = require('../internal/encoding');
const {MessagePort, activate} = require('./common');
const Packet = require('./packet');
const Parser = require('./parser');
const stdio = require('./stdio');
const {types} = Packet;

const {
  extname,
  isAbsolute,
  join,
  resolve,
  sep
} = path;

const {
  custom,
  inspectify,
  setupRefs,
  bindDefault,
  toBuffer,
  decodeError
} = utils;

/*
 * Constants
 */

const children = new Set();

let uid = 1;
let exitBound = false;
let bundled = null;

/**
 * Worker
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

    if (options.execArgv && !Array.isArray(options.execArgv))
      throw new TypeError('"execArgv" must be an array.');

    this._child = null;
    this._parser = new Parser(this);
    this._ports = new Map();
    this._writable = true;
    this._exited = false;
    this._killed = false;
    this._exitCode = -1;
    this._stdioRef = null;
    this._stdioRefs = 0;
    this._stdio = [null, null, null];

    this.threadId = uid;
    this.stdin = null;
    this.stdout = null;
    this.stderr = null;

    uid += 1;
    uid >>>= 0;

    this._init(file, options);
  }

  _init(file, options) {
    const bin = process.execPath || process.argv[0];
    const args = [];

    // Validate filename.
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

    // Setup argument vector.
    // https://github.com/nodejs/node/pull/25467
    if (options.execArgv) {
      const invalid = [];

      // Parse execArgv and look for any irregularities.
      for (let i = 0; i < options.execArgv.length; i++) {
        const arg = options.execArgv[i];

        if (typeof arg !== 'string') {
          invalid.push(arg);
          continue;
        }

        if (isIsolateOption(arg) && !isInvalidOption(arg)) {
          if (isValueOption(arg))
            i += 1;
          continue;
        }

        invalid.push(arg);
      }

      // Throw errors at the end.
      if (invalid.length > 0) {
        const err = new Error('Initiated Worker with '
                            + 'invalid execArgv flags: '
                            + invalid.join(', '));

        err.code = 'ERR_WORKER_INVALID_EXEC_ARGV';

        throw err;
      }

      // Filter out isolate options (we _replace_ them).
      for (let i = 0; i < process.execArgv.length; i++) {
        const arg = process.execArgv[i];

        // Filter out uninheritable options as well.
        if (isIsolateOption(arg) || isInvalidOption(arg)) {
          if (isValueOption(arg))
            i += 1;
          continue;
        }

        args.push(arg);
      }

      // Push on all execArgv options.
      for (const arg of options.execArgv)
        args.push(arg);
    } else {
      // Filter out uninheritable options.
      for (let i = 0; i < process.execArgv.length; i++) {
        const arg = process.execArgv[i];

        if (isInvalidOption(arg)) {
          if (isValueOption(arg))
            i += 1;
          continue;
        }

        args.push(arg);
      }
    }

    // Require bthreads on boot, but make
    // sure we're not bundled or something.
    if (!hasRequireArg(args, __dirname)) {
      if (!isBundled())
        args.push('-r', __dirname);
    }

    // Eval or file?
    if (options.eval) {
      if (isBundled()) {
        const err = new Error('Cannot eval worker code when bundled.');

        err.code = 'ERR_WORKER_BUNDLED_EVAL';

        throw err;
      }

      args.push(join(__dirname, 'eval.js'));
    } else {
      args.push(file);
    }

    // Setup options.
    const opt = {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: Object.assign(Object.create(null), process.env, {
        BTHREADS_WORKER_ID: this.threadId.toString(10),
        BTHREADS_WORKER_DATA: encoding.stringify(options.workerData),
        BTHREADS_WORKER_STDIN: options.stdin ? '1' : '0',
        BTHREADS_WORKER_EVAL: options.eval ? '1' : '0'
      })
    };

    // Spawn child process.
    this._child = cp.spawn(bin, args, opt);
    this._stdioRef = this._child.stdout;

    children.add(this);
    bindExit();

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
      // Node v8.0.0 emits this sometimes.
      if (err.message === 'This socket is closed')
        return;

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

    if (options.eval)
      this.postMessage(file);
  }

  _handleMessage(pkt) {
    if (this._exited)
      return;

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
        this.emit('error', decodeError(pkt.value));
        this._kill(1);
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
    // Child was terminated with signal handler.
    if (code === 143 && signal == null) {
      // Convert to SIGTERM signal.
      code = null;
      signal = 'SIGTERM';
    }

    if (signal === 'SIGTERM') {
      // We probably killed it.
      if (this._exitCode !== -1)
        code = this._exitCode;
    }

    children.delete(this);

    this._exited = true;

    for (const port of this._ports.values())
      port.close();

    if (!this.stdout._readableState.ended)
      this.stdout.push(null);

    if (!this.stderr._readableState.ended)
      this.stderr.push(null);

    this.threadId = -1;

    this.emit('exit', code >>> 0);
    this.removeAllListeners();
  }

  _send(pkt) {
    if (this._exited)
      return;

    if (this._writable)
      this._child.stdin.write(pkt.encode());
  }

  _attach(id) {
    if (id === 0)
      throw new Error('Invalid port ID.');

    const port = new MessagePort();

    port._id = id;

    if (this._ports.has(id)) {
      const remote = this._ports.get(id);

      remote._active = false;
      remote._parent = null;
      remote._port = port;

      port._port = remote;

      this._ports.delete(id);

      return port;
    }

    port._parent = this;
    port._active = true;

    this._ports.set(port._id, port);

    return port;
  }

  postMessage(value, transferList) {
    // Note: throws in node.js.
    if (this._exited)
      return;

    activate(transferList, this);

    this._send(new Packet(types.MESSAGE, 0, value));
  }

  ref() {
    if (!this._exited)
      this._child.ref();
  }

  _kill(code) {
    if (this._killed)
      return;

    this._child.kill('SIGTERM');
    this._exitCode = code >>> 0;
    this._exited = true;
    this._killed = true;
  }

  _terminate(code) {
    if (this._exited)
      return;

    if (!this._writable) {
      this._kill(code);
      return;
    }

    this._send(new Packet(types.EXIT, 0, code >>> 0));
    this._exited = true;
  }

  terminate(callback) {
    if (this._exited)
      return;

    if (typeof callback === 'function')
      this.once('exit', code => callback(null, code));

    this._terminate(1);
  }

  unref() {
    if (!this._exited)
      this._child.unref();
  }

  [custom]() {
    return inspectify(Worker, {
      active: !this._exited,
      threadId: this.threadId,
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr
    });
  }
}

/*
 * Helpers
 */

function isBundled() {
  if (bundled != null)
    return bundled;

  // This is probably overkill.
  const path = resolve(__dirname, '../../lib/process/worker.js');

  if (resolve(__filename, '.') === path) {
    try {
      if (fs.statSync(path).isFile())
        bundled = false;
    } catch (e) {
      if (e.code === 'EPERM'
          || e.code === 'ENFILE'
          || e.code === 'EMFILE') {
        throw e;
      }
      bundled = true;
    }
  } else {
    bundled = true;
  }

  return bundled;
}

function hasRequireArg(argv, filename) {
  const i = argv.indexOf(filename);
  return i > 0 && argv[i - 1] === '-r';
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

function killChildren() {
  for (const child of children)
    child._kill();
}

function handleError(err) {
  if (err && err.stack)
    console.error(String(err.stack));
  else
    console.error(String(err));

  process.exit(1);
}

function bindExit() {
  if (exitBound)
    return;

  exitBound = true;

  // Cleanup children on exit.
  process.once('exit', killChildren);

  // Setup new behavior to trigger the exit event.
  bindDefault(process, 'SIGHUP', () => process.exit(1 | 0x80));
  bindDefault(process, 'SIGINT', () => process.exit(2 | 0x80));
  bindDefault(process, 'SIGTERM', () => process.exit(15 | 0x80));
  bindDefault(process, 'uncaughtException', handleError);
  bindDefault(process, 'unhandledRejection', handleError);
}

/*
 * Options
 * https://github.com/nodejs/node/blob/master/src/node_options.cc
 * Last update: b2abda9ba0b7b8bfbbf14e990ea86434f3f20de3
 */

const isolateOptions = new Set([
  // Debug Options
  '--debug',
  '--debug-port',
  '--debug-brk',
  '--inspect',
  '--inspect-port',
  '--inspect-brk',
  '--inspect-brk-node',

  // Environment Options
  '--experimental-modules',
  '--experimental-policy',
  '--experimental-repl-await',
  '--experimental-vm-modules',
  '--experimental-worker',
  '--experimental-report',
  '--expose-internals',
  '--frozen-intrinsics',
  '--http-parser',
  '--loader',
  '--no-deprecation',
  '--no-force-async-hooks-checks',
  '--no-warnings',
  '--pending-deprecation',
  '--prof-process',
  '--redirect-warnings',
  '--throw-deprecation',
  '--trace-deprecation',
  '--trace-sync-io',
  '--trace-warnings',
  '-c', '--check',
  '-e', '--eval',
  '-p', '--print',
  '-r', '--require',
  '-i', '--interactive',
  '--napi-modules',
  '--tls-v1.0',
  '--tls-v1.1',

  // Per Isolate Options
  '--track-heap-objects',
  '--abort-on-uncaught-exception',
  '--max-old-space-size',
  '--perf-basic-prof',
  '--perf-basic-prof-only-functions',
  '--perf-prof',
  '--perf-prof-unwinding-info',
  '--stack-trace-limit',
  '--diagnostic-report-uncaught-exception',
  '--diagnostic-report-on-signal',
  '--diagnostic-report-on-fatalerror',
  '--diagnostic-report-signal',
  '--diagnostic-report-filename',
  '--diagnostic-report-directory',
  '--diagnostic-report-verbose'

  // Per Process Options
  // '--title',
  // '--trace-event-categories',
  // '--trace-event-file-pattern',
  // '--trace-events-enabled',
  // '--trace-event-categories',
  // '--max-http-header-size',
  // '--v8-pool-size',
  // '--zero-fill-buffers',
  // '--debug-arraybuffer-allocations',
  // '--security-reverts',
  // '--completion-bash',
  // '-h', '--help',
  // '-v', '--version',
  // '--v8-options',
  // '--icu-data-dir',
  // '--openssl-config',
  // '--tls-cipher-list',
  // '--use-openssl-ca',
  // '--use-bundled-ca',
  // '--enable-fips',
  // '--force-fips'
]);

const invalidOptions = new Set([
  // Debug Options
  '--debug',
  '--debug-port',
  '--debug-brk',
  '--inspect',
  '--inspect-port',
  '--inspect-brk',
  '--inspect-brk-node',

  // Environment Options
  '--prof-process',
  '-c', '--check',
  '-e', '--eval',
  '-p', '--print',
  '-i', '--interactive',

  // Per Process Options
  '--title',
  '--completion-bash',
  '-h', '--help',
  '-v', '--version',
  '--v8-options'
]);

// At some point in the future, --frozen-intrinsics
// may disallow us from hooking into the console.
// This is bad for our worker process since it
// communicates through stdout. We don't want anyone
// mistakenly console.logging and screwing up our
// makeshift IPC channel. See:
// https://github.com/nodejs/node/pull/25685#issuecomment-457564897
invalidOptions.add('--frozen-intrinsics');

const valueOptions = new Set([
  // Debug Options (some have optional values)
  // '--debug',
  '--debug-port',
  // '--debug-brk',
  // '--inspect',
  '--inspect-port',
  // '--inspect-brk',
  // '--inspect-brk-node',

  // Environment Options
  '--experimental-policy',
  '--http-parser',
  '--loader',
  '--redirect-warnings',
  '-e', '--eval',
  '-p', '--print',
  '-r', '--require',

  // Per Isolate Options
  '--max-old-space-size',
  '--stack-trace-limit',
  '--diagnostic-report-signal',
  '--diagnostic-report-filename',
  '--diagnostic-report-directory',

  // Per Process Options
  '--title',
  '--trace-event-categories',
  '--trace-event-file-pattern',
  '--max-http-header-size',
  '--v8-pool-size',
  '--icu-data-dir',
  '--openssl-config',
  '--tls-cipher-list'
]);

function hasOption(options, arg, slice) {
  if (typeof arg !== 'string')
    return false;

  if (arg.length === 0)
    return false;

  if (arg[0] !== '-')
    return false;

  if (arg.startsWith('-_'))
    return false;

  if (arg === '-' || arg === '--')
    return false;

  if (arg.startsWith('--')) {
    const index = arg.indexOf('=');

    if (index !== -1) {
      if (!slice)
        return false;

      arg = arg.substring(0, index);
    }
  }

  arg = arg.replace(/_/g, '-');

  return options.has(arg);
}

function isIsolateOption(arg) {
  return hasOption(isolateOptions, arg, true);
}

function isInvalidOption(arg) {
  return hasOption(invalidOptions, arg, true);
}

function isValueOption(arg) {
  return hasOption(valueOptions, arg, false);
}

/*
 * Expose
 */

module.exports = Worker;
