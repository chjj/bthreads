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
const {MessagePort, activate} = require('./common');
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

    this._id = uid++;
    this._child = null;
    this._parser = new Parser(this);
    this._ports = new Map();
    this._exitCode = -1;

    this.stdin = null;
    this.stdout = null;
    this.stderr = null;

    uid >>>= 0;
    bindExit();
    children.add(this);

    this._init(file, options);
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

  _init(file, options) {
    if (options.eval) {
      const filename = tmpFile();
      const code = evalScript('[worker eval]', file);
      const options = { mode: 0o600, flag: 'wx' };

      fs.writeFileSync(filename, code, options);

      file = filename;
    }

    const bin = process.execPath || process.argv[0];
    const args = (process.execArgv || []).slice();

    if (!process.env.BTHREADS_THREAD_ID) {
      // Require bthreads on boot, but make
      // sure we're not bundled or something.
      const tail = path.normalize('/lib/process/worker.js');

      if (__filename.endsWith(tail))
        args.push('-r', __dirname);
    }

    args.push(file);

    const opt = {
      stdio: 'pipe',
      env: Object.assign({}, process.env, {
        BTHREADS_THREAD_ID: this._id.toString(10),
        BTHREADS_WORKER_DATA: encoding.stringify(options.workerData),
        BTHREADS_WORKER_EVAL: options.eval ? '1' : '0'
      })
    };

    this._child = cp.spawn(bin, args, opt);

    this._child.stdin.unref();
    this._child.stdout.unref();
    this._child.stderr.unref();

    this._child.on('error', (err) => {
      this.emit('error', err);
    });

    this._child.once('exit', (code, signal) => {
      children.delete(this);

      if (options.eval) {
        try {
          fs.unlinkSync(file);
        } catch (e) {
          this.emit('error', e);
        }
      }

      if (this._exitCode !== -1)
        code = this._exitCode;

      for (const port of this._ports.values())
        port.close();

      this.emit('exit', code >>> 0, signal);
    });

    this._child.stdin.on('error', (err) => {
      this.emit('error', err);
    });

    this._child.stdout.on('error', (err) => {
      this.emit('error', err);
    });

    if (!options.stderr) {
      this._child.stderr.on('error', (err) => {
        this.emit('error', err);
      });
    }

    this._child.stdout.on('data', (data) => {
      try {
        this._parser.feed(data);
      } catch (e) {
        this.emit('error', e);
      }
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

      if (pkt.port === 3) {
        this.emit('error', pkt.value);
        this._terminate(1);
        return;
      }

      if (pkt.port === 0)
        this.emit('message', pkt.value);
    });

    if (options.stdin)
      this.stdin = new Stdin(this);

    if (options.stdout)
      this.stdout = new Stdout(this);

    if (options.stderr)
      this.stderr = this._child.stderr;

    setImmediate(() => {
      this.emit('online');
    });
  }

  _write(data) {
    return this._child.stdin.write(data);
  }

  _attach(id) {
    const port = new MessagePort();

    port._id = id;
    port._parent = this;
    port._active = true;

    if (port._id < 5)
      throw new Error('Message port ID collision.');

    this._ports.set(port._id, port);

    return port;
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
    this._child.ref();
    return this;
  }

  _terminate(code) {
    this._child.kill('SIGTERM');
    this._exitCode = code >>> 0;
    return this;
  }

  terminate(callback) {
    this._child.kill('SIGTERM');

    if (typeof callback === 'function')
      this.once('exit', code => callback(null, code));

    return this;
  }

  unref() {
    this._child.unref();
    return this;
  }
}

/**
 * Stdin
 */

class Stdin extends stream.Writable {
  constructor(parent) {
    super();
    this._parent = parent;
  }

  _write(chunk, enc, callback) {
    const pkt = new Packet();

    pkt.port = 1;
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
 * Stdout
 */

class Stdout extends stream.Readable {
  constructor(parent) {
    super();

    this._parent = parent;

    parent.on('_packet', (pkt) => {
      if (pkt.port === 2)
        this.push(toBuffer(pkt.value));
    });
  }

  _read(size) {}
}

/*
 * Helpers
 */

function toBuffer(value) {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function tmpFile() {
  const x = (Math.random() * 0x100000000) >>> 0;
  const y = (Math.random() * 0x100000000) >>> 0;
  const z = x.toString(32) + y.toString(32);
  const name = `worker-${z}.js`;

  return path.resolve(os.tmpdir(), name);
}

function evalScript(name, body) {
  const cwd = process.cwd();
  const file = path.join(cwd, name);
  const paths = [];

  let dir = cwd;

  for (;;) {
    if (path.basename(dir) !== 'node_modules')
      paths.push(path.join(dir, 'node_modules'));

    const next = path.resolve(dir, '..');

    if (next === dir)
      break;

    dir = next;
  }

  // See: internal/bootstrap/node.js
  return ''
    + '__dirname = ".";'
    + `__filename = ${JSON.stringify(name)};`
    + `module.id = ${JSON.stringify(name)};`
    + `module.filename = ${JSON.stringify(file)};`
    + 'module.paths.length = 0;'
    + `module.paths.push(...${JSON.stringify(paths)});`
    + 'require.main = null;'
    + 'global.__dirname = __dirname;'
    + 'global.__filename = __filename;'
    + 'global.exports = exports;'
    + 'global.module = module;'
    + 'global.require = require;'
    + 'return require("vm").runInThisContext('
    + `${JSON.stringify(body)}, { filename: `
    + `${JSON.stringify(name)}, displayErrors: true });`;
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
