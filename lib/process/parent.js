/*!
 * parent.js - worker processes for bthreads
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const EventEmitter = require('events');
const stream = require('stream');
const encoding = require('../internal/encoding');
const {MessagePort, activate} = require('./common');
const Packet = require('./packet');
const Parser = require('./parser');
const {Console} = console;
const {env, exit, stdin, stdout, stderr} = process;

/**
 * Parent
 * @extends EventEmitter
 */

class Parent extends EventEmitter {
  constructor() {
    super();

    this._threadId = env.BTHREADS_THREAD_ID >>> 0;
    this._workerData = null;
    this._parser = new Parser();
    this._env = env;
    this._exit = exit;
    this._stdin = stdin;
    this._stdout = stdout;
    this._stderr = stderr;
    this._ports = new Map();

    this._init();
  }

  _init() {
    this.on('error', () => {});

    this._workerData = encoding.parse(env.BTHREADS_WORKER_DATA, this);

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

      if (pkt.cmd === 0)
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
        err = new Error(err);

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

    Object.defineProperty(process, 'stdin', { value: stdin });
    Object.defineProperty(process, 'stdout', { value: stdout });
    Object.defineProperty(process, 'stderr', { value: stderr });

    global.console = new Console(stdout, stderr);
  }

  _exception(err) {
    const pkt = new Packet();

    pkt.cmd = 3;
    pkt.port = 0;
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

    this._ports.set(port._id, port);

    return port;
  }

  close() {
    this._exit(0);
    return this;
  }

  postMessage(value, transferList) {
    const pkt = new Packet();

    pkt.cmd = 0;
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
    this._isStdio = true;

    this.isTTY = parent._env.BTHREADS_ISTTY0 === '1';

    parent.on('_packet', (pkt) => {
      if (pkt.cmd === 1)
        this.push(toBuffer(pkt.value));
    });
  }
}

/**
 * Stdout
 */

class Stdout extends stream.Writable {
  constructor(parent) {
    super();

    this._parent = parent;
    this._isStdio = true;

    this.isTTY = parent._env.BTHREADS_ISTTY1 === '1';
  }

  _write(chunk, enc, callback) {
    const pkt = new Packet();

    pkt.cmd = 2;
    pkt.port = 0;
    pkt.value = chunk;

    this._parent._write(pkt.encode());

    callback();
  }

  _destroy(err, callback) {
    callback(err);
  }

  _final(callback) {
    callback();
  }
}

/**
 * Stderr
 */

class Stderr extends stream.Writable {
  constructor(parent) {
    super();

    this._parent = parent;
    this._isStdio = true;

    this.isTTY = parent._env.BTHREADS_ISTTY2 === '1';
  }

  _write(chunk, enc, callback) {
    this._parent._stderr.write(chunk, enc, callback);
  }

  _destroy(err, callback) {
    this._parent._stderr.destroy(err);
    callback();
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
