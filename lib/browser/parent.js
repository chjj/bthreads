/*!
 * parent.js - parent thread port for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/worker_threads.html#worker_threads_worker_parentport
 *   https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope
 *   https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
 *   https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
 */

/* eslint no-global-assign: "off" */

'use strict';

const {once, toBuffer} = require('../internal/utils');
const backend = require('./backend');
const common = require('./common');
const Console = require('./console');
const env = require('./env');
const stdio = require('./stdio');

const {
  MessagePortBase,
  Packet,
  types,
  format
} = common;

const {
  WORKER_ID,
  WORKER_DATA,
  WORKER_STDIN,
  WORKER_EVAL
} = env;

/**
 * Parent
 */

class Parent extends MessagePortBase {
  constructor() {
    super();

    this._workerId = WORKER_ID;
    this._workerData = WORKER_DATA;
    this._workerEval = WORKER_EVAL;
    this._closed = false;
    this._bound = false;
    this._stdio = [null, null, null];
    this._exit = this._exit.bind(this);
    this._stdin = this._stdio[0];
    this._stdout = this._stdio[1];
    this._stderr = this._stdio[2];
    this._console = console;

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
      try {
        this._handleMessage(event);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this._bound = true;
  }

  _init() {
    once(this, 'message', () => {
      this._bind();
    });

    once(this, 'error', () => {
      backend.onerror((event) => {
        this._handleError(event);
      });

      backend.onmessageerror((event) => {
        this._handleError(event);
      });
    });

    const stdin = new stdio.Readable(this, 0);
    const stdout = new stdio.Writable(this, 1);
    const stderr = new stdio.Writable(this, 2);

    if (WORKER_STDIN)
      once(stdin, 'data', () => this._bind());
    else
      stdin.emit('end');

    this._stdio[0] = stdin;
    this._stdio[1] = stdout;
    this._stdio[2] = stderr;

    this._stdin = stdin;
    this._stdout = stdout;
    this._stderr = stderr;
    this._console = new Console(stdout, stderr);

    this._inject();
    this._send(new Packet(types.OPEN));
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

    process.abort = null;
    process.chdir = null;
    process.exit = this._exit;
    process.stdin = this._stdin;
    process.stdout = this._stdout;
    process.stderr = this._stderr;

    injectConsole(this._console);
  }

  _handleMessage(event) {
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

      default: {
        throw new Error(`Parent received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _handleError(event) {
    this.emit('error', new Error(format(event)));
  }

  _exit(code) {
    this._send(new Packet(types.EXIT, code >>> 0));
    return this;
  }

  close() {
    if (this._closed)
      return this;

    this._closed = true;

    backend.close();

    setImmediate(() => this.emit('close'));

    return this;
  }

  _exception(err) {
    const items = [
      String(err.name),
      err.type != null
        ? String(err.type)
        : undefined,
      err.code != null
        ? String(err.code)
        : undefined,
      String(err.message),
      String(err.stack)
    ];

    return this._send(new Packet(types.ERROR, items));
  }

  _send(pkt, transferList) {
    const [msg, list] = pkt.morph(transferList);

    backend.postMessage(msg, list);

    return this;
  }

  postMessage(value, transferList) {
    if (this._closed)
      throw new Error('Port is closed.');

    return this._send(new Packet(types.MESSAGE, value), transferList);
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

/*
 * Helpers
 */

function addListener(event, handler) {
  if (global.addEventListener)
    global.addEventListener(event, handler, false);
  else if (global.attachEvent)
    global.attachEvent(`on${event}`, handler);
  else
    global[`on${event}`] = handler;
}

function isLocalConsole() {
  if (console !== global.console)
    return true;

  // We could have been tricked by
  // `var console = global.console;`
  // somewhere above us.
  const console_ = global.console;
  const tmp = {};

  try {
    global.console = tmp;
  } catch (e) {
    return false;
  }

  const result = console !== tmp;

  global.console = console_;

  return result;
}

function injectConsole(console_) {
  // Try to avoid overwriting the console
  // globally with some craziness.
  if (isLocalConsole()) {
    // The console is lexically scoped.
    console_.inject(console);
    console = console_;
  } else {
    // The console is global. Try to
    // reassign. If that fails, inject
    // methods directly.
    try {
      global.console = console_;
    } catch (e) {
      console_.inject(console);
    }
  }
}

/*
 * Expose
 */

module.exports = Parent;
