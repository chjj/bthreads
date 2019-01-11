'use strict';

/* global register */

const {EventEmitter} = require('events');
const encoding = require('../internal/encoding');
const {once, morph, unmorph, format} = require('./common');
const Stream = require('./stream');

// https://developer.mozilla.org/en-US/docs/Web/API/AbstractWorker
// https://developer.mozilla.org/en-US/docs/Web/API/Worker
// https://nodejs.org/api/worker_threads.html#worker_threads_class_worker
// https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
// https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent

/*
 * Constants
 */

const HEADER_URL = 'https://unpkg.com/bthreads@0.0.0/etc/bundle.js';

let uid = 0;

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

    this._id = uid++;
    this._worker = null;
    this._exited = false;
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

  _init(file, options) {
    if (options.eval)
      file = evalScript('[worker eval]', file, options.header);
    else if (process.env.BMOCHA)
      register(file, [__dirname, file]);

    this._worker = new global.Worker(file, {
      type: options.type || 'classic',
      credentials: options.credentials || 'omit',
      name: encoding.stringify([
        this._id,
        options.workerData,
        Boolean(options.stdin),
        Boolean(options.stdout),
        Boolean(options.stderr)
      ])
    });

    once(this, ['_packet', 'message'], () => {
      this._worker.onmessage = (event) => {
        const pkt = unmorph(event.data);

        this.emit('_packet', pkt);

        if (pkt.cmd === 'err') {
          const err = new Error(pkt.value.message);

          err.name = pkt.value.name;

          if (pkt.value.code !== undefined)
            err.code = pkt.value.code;

          err.stack = pkt.value.stack;

          this.emit('error', err);
          this._terminate(1);

          return;
        }

        if (pkt.cmd === 'msg')
          this.emit('message', pkt.value);
      };
    });

    once(this, 'error', () => {
      this._worker.onerror = (event) => {
        this.emit('error', new Error(format(event)));
        this._terminate(1);
      };

      this._worker.onmessageerror = (event) => {
        this.emit('error', new Error(format(event)));
        this._terminate(1);
      };
    });

    if (options.stdin)
      this.stdin = new Stdin(this);

    if (options.stdout)
      this.stdout = new Stdout(this);

    if (options.stderr)
      this.stderr = new Stderr(this);

    setImmediate(() => {
      this.emit('online');
    });
  }

  _write(value, transferList) {
    const [msg, list] = morph(value, transferList);

    this._worker.postMessage(msg, list);

    return this;
  }

  postMessage(value, transferList) {
    return this._write({ cmd: 'msg', value }, transferList);
  }

  ref() {
    return this;
  }

  _terminate(code) {
    try {
      this._worker.terminate();
    } catch (e) {
      ;
    }

    if (!this._exited) {
      this._exited = true;
      setImmediate(() => {
        this.emit('exit', code >>> 0, null);
      });
    }

    return this;
  }

  terminate(callback) {
    this._terminate(0);

    if (typeof callback === 'function')
      this.once('exit', code => callback(null, code));

    return this;
  }

  unref() {
    return this;
  }
}

/**
 * Stdin
 */

class Stdin extends Stream {
  constructor(parent) {
    super();
    this._parent = parent;
    this.writable = true;
  }

  write(data, enc) {
    if (typeof data === 'string')
      data = Buffer.from(data, enc || 'utf8');

    if (!Buffer.isBuffer(data))
      throw new TypeError('"data" must be a buffer.');

    this._parent._write({ cmd: 'stdin', value: data });

    return true;
  }
}

/**
 * Stdout
 */

class Stdout extends Stream {
  constructor(parent) {
    super();
    this._parent = parent;
    this.readable = true;
    this._init();
  }

  _init() {
    this._parent.on('_packet', (pkt) => {
      if (pkt.cmd === 'stdout')
        this.push(toBuffer(pkt.value));
    });
  }
}

/**
 * Stderr
 */

class Stderr extends Stream {
  constructor(parent) {
    super();
    this._parent = parent;
    this.readable = true;
    this._init();
  }

  _init() {
    this._parent.on('_packet', (pkt) => {
      if (pkt.cmd === 'stderr')
        this.push(toBuffer(pkt.value));
    });
  }
}

/*
 * Helpers
 */

function toBuffer(value) {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function evalScript(name, body, url) {
  const file = '/' + name;

  if (typeof url !== 'string')
    url = HEADER_URL;

  const script = ''
    + `importScripts(${JSON.stringify(url)});`
    + 'var require = self.require;'
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
    + 'self.process.mainModule = module;'
    + 'self.__dirname = __dirname;'
    + 'self.__filename = __filename;'
    + 'self.exports = exports;'
    + 'self.module = module;'
    + '\n'
    + body
    + '\n'
    + ';'
    + 'module.loaded = true;';

  // We could also create an object URL, but
  // I'm having trouble getting it to work with CSP.
  return 'data:application/javascript,' + encodeURIComponent(script);
}

/*
 * Expose
 */

module.exports = Worker;
