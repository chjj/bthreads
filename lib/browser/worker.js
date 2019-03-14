/*!
 * worker.js - worker object for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/worker_threads.html#worker_threads_class_worker
 *   https://developer.mozilla.org/en-US/docs/Web/API/AbstractWorker
 *   https://developer.mozilla.org/en-US/docs/Web/API/Worker
 *   https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
 *   https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
 */

/* global register */

'use strict';

const {EventEmitter} = require('events');
const EventProxy = require('../internal/proxy');
const utils = require('../internal/utils');
const encoding = require('../internal/encoding');
const backend = require('./backend');
const common = require('./common');
const env = require('./env');
const stdio = require('./stdio');

const {
  errors,
  custom,
  inspectify,
  toBuffer,
  decodeError,
  ArgError,
  WorkerError
} = utils;

const {
  Packet,
  types,
  errorify
} = common;

/*
 * Constants
 */

const DEFAULT_BOOTSTRAP_URL =
  'https://unpkg.com/bthreads-bundle@0.4.0/index.js';

const BOOTSTRAP_URL = env.WORKER_BOOTSTRAP || DEFAULT_BOOTSTRAP_URL;

let uid = 1;

/**
 * Worker
 */

class Worker extends EventEmitter {
  constructor(file, options) {
    super();

    if (options == null)
      options = {};

    if (typeof file !== 'string')
      throw new ArgError('file', file, 'string');

    if (typeof options !== 'object')
      throw new ArgError('options', options, 'object');

    if (options.type != null && typeof options.type !== 'string')
      throw new ArgError('type', options.type, 'string');

    if (options.credentials != null && typeof options.credentials !== 'string')
      throw new ArgError('credentials', options.credentials, 'string');

    if (options.bootstrap != null && typeof options.bootstrap !== 'string')
      throw new ArgError('bootstrap', options.bootstrap, 'string');

    this._worker = null;
    this._proxy = null;
    this._exited = false;
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
    let url = file;
    let code = null;
    let type = options.type;

    if (options.eval) {
      if (type === 'module')
        throw new WorkerError(errors.ES_MODULE, 'eval');

      url = options.bootstrap || BOOTSTRAP_URL;
      code = file;
      file = url;
    }

    if (type == null)
      type = scriptType(file);

    if (isURL(file)) {
      if (!isSameOrigin(file))
        url = createWorkerURL(file, type);
    } else if (process.env.BMOCHA) {
      register(file, [__dirname, file]);
    }

    this._worker = new backend.Worker(url, {
      type: type,
      credentials: options.credentials || undefined,
      name: encoding.stringify([
        this.threadId,
        options.workerData,
        Boolean(options.stdin),
        Boolean(options.eval),
        options.bootstrap || env.WORKER_BOOTSTRAP
      ])
    });

    if (url !== file)
      revokeWorkerURL(url);

    this._proxy = new EventProxy(this._worker, true);
    this._proxy.eternal = true;

    this._proxy.watch(this, ['message', 'error', 'online', 'exit']);

    this._proxy.listen('message', (event) => {
      try {
        this._handleMessage(event);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this._worker.onerror = (event) => {
      this._handleError(event);
    };

    this._worker.onmessageerror = (event) => {
      this._handleError(event);
    };

    let stdin = null;

    if (options.stdin)
      stdin = new stdio.Writable(this, 0);

    const stdout = new stdio.Readable(this, 1);
    const stderr = new stdio.Readable(this, 2);

    this._proxy.watch(stdout, ['data', 'end']);
    this._proxy.watch(stderr, ['data', 'end']);

    if (!options.stdout) {
      const stream = new stdio.Console(console.log, console);
      stdout.pipe(stream);
    }

    if (!options.stderr) {
      const stream = new stdio.Console(console.error, console);
      stderr.pipe(stream);
    }

    this._stdio[0] = stdin;
    this._stdio[1] = stdout;
    this._stdio[2] = stderr;

    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;

    if (options.eval)
      this.postMessage(code);
  }

  _handleMessage(event) {
    if (this._exited)
      return;

    const pkt = Packet.decode(event.data);

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
        this._terminate(1);
        this.emit('error', decodeError(pkt.value));
        break;
      }

      case types.OPEN: {
        this.emit('online');
        break;
      }

      case types.EXIT: {
        this._terminate(pkt.value);
        break;
      }

      default: {
        throw new WorkerError(errors.INVALID_PACKET, pkt.type);
      }
    }
  }

  _handleError(event) {
    this._terminate(1);
    this.emit('error', errorify(event));
  }

  _send(pkt, transferList) {
    if (this._exited)
      return;

    const [msg, list] = pkt.morph(transferList);

    this._worker.postMessage(msg, list);
  }

  postMessage(value, transferList) {
    // Note: throws in node.js.
    if (this._exited)
      return;

    this._send(new Packet(types.MESSAGE, value), transferList);
  }

  ref() {
    return;
  }

  _terminate(code) {
    if (this._exited)
      return;

    this._worker.terminate();
    this._exited = true;

    setImmediate(() => {
      if (!this.stdout.ended)
        this.stdout.emit('end');

      if (!this.stderr.ended)
        this.stderr.emit('end');

      this.threadId = -1;

      this.emit('exit', code >>> 0);
      this._proxy.destroy();
      this.removeAllListeners();
    });
  }

  terminate(callback) {
    if (this._exited)
      return;

    if (typeof callback === 'function')
      this.once('exit', code => callback(null, code));

    this._terminate(1);
  }

  unref() {
    return;
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
 * DOM Wrappers
 */

function createURL(file) {
  const URL = global.URL;

  if (typeof URL !== 'function')
    throw new Error('No URL backend found.');

  return new URL(file);
}

function createObjectURL(blob) {
  const URL = global.URL;

  if (typeof URL !== 'function')
    throw new Error('No URL backend found.');

  if (typeof URL.createObjectURL !== 'function')
    throw new Error('Object URLs not supported.');

  return URL.createObjectURL(blob);
}

function revokeObjectURL(url) {
  const URL = global.URL;

  if (typeof URL !== 'function')
    throw new Error('No URL backend found.');

  if (typeof URL.revokeObjectURL !== 'function')
    throw new Error('URL revocations not supported.');

  return URL.revokeObjectURL(url);
}

function createBlob(data, type) {
  const Blob = global.Blob;
  const BlobBuilder = global.BlobBuilder
                   || global.WebKitBlobBuilder
                   || global.MozBlobBuilder;

  // Native Blob object.
  if (typeof Blob === 'function')
    return new Blob([data], { type });

  // Deprecated BlobBuilder object.
  if (typeof BlobBuilder !== 'function')
    throw new Error('No Blob backend found.');

  const bb = new BlobBuilder();

  bb.append(data);

  return bb.getBlob(type);
}

/*
 * Helpers
 */

function createWorkerURL(url, scriptType) {
  const location = JSON.stringify(url);

  // Our polyfill doesn't create globals,
  // but we can access importScripts from
  // `__bthreads_polyfill_scope`.
  const importScripts = backend.polyfill
    ? '__bthreads_polyfill_scope.importScripts'
    : 'importScripts';

  const code = scriptType !== 'module'
    ? `${importScripts}(${location});`
    : `import ${location};`;

  const type = 'application/javascript';

  // Try an object URL first.
  if (!backend.polyfill) {
    try {
      return createObjectURL(createBlob(code, type));
    } catch (e) {
      ;
    }
  }

  // Fallback to data URI.
  return `data:${type},${encodeURIComponent(code)}`;
}

function revokeWorkerURL(url) {
  if (!/^blob:/.test(url))
    return;

  try {
    revokeObjectURL(url);
  } catch (e) {
    ;
  }
}

function scriptType(file) {
  try {
    file = createURL(file).pathname;
  } catch (e) {
    ;
  }

  // Support .mjs (node.js style).
  if (/\.mjs/.test(file))
    return 'module';

  return 'classic';
}

function isURL(file) {
  try {
    createURL(file);
    return true;
  } catch (e) {
    return false;
  }
}

function isSameOrigin(file) {
  let {origin, location} = global;

  // We don't care about worker
  // origin rules in our polyfill.
  if (backend.polyfill)
    return true;

  // https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/origin
  if (typeof origin === 'string' && origin !== 'null') {
    try {
      origin = createURL(origin);
    } catch (e) {
      origin = location;
    }
  } else {
    origin = location;
  }

  // No hostname. What?
  if (typeof origin.hostname !== 'string')
    return true;

  // We only care about http(s).
  switch (origin.protocol) {
    case 'http:':
    case 'https:':
      break;
    default:
      return true;
  }

  let url = null;

  try {
    url = createURL(file);
  } catch (e) {
    // Not a URL.
    return true;
  }

  // We only care about http(s).
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      break;
    default:
      return true;
  }

  // Does same origin use the port?
  // Could use `host` instead of `hostname`.
  return url.protocol === origin.protocol
      && url.hostname === origin.hostname;
}

/*
 * Expose
 */

module.exports = Worker;
