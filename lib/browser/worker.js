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
  custom,
  inspectify,
  toBuffer,
  decodeError
} = utils;

const {
  Packet,
  types,
  errorify
} = common;

/*
 * Constants
 */

const DEFAULT_HEADER_URL = 'https://unpkg.com/bthreads-bundle@0.2.2/index.js';
const HEADER_URL = env.WORKER_HEADER || DEFAULT_HEADER_URL;

let uid = 1;

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

    if (options.type != null && typeof options.type !== 'string')
      throw new TypeError('"type" must be a string.');

    if (options.credentials != null && typeof options.credentials !== 'string')
      throw new TypeError('"credentials" must be a string.');

    if (options.header != null && typeof options.header !== 'string')
      throw new TypeError('"header" must be a string.');

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
    if (options.eval)
      file = evalScript('[worker eval]', file, options.header);
    else if (process.env.BMOCHA)
      register(file, [__dirname, file]);

    this._worker = new backend.Worker(file, {
      type: options.type || (/\.mjs$/.test(file) ? 'module' : 'classic'),
      credentials: options.credentials || 'omit',
      name: encoding.stringify([
        this.threadId,
        options.workerData,
        Boolean(options.stdin),
        Boolean(options.eval),
        options.header || env.WORKER_HEADER
      ])
    });

    this._proxy = new EventProxy(this._worker, true);
    this._proxy.watch(this, ['message', 'error', 'online', 'exit']);

    this._proxy.listen('message', (event) => {
      try {
        this._handleMessage(event);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this._proxy.listen('error', (event) => {
      this._handleError(event);
    });

    this._proxy.listen('messageerror', (event) => {
      this._handleError(event);
    });

    let stdin = null;

    if (options.stdin)
      stdin = new stdio.Writable(this, 0);

    const stdout = new stdio.Readable(this, 1);
    const stderr = new stdio.Readable(this, 2);

    this._proxy.watch(stdout, ['data']);
    this._proxy.watch(stderr, ['data']);

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
        this.emit('error', decodeError(pkt.value));
        this._terminate(1);
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
        throw new Error(`Parent received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _handleError(event) {
    this.emit('error', errorify(event));
    this._terminate(1);
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
      if (this.stdout && !this.stdout.ended)
        this.stdout.emit('end');

      if (this.stderr && !this.stderr.ended)
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
 * Helpers
 */

function evalScript(name, body, url) {
  const file = '/' + name;

  if (typeof url !== 'string')
    url = HEADER_URL;

  const importScripts = backend.polyfill
    ? '__bthreads_importScripts'
    : 'importScripts';

  const script = ''
    + `${importScripts}(${JSON.stringify(url)});`
    + '(function() {'
    + 'var require = __bthreads_bundle.require;'
    + 'var Buffer = __bthreads_bundle.Buffer;'
    + 'var console = __bthreads_bundle.console;'
    + 'var process = __bthreads_bundle.process;'
    + 'var setTimeout = __bthreads_bundle.setTimeout;'
    + 'var clearTimeout = __bthreads_bundle.clearTimeout;'
    + 'var setInterval = __bthreads_bundle.setInterval;'
    + 'var clearInterval = __bthreads_bundle.clearInterval;'
    + 'var setImmediate = __bthreads_bundle.setImmediate;'
    + 'var clearImmediate = __bthreads_bundle.clearImmediate;'
    + 'self.__bthreads_bundle = undefined;'
    + 'var global = self;'
    + 'var __dirname = ".";'
    + `var __filename = ${JSON.stringify(name)};`
    + 'var exports = {};'
    + 'var module = {'
    + `  id: ${JSON.stringify(name)},`
    + '  exports: exports,'
    + '  parent: undefined,'
    + `  filename: ${JSON.stringify(file)},`
    + '  loaded: false,'
    + '  children: [],'
    + '  paths: []'
    + '};'
    + 'process.mainModule = undefined;'
    + 'require.main = undefined;'
    + 'self.__dirname = __dirname;'
    + 'self.__filename = __filename;'
    + 'self.exports = exports;'
    + 'self.module = module;'
    + 'self.require = require;'
    + '(function() {'
    + '\n'
    + body
    + '\n'
    + '}).call(self);'
    + '}).call(self);';

  // We could also create an object URL, but
  // I'm having trouble getting it to work with CSP.
  return 'data:application/javascript,' + encodeURIComponent(script);
}

/*
 * Expose
 */

module.exports = Worker;
