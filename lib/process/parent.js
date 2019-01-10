/*!
 * parent.js - worker processes for bthreads
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const stream = require('stream');
const encoding = require('../internal/encoding');
const {MessagePortBase, MessagePort, once, activate} = require('./common');
const Packet = require('./packet');
const Parser = require('./parser');
const {Console} = console;
const {env, exit, stdin, stdout, stderr} = process;

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
      const port = this._ports.get(pkt.port);

      if (port) {
        port.emit('message', pkt.value);
        return;
      }

      this.emit('_packet', pkt);

      if (pkt.port === 0)
        this.emit('message', pkt.value);
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

    const stdin = new Stdin(this);
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

  _exception(err) {
    const pkt = new Packet();

    pkt.port = 3;
    pkt.value = err;

    this._write(pkt.encode());
  }

  _write(data) {
    return stdout.write(data);
  }

  _attach(id) {
    const port = new MessagePort();

    port._id = id;
    port._parent = this;

    if (port._id < 5)
      throw new Error('Message port ID collision.');

    this._ports.set(port._id, port);

    return port;
  }

  close() {
    this._exit(0);
    return this;
  }

  postMessage(value, transferList) {
    const pkt = new Packet();

    pkt.port = 0;
    pkt.value = value;

    activate(transferList, this);

    this._write(pkt.encode());

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
  constructor(parent) {
    super();

    this._parent = parent;
    this._timer = null;
    this._unrefd = false;

    parent.on('_packet', (pkt) => {
      if (pkt.port === 1) {
        if (!this._unrefd)
          this.ref();
        this.push(toBuffer(pkt.value));
      }
    });

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
    const pkt = new Packet();

    pkt.port = 2;
    pkt.value = chunk;

    this._parent._write(pkt.encode());

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
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/*
 * Expose
 */

module.exports = Parent;
