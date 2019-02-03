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

const utils = require('../internal/utils');
const backend = require('./backend');
const common = require('./common');
const Console = require('./console');
const env = require('./env');
const stdio = require('./stdio');

const {
  once,
  toBuffer,
  encodeError
} = utils;

const {
  MessagePortBase,
  Packet,
  types,
  errorify
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
    if (!backend.polyfill) {
      addListener('error', (event) => {
        event.preventDefault();
        event.stopPropagation();

        this._exception(errorify(event));
      });

      addListener('unhandledrejection', (event) => {
        let {reason} = event;

        event.preventDefault();
        event.stopPropagation();

        if (!(reason instanceof Error))
          reason = new Error('Unhandled rejection: ' + reason);

        this._exception(reason);
      });
    }

    process.abort = null;
    process.chdir = null;
    process.exit = this._exit;
    process.stdin = this._stdin;
    process.stdout = this._stdout;
    process.stderr = this._stderr;

    injectConsole(this._console);
  }

  _handleMessage(event) {
    if (this._closed)
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

      default: {
        throw new Error(`Parent received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _handleError(event) {
    this.emit('error', errorify(event));
  }

  _exit(code) {
    this._send(new Packet(types.EXIT, code >>> 0));
  }

  close() {
    if (this._closed)
      return;

    this._closed = true;

    backend.close();

    setImmediate(() => this.emit('close'));
  }

  _exception(err) {
    this._send(new Packet(types.ERROR, encodeError(err)));
  }

  _send(pkt, transferList) {
    const [msg, list] = pkt.morph(transferList);

    backend.postMessage(msg, list);
  }

  postMessage(value, transferList) {
    if (this._closed)
      return;

    this._send(new Packet(types.MESSAGE, value), transferList);
  }

  ref() {
    return;
  }

  start() {
    this._bind();
  }

  unref() {
    return;
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
  if (backend.polyfill) {
    // Special case for bpkg (hack).
    // eslint-disable-next-line
    if (typeof __browser_require__ === 'function')
      console = console_;
    return;
  }

  // Try to avoid overwriting the console
  // globally with some craziness.
  if (isLocalConsole()) {
    // The console is lexically scoped.
    console_.inject(console);
    try {
      console = console_;
    } catch (e) {
      ;
    }
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
