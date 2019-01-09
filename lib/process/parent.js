/*!
 * parent.js - worker processes for bthreads
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const {Console} = console;
const EventEmitter = require('events');
const stream = require('stream');
const encoding = require('../internal/encoding');
const Packet = require('./packet');
const Parser = require('./parser');
const {env, exit, stdin, stdout, stderr} = process;

/**
 * Parent
 * @extends EventEmitter
 */

class Parent extends EventEmitter {
  constructor() {
    super();

    this.parser = new Parser();
    this.env = env;
    this.exit = exit;
    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;

    this.threadId = env.BTHREADS_THREAD_ID >>> 0;
    this.workerData = encoding.parse(env.BTHREADS_WORKER_DATA);

    this._init();
  }

  _init() {
    this.on('error', () => {});

    this.stdin.on('data', (data) => {
      try {
        this.parser.feed(data);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this.stdin.unref();

    this.parser.on('error', (err) => {
      this.emit('error', err);
    });

    this.parser.on('packet', (pkt) => {
      this.emit('_packet', pkt);

      if (pkt.cmd === 0)
        this.emit('message', pkt.value);
    });

    this.stdin.on('error', (err) => {
      this.emit('error', err);
    });

    this.stdout.on('error', (err) => {
      this.emit('error', err);
    });

    this.stderr.on('error', (err) => {
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

  close() {
    this.exit(0);
    return this;
  }

  postMessage(value, transferList) {
    const pkt = new Packet();
    pkt.cmd = 0;
    pkt.port = 0;
    pkt.value = value;
    this._write(pkt.encode());
    return this;
  }

  ref() {
    this.stdin.ref();
    return this;
  }

  start() {
    return this;
  }

  unref() {
    this.stdin.unref();
    return this;
  }
}

/**
 * Stdin
 */

class Stdin extends stream.Readable {
  constructor(parent) {
    super();

    this._isStdio = true;
    this.isTTY = parent.env.BTHREADS_ISTTY0 === '1';

    parent.on('_packet', (pkt) => {
      if (pkt.cmd === 1)
        this.push(pkt.value);
    });
  }
}

/**
 * Stdout
 */

class Stdout extends stream.Writable {
  constructor(parent) {
    super();
    this._isStdio = true;
    this.isTTY = parent.env.BTHREADS_ISTTY1 === '1';
    this.parent = parent;
  }

  _write(chunk, enc, callback) {
    const pkt = new Packet();

    pkt.cmd = 2;
    pkt.port = 0;
    pkt.value = chunk;

    this.parent._write(pkt.encode());

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

    this._isStdio = true;
    this.isTTY = parent.env.BTHREADS_ISTTY2 === '1';
    this.parent = parent;
  }

  _write(chunk, enc, callback) {
    this.parent.stderr.write(chunk, enc, callback);
  }

  _destroy(err, callback) {
    this.parent.stderr.destroy(err);
    callback();
  }

  _final(callback) {
    this.parent.stderr.end(callback);
  }
}

/*
 * Expose
 */

module.exports = Parent;
