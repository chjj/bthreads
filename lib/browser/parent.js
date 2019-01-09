/* eslint no-global-assign: "off" */

'use strict';

const {EventEmitter} = require('events');
const encoding = require('../internal/encoding');
const once = require('../internal/once');
const {morph, unmorph} = require('./common');
const Console = require('./console');
const Stream = require('./stream');

// https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope
// https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
// https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent

/**
 * Parent
 */

class Parent extends EventEmitter {
  constructor() {
    super();

    this._threadId = 0;
    this._workerData = null;
    this._stdin = false;
    this._stdout = false;
    this._stderr = false;

    this._init();
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

  _init() {
    let items = null;

    try {
      items = encoding.parse(global.name, null);
    } catch (e) {
      ;
    }

    if (items) {
      const [id, data, stdin, stdout, stderr] = items;

      this._threadId = id;
      this._workerData = data;
      this._stdin = stdin;
      this._stdout = stdout;
      this._stderr = stderr;
    }

    once(this, 'message', () => {
      global.onmessage = (event) => {
        const pkt = unmorph(event.data);

        this.emit('_packet', pkt);

        if (pkt.cmd === 'msg')
          this.emit('message', pkt.value);
      };
    });

    once(this, 'error', () => {
      global.onerror = (event) => {
        this.emit('error', new Error(event.message));
      };

      global.onmessageerror = (event) => {
        this.emit('error', new Error(event.message));
      };
    });

    this._inject();
  }

  _inject() {
    if (this._stdin)
      process.stdin = new Stdin(this);

    if (this._stdout || this._stderr) {
      process.stdout = new Stdout(this);
      process.stderr = new Stderr(this);

      const console_ = new Console(process.stdout, process.stderr);

      if (global.console === console)
        global.console = console_;
      else
        console = console_;
    }
  }

  close() {
    global.close();
    return this;
  }

  _write(value, transferList) {
    const [msg, list] = morph(value, transferList);

    if (global.postMessage.length === 1)
      global.postMessage(msg);
    else
      global.postMessage(msg, list);

    return this;
  }

  postMessage(value, transferList) {
    return this._write({ cmd: 'msg', value }, transferList);
  }

  ref() {
    return this;
  }

  start() {
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
    this._isStdio = true;
    this.readable = true;
    this._init();
  }

  _init() {
    this._parent.on('_packet', (pkt) => {
      if (pkt.cmd === 'stdin')
        this.push(toBuffer(pkt.value));
    });
  }
}

/**
 * Stdout
 */

class Stdout extends Stream {
  constructor(parent) {
    super();
    this._parent = parent;
    this._isStdio = true;
    this.writable = true;
  }

  write(data, enc) {
    if (typeof data === 'string')
      data = Buffer.from(data, enc || 'utf8');

    if (!Buffer.isBuffer(data))
      throw new TypeError('"data" must be a buffer.');

    this._parent._write({ cmd: 'stdout', value: data });

    return true;
  }
}

/**
 * Stderr
 */

class Stderr extends Stream {
  constructor(parent) {
    super();
    this._parent = parent;
    this._isStdio = true;
    this.writable = true;
  }

  write(data, enc) {
    if (typeof data === 'string')
      data = Buffer.from(data, enc || 'utf8');

    if (!Buffer.isBuffer(data))
      throw new TypeError('"data" must be a buffer.');

    this._parent._write({ cmd: 'stderr', value: data });

    return true;
  }
}

/*
 * Helpers
 */

function toBuffer(value) {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/*
 * Expose
 */

module.exports = Parent;
