'use strict';

const {EventEmitter} = require('events');
const encoding = require('../internal/encoding');
const once = require('../internal/once');
const walk = require('../internal/walk');
const {MessagePort} = require('./common');
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

    this.threadId = 0;
    this.workerData = null;
    this._hasStdin = false;
    this._hasStdout = false;
    this._hasStderr = false;

    this._init();
  }

  _init() {
    try {
      const [id, data, stdin, stdout, stderr] = encoding.parse(global.name);

      this.threadId = id;
      this.workerData = data;
      this._hasStdin = stdin;
      this._hasStdout = stdout;
      this._hasStderr = stderr;
    } catch (e) {
      ;
    }

    once(this, 'message', () => {
      global.onmessage = (event) => {
        const pkt = walk.unmorph(event.data, MessagePort);

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
    if (this._hasStdin)
      process.stdin = new Stdin(this);

    if (this._hasStdout || this._hasStderr) {
      process.stdout = new Stdout(this);
      process.stderr = new Stderr(this);
      global.console = new Console(process.stdout, process.stderr);
    }
  }

  close() {
    global.close();
    return this;
  }

  _write(value, transferList) {
    const [msg, list] = walk.morph(value, transferList, MessagePort);

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
    this._isStdio = true;
    this.parent = parent;
    this.readable = true;
    this._init();
  }

  _init() {
    this.parent.on('_packet', (pkt) => {
      if (pkt.cmd === 'stdin')
        this.emit('data', pkt.value);
    });
  }
}

/**
 * Stdout
 */

class Stdout extends Stream {
  constructor(parent) {
    super();
    this._isStdio = true;
    this.parent = parent;
    this.writable = true;
  }

  write(data, enc) {
    if (typeof data === 'string')
      data = Buffer.from(data, enc);

    this.parent._write({ cmd: 'stdout', value: data });

    return true;
  }
}

/**
 * Stderr
 */

class Stderr extends Stream {
  constructor(parent) {
    super();
    this._isStdio = true;
    this.parent = parent;
    this.writable = true;
  }

  write(data, enc) {
    if (typeof data === 'string')
      data = Buffer.from(data, enc);

    this.parent._write({ cmd: 'stderr', value: data });

    return true;
  }
}

/*
 * Expose
 */

module.exports = Parent;
