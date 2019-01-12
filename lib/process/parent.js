/*!
 * parent.js - parent thread port for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/worker_threads.html#worker_threads_worker_parentport
 */

'use strict';

const stream = require('stream');
const encoding = require('../internal/encoding');
const common = require('./common');
const Packet = require('./packet');
const Parser = require('./parser');
const {Console} = console;
const {types} = Packet;

const {
  env,
  exit,
  stdin,
  stdout,
  stderr
} = process;

const {
  MessagePortBase,
  MessagePort,
  once,
  activate
} = common;

/**
 * Parent
 * @extends EventEmitter
 */

class Parent extends MessagePortBase {
  constructor() {
    super();

    this._threadId = env.BTHREADS_THREAD_ID >>> 0;
    this._workerData = null;
    this._parser = new Parser(this);
    this._env = env;
    this._exit = exit;
    this._stdin = stdin;
    this._stdout = stdout;
    this._stderr = stderr;
    this._ports = new Map();
    this._unrefd = false;
    this._closed = false;

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

    this._workerData = encoding.parse(env.BTHREADS_WORKER_DATA);

    this._stdin.on('data', (data) => {
      if (this._closed)
        return;

      try {
        this._parser.feed(data);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this._stdin.unref();
    this._stdout.unref();
    this._stderr.unref();

    once(this, 'message', () => {
      if (!this._unrefd)
        this._stdin.ref();
    });

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

    this._stdin.on('error', (err) => {
      this.emit('error', err);
    });

    this._stdout.on('error', (err) => {
      this.emit('error', err);
    });

    this._stderr.on('error', (err) => {
      this.emit('error', err);
    });

    this._inject();

    this._write(new Packet(types.OPEN));
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

    const stdin = new Stdin();
    const stdout = new Stdout(this);
    const stderr = new Stderr(this);

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      enumerable: true,
      get: () => stdin
    });

    Object.defineProperty(process, 'stdout', {
      configurable: true,
      enumerable: true,
      get: () => stdout
    });

    Object.defineProperty(process, 'stderr', {
      configurable: true,
      enumerable: true,
      get: () => stderr
    });

    process.abort = null;
    process.chdir = null;
    process.initgroups = null;
    process.setgroups = null;
    process.setegid = null;
    process.seteuid = null;
    process.setgid = null;
    process.setuid = null;

    const console = new Console(stdout, stderr);

    console.Console = Console;

    Object.defineProperty(global, 'console', {
      configurable: true,
      enumerable: true,
      get: () => console
    });
  }

  _handleMessage(pkt) {
    const port = this._ports.get(pkt.port);

    if (port) {
      port._onMessage(pkt);
      return;
    }

    if (pkt.port !== 0)
      return;

    switch (pkt.type) {
      case types.MESSAGE: {
        this.emit('message', pkt.value);
        break;
      }

      case types.STDIN: {
        if (!process.stdin._unrefd)
          process.stdin.ref();
        process.stdin.push(toBuffer(pkt.value));
        break;
      }

      default: {
        throw new Error(`Parent received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _exception(err) {
    this._write(new Packet(types.ERROR, 0, err));
  }

  _write(pkt) {
    if (!stdout.writable)
      return false;

    return stdout.write(pkt.encode());
  }

  _attach(id) {
    const port = new MessagePort();

    port._id = id;
    port._parent = this;
    port._active = true;

    if (port._id < 1)
      throw new Error('Message port ID collision.');

    this._ports.set(port._id, port);

    return port;
  }

  close() {
    if (this._closed)
      throw new Error('Port is already closed.');

    this._closed = true;
    this._stdin.unref();
    this._write(new Packet(types.CLOSE));

    return this;
  }

  postMessage(value, transferList) {
    if (this._closed)
      throw new Error('Port is closed.');

    activate(transferList, this);

    this._write(new Packet(types.MESSAGE, 0, value));

    return this;
  }

  ref() {
    this._stdin.ref();
    return this;
  }

  start() {
    return this;
  }

  unref() {
    this._unrefd = true;
    this._stdin.unref();
    return this;
  }
}

/**
 * Stdin
 */

class Stdin extends stream.Readable {
  constructor() {
    super();

    this._timer = null;
    this._unrefd = false;

    // Make sure there's enough
    // time to read one message.
    setImmediate(() => {});
  }

  ref() {
    if (this._timer == null)
      this._timer = setInterval(() => {}, 0x7fffffff);
    return this;
  }

  unref() {
    this._unrefd = true;
    if (this._timer != null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  pause() {
    this.unref();
    return super.pause();
  }

  resume() {
    this.ref();
    return super.resume();
  }

  _read(size) {
    this.ref();
  }

  _destroy(err, callback) {
    this.unref();
    callback(err);
  }
}

/**
 * Stdout
 */

class Stdout extends stream.Writable {
  constructor(parent) {
    super();

    this._parent = parent;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  _write(chunk, enc, callback) {
    this._parent._write(new Packet(types.STDOUT, 0, chunk));
    callback(null);
  }

  _destroy(err, callback) {
    callback(err);
  }

  _final(callback) {
    callback(null);
  }
}

/**
 * Stderr
 */

class Stderr extends stream.Writable {
  constructor(parent) {
    super();

    this._parent = parent;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  _write(chunk, enc, callback) {
    this._parent._stderr.write(chunk, enc, callback);
  }

  _destroy(err, callback) {
    this._parent._stderr.destroy(err);
    callback(null);
  }

  _final(callback) {
    this._parent._stderr.end(callback);
  }
}

/*
 * Helpers
 */

function toBuffer(value) {
  if (!(value instanceof Uint8Array))
    throw new TypeError('Invalid packet value.');

  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/*
 * Expose
 */

module.exports = Parent;
