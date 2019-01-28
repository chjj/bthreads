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
const {once, toBuffer} = require('../internal/utils');
const encoding = require('../internal/encoding');
const backend = require('./backend');
const common = require('./common');
const env = require('./env');
const stdio = require('./stdio');
const {Packet, types, format} = common;

/*
 * Constants
 */

const DEFAULT_HEADER_URL = 'https://unpkg.com/bthreads-bundle@0.1.1/index.js';
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
    this._exited = false;
    this._bound = false;
    this._stdio = [null, null, null];

    this.threadId = uid;
    this.stdin = null;
    this.stdout = null;
    this.stderr = null;

    uid += 1;
    uid >>>= 0;

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

  _bind() {
    if (this._bound)
      return;

    this._worker.onmessage = (event) => {
      try {
        this._handleMessage(event);
      } catch (e) {
        this.emit('error', e);
      }
    };

    this._bound = true;
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

    once(this, ['message', 'online', 'exit'], () => {
      this._bind();
    });

    once(this, 'error', () => {
      this._worker.onerror = (event) => {
        this._handleError(event);
      };

      this._worker.onmessageerror = (event) => {
        this._handleError(event);
      };
    });

    let stdin = null;

    if (options.stdin)
      stdin = new stdio.Writable(this, 0);

    const stdout = new stdio.Readable(this, 1);
    const stderr = new stdio.Readable(this, 2);

    once(stdout, 'data', () => this._bind());
    once(stderr, 'data', () => this._bind());

    if (!options.stdout) {
      const stream = new stdio.Console(console.log);
      stdout.pipe(stream);
    }

    if (!options.stderr) {
      const stream = new stdio.Console(console.error);
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
        if (!Array.isArray(pkt.value))
          throw new TypeError('Received invalid error.');

        const err = new Error(pkt.value[0]);

        err.name = pkt.value[1];

        if (pkt.value[2] !== undefined)
          err.type = pkt.value[2];

        if (pkt.value[3] !== undefined)
          err.code = pkt.value[3];

        err.stack = pkt.value[4];

        this.emit('error', err);
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
    this.emit('error', new Error(format(event)));
    this._terminate(1);
  }

  _send(pkt, transferList) {
    if (this._exited)
      return this;

    const [msg, list] = pkt.morph(transferList);

    this._worker.postMessage(msg, list);

    return this;
  }

  postMessage(value, transferList) {
    if (this._exited)
      throw new Error('Worker is terminated.');

    return this._send(new Packet(types.MESSAGE, value), transferList);
  }

  ref() {
    return this;
  }

  _terminate(code) {
    if (this._exited)
      return;

    this._exited = true;
    this._worker.terminate();

    setImmediate(() => {
      if (this.stdout && !this.stdout.ended)
        this.stdout.emit('end');

      if (this.stderr && !this.stderr.ended)
        this.stderr.emit('end');

      this.threadId = -1;

      // Note: supposed to throw on access.
      this.stdin = null;
      this.stdout = null;
      this.stderr = null;

      this.emit('exit', code >>> 0);
      this.removeAllListeners();
    });
  }

  terminate(callback) {
    if (this._exited)
      return this;

    if (typeof callback === 'function')
      this.once('exit', code => callback(null, code));

    this._terminate(1);

    return this;
  }

  unref() {
    return this;
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
    + 'process.mainModule = module;'
    + 'self.__dirname = __dirname;'
    + 'self.__filename = __filename;'
    + 'self.exports = exports;'
    + 'self.module = module;'
    + 'self.require = require;'
    + '\n'
    + body
    + '\n'
    + ';'
    + 'module.loaded = true;'
    + '}).call(self);';

  // We could also create an object URL, but
  // I'm having trouble getting it to work with CSP.
  return 'data:application/javascript,' + encodeURIComponent(script);
}

/*
 * Expose
 */

module.exports = Worker;
