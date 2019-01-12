/* eslint no-global-assign: "off" */

'use strict';

const encoding = require('../internal/encoding');
const backend = require('./backend');
const {MessagePortBase, once, morph, unmorph, format} = require('./common');
const Console = require('./console');
const Stream = require('./stream');

// https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope
// https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
// https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent

/*
 * Constants
 */

const ARGS = Array.prototype.slice.call(eval('arguments'));

/**
 * Parent
 */

class Parent extends MessagePortBase {
  constructor() {
    super();

    this._threadId = 0;
    this._workerData = null;
    this._stdin = false;
    this._stdout = false;
    this._stderr = false;
    this._bound = false;

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

  _bind() {
    if (this._bound)
      return;

    backend.onmessage((event) => {
      const pkt = unmorph(event.data);

      this.emit('_packet', pkt);

      if (pkt.cmd === 'msg')
        this.emit('message', pkt.value);
    });

    this._bound = true;
  }

  _init() {
    let items = null;

    try {
      items = encoding.parse(backend.name);
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

    once(this, ['_packet', 'message'], () => {
      this._bind();
    });

    once(this, 'error', () => {
      backend.onerror((event) => {
        this.emit('error', new Error(format(event)));
      });

      backend.onmessageerror((event) => {
        this.emit('error', new Error(format(event)));
      });
    });

    this._inject();
  }

  _inject() {
    addListener('error', ({error}) => {
      if (!(error instanceof Error))
        error = new Error('Uncaught exception: ' + error);

      this._exception(error);
    });

    addListener('unhandledrejection', ({reason}) => {
      if (!(reason instanceof Error))
        reason = new Error('Unhandled rejection: ' + reason);

      this._exception(reason);
    });

    if (this._stdin)
      process.stdin = new Stdin(this);

    if (this._stdout || this._stderr) {
      process.stdout = new Stdout(this);
      process.stderr = new Stderr(this);

      global.console = new Console(process.stdout, process.stderr);

      // Is console lexically scoped?
      if (console !== global.console) {
        // Is it an argument?
        if (ARGS.indexOf(console) !== -1)
          global.console.inject(console);
        console = global.console;
      }
    }

    process.exit = (code) => {
      this._exit(code);
    };
  }

  _exit(code) {
    this._write({ cmd: 'exit', value: code >>> 0 });
    return this;
  }

  close() {
    backend.close();
    return this;
  }

  _exception(err) {
    return this._write({
      cmd: 'err',
      value: {
        name: String(err.name),
        code: err.code != null
          ? String(err.code)
          : undefined,
        message: String(err.message),
        stack: String(err.stack)
      }
    });
  }

  _write(value, transferList) {
    const [msg, list] = morph(value, transferList);

    backend.postMessage(msg, list);

    return this;
  }

  postMessage(value, transferList) {
    return this._write({ cmd: 'msg', value }, transferList);
  }

  ref() {
    return this;
  }

  start() {
    this._bind();
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

function addListener(event, handler) {
  if (global.addEventListener)
    global.addEventListener(event, handler, false);
  else if (global.attachEvent)
    global.attachEvent(`on${event}`, handler);
  else
    global[`on${event}`] = handler;
}

/*
 * Expose
 */

module.exports = Parent;
