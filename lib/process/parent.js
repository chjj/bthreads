/*!
 * parent.js - parent thread port for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/worker_threads.html#worker_threads_worker_parentport
 */

'use strict';

const encoding = require('../internal/encoding');
const common = require('./common');
const Packet = require('./packet');
const Parser = require('./parser');
const stdio = require('./stdio');
const {Console} = console;
const {types} = Packet;

const {
  exit,
  stdin,
  stdout,
  stderr
} = process;

const {
  MessagePortBase,
  MessagePort,
  activate
} = common;

/*
 * Constants
 */

const nullRead = new stdio.NullReadable();
const nullWrite = stderr;

const {
  BTHREADS_WORKER_ID: WORKER_ID,
  BTHREADS_WORKER_DATA: WORKER_DATA,
  BTHREADS_WORKER_STDIN: WORKER_STDIN,
  BTHREADS_WORKER_STDOUT: WORKER_STDOUT,
  BTHREADS_WORKER_STDERR: WORKER_STDERR
} = process.env;

/**
 * Parent
 */

class Parent extends MessagePortBase {
  constructor() {
    super();

    this._workerId = WORKER_ID >>> 0;
    this._workerData = encoding.parse(WORKER_DATA);
    this._parser = new Parser(this);
    this._ports = new Map();
    this._closed = false;
    this._writable = true;
    this._stdioRefs = 0;
    this._stdio = [nullRead, nullWrite, nullWrite];
    this._exit = exit.bind(process);
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

  _init() {
    this.on('error', () => {});

    stdin.on('error', (err) => {
      this.emit('error', err);
    });

    stdout.on('error', (err) => {
      this.emit('error', err);
    });

    stdout.on('close', () => {
      this._writable = false;
    });

    stdout.on('finish', () => {
      this._writable = false;
    });

    stderr.on('error', (err) => {
      this.emit('error', err);
    });

    stdin.on('data', (data) => {
      if (this._closed)
        return;

      try {
        this._parser.feed(data);
      } catch (e) {
        this.emit('error', e);
      }
    });

    stdin.unref();
    stdout.unref();

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

    setupRefs(stdin, this, 'message');

    if (WORKER_STDIN === '1')
      this._stdio[0] = new stdio.Readable(this, 0, true);

    if (WORKER_STDOUT === '1')
      this._stdio[1] = new stdio.Writable(this, 1);

    if (WORKER_STDERR === '1')
      this._stdio[2] = new stdio.Writable(this, 2);

    this._stdin = this._stdio[0];
    this._stdout = this._stdio[1];
    this._stderr = this._stdio[2];

    this._console = new Console(this._stdout, this._stderr);
    this._console.Console = Console;

    this._inject();
    this._send(new Packet(types.OPEN));
  }

  _inject() {
    const onException = (err) => {
      this._exception(err);
    };

    const onRejection = (err) => {
      if (!(err instanceof Error))
        err = new Error('Unhandled rejection: ' + err);

      this._exception(err);
    };

    if (process.listenerCount('uncaughtException') === 0)
      process.on('uncaughtException', onException);

    if (process.listenerCount('unhandledRejection') === 0)
      process.on('unhandledRejection', onRejection);

    process.on('newListener', (name) => {
      switch (name) {
        case 'uncaughtException':
          process.removeListener(name, onException);
          break;
        case 'unhandledRejection':
          process.removeListener(name, onRejection);
          break;
      }
    });

    process.abort = null;
    process.chdir = null;
    process.initgroups = null;
    process.setgroups = null;
    process.setegid = null;
    process.seteuid = null;
    process.setgid = null;
    process.setuid = null;

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      enumerable: true,
      get: () => this._stdin
    });

    Object.defineProperty(process, 'stdout', {
      configurable: true,
      enumerable: true,
      get: () => this._stdout
    });

    Object.defineProperty(process, 'stderr', {
      configurable: true,
      enumerable: true,
      get: () => this._stderr
    });

    Object.defineProperty(global, 'console', {
      configurable: true,
      enumerable: true,
      get: () => this._console
    });
  }

  _handleMessage(pkt) {
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

      default: {
        throw new Error(`Parent received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _exception(err) {
    this._send(new Packet(types.ERROR, 0, err));
  }

  _send(pkt) {
    if (this._writable)
      stdout.write(pkt.encode());

    return this;
  }

  _attach(id) {
    const port = new MessagePort();

    port._id = id;
    port._parent = this;
    port._active = true;

    if (port._id === 0)
      throw new Error('Message port ID collision.');

    this._ports.set(port._id, port);

    return port;
  }

  close() {
    if (this._closed)
      throw new Error('Port is already closed.');

    this._closed = true;

    stdin.destroy();

    if (this._writable) {
      this._writable = false;
      stdout.end(() => this.emit('close'));
    } else {
      setImmediate(() => this.emit('close'));
    }

    return this;
  }

  postMessage(value, transferList) {
    if (this._closed)
      throw new Error('Port is closed.');

    activate(transferList, this);

    return this._send(new Packet(types.MESSAGE, 0, value));
  }

  ref() {
    stdin.ref();
    return this;
  }

  start() {
    return this;
  }

  unref() {
    stdin.unref();
    return this;
  }
}

/*
 * Helpers
 */

function toBuffer(value) {
  if (value instanceof Uint8Array)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

function setupRefs(port, ee, event) {
  port.unref();

  ee.on('newListener', (name) => {
    if (name === event && ee.listenerCount(event) === 0)
      port.ref();
  });

  ee.on('removeListener', (name) => {
    if (name === event && ee.listenerCount(event) === 0)
      port.unref();
  });
}

/*
 * Expose
 */

module.exports = Parent;
