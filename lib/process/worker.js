/*!
 * worker.js - worker processes for bthreads
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const cp = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stream = require('stream');
const encoding = require('../internal/encoding');
const Packet = require('./packet');
const Parser = require('./parser');

/*
 * Constants
 */

const children = new Set();

let uid = 0;
let exitBound = false;

/**
 * Worker
 * @extends EventEmitter
 */

class Worker extends EventEmitter {
  constructor(file, options) {
    super();

    if (options == null)
      options = Object.create(null);

    if (typeof file !== 'string')
      throw new TypeError('"file" must be a string.');

    if (typeof options !== 'object')
      throw new TypeError('"options" must be an object.');

    this.id = uid++;
    this.child = null;
    this.parser = new Parser();
    this.stdin = null;
    this.stdout = null;
    this.stderr = null;

    uid >>>= 0;
    bindExit();
    children.add(this);

    this._init(file, options);
  }

  _init(file, options) {
    const bin = process.argv[0];

    if (options.eval) {
      const code = file;

      file = tmpFile();
      fs.writeFileSync(file, code, { mode: 0o600, flag: 'wx' });

      setTimeout(() => {
        try {
          fs.unlinkSync(file);
        } catch (e) {
          this.emit('error', e);
        }
      }, 10000).unref();
    }

    const opt = {
      stdio: 'pipe',
      env: Object.assign({}, process.env, {
        BTHREADS_THREAD_ID: this.id.toString(10),
        BTHREADS_WORKER_DATA: encoding.stringify(options.workerData),
        BTHREADS_ISTTY0: process.stdin.isTTY ? '1' : '0',
        BTHREADS_ISTTY1: process.stdout.isTTY ? '1' : '0',
        BTHREADS_ISTTY2: process.stderr.isTTY ? '1' : '0'
      })
    };

    this.child = cp.spawn(bin, [file], opt);

    this.child.stdin.unref();
    this.child.stdout.unref();
    this.child.stderr.unref();

    this.child.on('error', (err) => {
      this.emit('error', err);
    });

    this.child.once('exit', (code, signal) => {
      children.delete(this);
      this.emit('exit', code >>> 0, signal);
    });

    this.child.stdin.on('error', (err) => {
      this.emit('error', err);
    });

    this.child.stdout.on('error', (err) => {
      this.emit('error', err);
    });

    if (!options.stderr) {
      this.child.stderr.on('error', (err) => {
        this.emit('error', err);
      });
    }

    this.child.stdout.on('data', (data) => {
      try {
        this.parser.feed(data);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this.parser.on('error', (err) => {
      this.emit('error', err);
    });

    this.parser.on('packet', (pkt) => {
      this.emit('_packet', pkt);

      if (pkt.cmd === 3) {
        this.emit('error', pkt.value);
        this.terminate();
        return;
      }

      if (pkt.cmd === 0)
        this.emit('message', pkt.value);
    });

    if (options.stdin)
      this.stdin = new Stdin(this);

    if (options.stdout)
      this.stdout = new Stdout(this);

    if (options.stderr)
      this.stderr = this.child.stderr;

    setImmediate(() => {
      this.emit('online');
    });
  }

  _write(data) {
    return this.child.stdin.write(data);
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
    this.child.ref();
    return this;
  }

  terminate(callback) {
    this.child.kill('SIGTERM');

    if (typeof callback === 'function')
      this.once('exit', code => callback(null, code));

    return this;
  }

  unref() {
    this.child.unref();
    return this;
  }
}

/**
 * Stdin
 */

class Stdin extends stream.Writable {
  constructor(parent) {
    super();
    this.parent = parent;
  }

  _write(chunk, enc, callback) {
    const pkt = new Packet();

    pkt.cmd = 1;
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
 * Stdout
 */

class Stdout extends stream.Readable {
  constructor(parent) {
    super();

    parent.on('_packet', (pkt) => {
      if (pkt.cmd === 2)
        this.push(pkt.value);
    });
  }
}

/*
 * Helpers
 */

function tmpFile() {
  const x = (Math.random() * 0x100000000) >>> 0;
  const y = (Math.random() * 0x100000000) >>> 0;
  const z = x.toString(32) + y.toString(32);
  const name = `worker-${z}.js`;

  return path.resolve(os.tmpdir(), name);
}

function bindExit() {
  if (exitBound)
    return;

  exitBound = true;

  listenExit(() => {
    for (const child of children)
      child.terminate();
  });
}

function listenExit(handler) {
  const onSighup = () => {
    process.exit(1 | 0x80);
  };

  const onSigint = () => {
    process.exit(2 | 0x80);
  };

  const onSigterm = () => {
    process.exit(15 | 0x80);
  };

  const onError = (err) => {
    if (err && err.stack)
      console.error(String(err.stack));
    else
      console.error(String(err));

    process.exit(1);
  };

  process.once('exit', handler);

  if (process.listenerCount('SIGHUP') === 0)
    process.once('SIGHUP', onSighup);

  if (process.listenerCount('SIGINT') === 0)
    process.once('SIGINT', onSigint);

  if (process.listenerCount('SIGTERM') === 0)
    process.once('SIGTERM', onSigterm);

  if (process.listenerCount('uncaughtException') === 0)
    process.once('uncaughtException', onError);

  if (process.listenerCount('unhandledRejection') === 0)
    process.once('unhandledRejection', onError);

  process.on('newListener', (name) => {
    switch (name) {
      case 'SIGHUP':
        process.removeListener(name, onSighup);
        break;
      case 'SIGINT':
        process.removeListener(name, onSigint);
        break;
      case 'SIGTERM':
        process.removeListener(name, onSigterm);
        break;
      case 'uncaughtException':
        process.removeListener(name, onError);
        break;
      case 'unhandledRejection':
        process.removeListener(name, onError);
        break;
    }
  });
}

/*
 * Expose
 */

module.exports = Worker;
