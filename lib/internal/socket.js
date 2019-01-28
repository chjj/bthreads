/*!
 * socket.js - bsock-like api for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const {EventEmitter} = require('events');
const os = require('os');
const clone = require('./clone');

/*
 * Constants
 */

const types = {
  MESSAGE: 0,
  EVENT: 1,
  CALL: 2,
  ACK: 3,
  ERROR: 4,
  MAX_TYPE: 4
};

const blacklist = new Set([
  'error',
  'newListener',
  'removeListener'
]);

/**
 * Cloner
 */

class Cloner extends clone.Cloner {
  isPort(value, threads) {
    return value instanceof Port;
  }

  toPort(value, threads) {
    return value._port;
  }
}

/**
 * Uncloner
 */

class Uncloner extends clone.Uncloner {
  transform(value, threads) {
    if (value instanceof Uint8Array) {
      return Buffer.from(value.buffer,
                         value.byteOffset,
                         value.byteLength);
    }

    return value;
  }

  isPort(value, threads) {
    return value instanceof threads.MessagePort;
  }

  toPort(value, threads) {
    return new Port(threads, value);
  }
}

/**
 * Socket
 */

class Socket extends EventEmitter {
  constructor(threads, port) {
    super();

    this._threads = threads;
    this._port = port;
    this._uid = 0;
    this._hooks = new Map();
    this._jobs = new Map();
    this._bound = false;
    this._closed = false;
    this._ref = false;
    this._pooled = false;

    this.events = new EventEmitter();

    this._init();
  }

  _init() {
    this.once('newListener', () => {
      this._bind();
    });

    this.events.once('newListener', () => {
      this._bind();
    });
  }

  _bind() {
    if (this._bound)
      return false;

    this._bound = true;
    this._ref = true;

    this._port.on('message', async (pkt) => {
      try {
        await this._handle(pkt);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this._port.on('error', (err) => {
      this.emit('error', err);
    });

    return true;
  }

  _close() {
    this._closed = true;
    this._ref = false;

    for (const job of this._jobs.values())
      job.destroy();
  }

  _dispose() {
    this.removeAllListeners();

    if (!this._pooled) {
      this.events.removeAllListeners();
      this._hooks.clear();
    }
  }

  _next() {
    const id = this._uid;

    this._uid += 1;
    this._uid >>>= 0;

    return id;
  }

  _morph(value, transferList) {
    return Cloner.morph(value, transferList, this._threads);
  }

  _unclone(value) {
    return Uncloner.unclone(value, this._threads);
  }

  _send(pkt, transferList) {
    if (this._closed)
      throw new Error('Port is closed.');

    if (transferList == null)
      transferList = undefined;
    else
      [pkt, transferList] = this._morph(pkt, transferList);

    this._port.postMessage(pkt, transferList);
  }

  _sendMessage(msg, transferList) {
    this._send([types.MESSAGE, msg, null, null], transferList);
  }

  _sendEvent(name, args, transferList) {
    this._send([types.EVENT, name, args, null], transferList);
  }

  _sendCall(id, name, args, transferList) {
    this._send([types.CALL, id, name, args], transferList);
  }

  _sendAck(id, result, transferList) {
    this._send([types.ACK, id, result, null], transferList);
  }

  _sendError(id, err, transferList) {
    this._send([types.ERROR, id, encodeError(err), null], transferList);
  }

  async _handle(pkt) {
    if (!Array.isArray(pkt) || pkt.length !== 4)
      throw new TypeError('Packet is not an array.');

    const [type] = pkt;

    if ((type >>> 0) !== type || type > types.MAX_TYPE)
      throw new RangeError('Packet type is invalid.');

    switch (type) {
      case types.MESSAGE: {
        const [, msg] = pkt;

        this.emit('message', this._unclone(msg));

        break;
      }
      case types.EVENT: {
        const [, name, args] = pkt;

        if (typeof name !== 'string')
          throw new TypeError('"name" must be a string.');

        if (!Array.isArray(args))
          throw new TypeError('"args" must be an array.');

        this._unclone(args);
        this.events.emit(name, ...args);
        this.emit('event', name, args);

        break;
      }
      case types.CALL: {
        let [, id, name, args] = pkt;

        id >>>= 0;

        try {
          await this._handleCall(id, name, args);
        } catch (e) {
          this._sendError(id, e);
        }

        break;
      }
      case types.ACK:
      case types.ERROR: {
        const [, id, result] = pkt;

        if ((id >>> 0) !== id)
          throw new TypeError('"id" must be an integer.');

        const job = this._jobs.get(id);

        if (!job)
          throw new Error(`Job ${id} is not in progress.`);

        if (type === types.ERROR)
          job.reject(decodeError(result));
        else
          job.resolve(this._unclone(result));

        break;
      }
      default: {
        throw new Error('Fatal exception.');
      }
    }
  }

  async _handleCall(id, name, args) {
    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    if (!Array.isArray(args))
      throw new TypeError('"args" must be an array.');

    const func = this._hooks.get(name);

    if (!func)
      throw new Error(`Hook does not exist: "${name}".`);

    this._unclone(args);

    const items = await func(...args);

    if (!Array.isArray(items)) {
      this._sendAck(id, items, undefined);
      return;
    }

    let result, list;

    switch (items.length) {
      case 2:
        list = items[1];
      case 1:
        result = items[0];
      case 0:
        break;
      default:
        throw resultError();
    }

    if (list != null && !Array.isArray(list))
      throw resultError();

    this._sendAck(id, result, list);
  }

  bind(name, handler) {
    if (blacklist.has(name))
      throw new Error(`Cannot bind blacklisted event: "${name}".`);

    this.events.addListener(name, handler);

    return this;
  }

  unbind(name, handler) {
    this.events.removeListener(name, handler);
    return this;
  }

  hook(name, handler) {
    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    if (typeof handler !== 'function')
      throw new TypeError('"handler" must be a function.');

    if (this._hooks.has(name))
      throw new Error(`Hook "${name}" already exists.`);

    this._bind();
    this._hooks.set(name, handler);

    return this;
  }

  unhook(name) {
    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    this._hooks.delete(name);

    return this;
  }

  send(msg, transferList) {
    this._bind();
    this._sendMessage(msg, transferList);
    return this;
  }

  fire(name, args, transferList) {
    if (args == null)
      args = [];

    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    if (!Array.isArray(args))
      throw new TypeError('"args" must be an array.');

    this._bind();
    this._sendEvent(name, args, transferList);

    return this;
  }

  async call(name, args, transferList, timeout) {
    if (args == null)
      args = [];

    if (timeout == null)
      timeout = 0;

    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    if (!Array.isArray(args))
      throw new TypeError('"args" must be an array.');

    this._bind();

    const id = this._next();

    if (this._jobs.has(id))
      throw new Error('Job ID collision.');

    this._sendCall(id, name, args, transferList);

    return new Promise((resolve, reject) => {
      const job = new Job(this, id, resolve, reject);

      this._jobs.set(id, job);

      job.start(timeout);
    });
  }

  hasRef() {
    return this._ref;
  }

  ref() {
    if (this._closed)
      return this;
    this._ref = true;
    this._port.ref();
    return this;
  }

  unref() {
    if (this._closed)
      return this;
    this._ref = false;
    this._port.unref();
    return this;
  }
}

/**
 * Job
 */

class Job {
  constructor(port, id, resolve, reject) {
    this.port = port;
    this.id = id;
    this.job = { resolve, reject };
    this.timer = null;
  }

  start(timeout) {
    timeout |= 0;

    if (timeout <= 0)
      return;

    this.timer = setTimeout(() => {
      this.reject(new Error('Job timed out.'));
    }, timeout);
  }

  destroy() {
    this.reject(new Error('Job was destroyed.'));
  }

  cleanup() {
    const job = this.job;

    if (!job)
      throw new Error('Job already finished.');

    this.job = null;

    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.port._jobs.has(this.id))
      throw new Error('Job already cleaned up.');

    this.port._jobs.delete(this.id);

    return job;
  }

  resolve(result) {
    const job = this.cleanup();
    job.resolve(result);
  }

  reject(err) {
    const job = this.cleanup();
    job.reject(err);
  }
}

/**
 * ThreadBase
 */

class ThreadBase extends Socket {
  constructor(threads, worker) {
    if (!(worker instanceof threads.Worker))
      throw new TypeError('"worker" must be a Worker.');

    super(threads, worker);

    this._threadId = worker.threadId;
  }

  get stdin() {
    if (this._closed)
      return null;
    return this._port.stdin;
  }

  get stdout() {
    if (this._closed)
      return null;
    return this._port.stdout;
  }

  get stderr() {
    if (this._closed)
      return null;
    return this._port.stderr;
  }

  get threadId() {
    return this._threadId;
  }

  terminate(callback) {
    if (callback != null && typeof callback !== 'function')
      throw new TypeError('"callback" must be a function.');

    if (this._closed) {
      if (callback)
        setImmediate(() => callback(null, 0));
    } else {
      this._port.terminate(callback);
    }

    return this;
  }

  async close() {
    if (this._closed)
      return 0;

    return new Promise((resolve, reject) => {
      let onExit, onError;

      const cleanup = () => {
        this.removeListener('close', onExit);
        this.removeListener('error', onError);
      };

      onExit = (code) => {
        cleanup();
        resolve(code);
      };

      onError = (err) => {
        cleanup();
        reject(err);
      };

      this.on('exit', onExit);
      this.on('error', onError);

      try {
        this.terminate();
      } catch (e) {
        onError(e);
      }
    });
  }

  _bind() {
    if (!super._bind())
      return false;

    this._port.on('online', () => {
      this.emit('online');
    });

    this._port.on('exit', (code) => {
      this._close();
      this.emit('exit', code);
      this._dispose();
    });

    return true;
  }
}

/**
 * Port
 */

class Port extends Socket {
  constructor(threads, port) {
    if (!(port instanceof threads.MessagePort))
      throw new TypeError('"port" must be a MessagePort.');

    super(threads, port);
  }

  start() {
    this._bind();
    this._port.start();
    return this;
  }

  close() {
    this._port.close();
    return this;
  }

  _bind() {
    if (!super._bind())
      return false;

    this._port.on('close', () => {
      this._close();
      this.emit('close');
      this._dispose();
    });

    return true;
  }
}

/**
 * ChannelBase
 */

class ChannelBase {
  constructor(threads) {
    const {port1, port2} = new threads.MessageChannel();

    this.port1 = new Port(threads, port1);
    this.port2 = new Port(threads, port2);
  }
}

/**
 * PoolBase
 */

class PoolBase extends EventEmitter {
  constructor(threads, file, options) {
    if (options == null)
      options = {};

    if (typeof file !== 'string' && typeof file !== 'function')
      throw new TypeError('"file" must be a string.');

    if (typeof options !== 'object')
      throw new TypeError('"options" must be an object.');

    if (options.size != null && (options.size >>> 0) !== options.size)
      throw new TypeError('"size" must be a positive integer.');

    super();

    this._threads = threads;
    this._map = new Map();
    this._uid = 0;
    this._hooks = new Map();
    this._ref = true;

    this.file = file;
    this.options = Object.assign({}, options);
    this.size = options.size || getCores();
    this.events = new EventEmitter();
    this.threads = new Set();

    delete this.options.size;
  }

  _spawn(id) {
    const thread = new this._threads.Thread(this.file, this.options);

    if (!this._ref)
      thread.unref();

    thread.events = this.events;
    thread._hooks = this._hooks;
    thread._pooled = true;

    thread.on('message', (msg) => {
      this.emit('message', msg, thread);
    });

    thread.on('error', (err) => {
      this.emit('error', err, thread);
    });

    thread.on('event', (name, args) => {
      this.emit('event', name, args, thread);
    });

    thread.on('online', () => {
      this.emit('online', thread);
    });

    thread.on('exit', (code) => {
      if (this._map.get(id) === thread)
        this._map.delete(id);

      this.threads.delete(thread);

      this.emit('exit', code, thread);
    });

    if (this.options.stdin) {
      thread.stdin.on('error', (err) => {
        this.emit('error', err, thread);
      });
    }

    thread.stdout.on('error', (err) => {
      this.emit('error', err, thread);
    });

    thread.stderr.on('error', (err) => {
      this.emit('error', err, thread);
    });

    this.emit('spawn', thread);

    return thread;
  }

  open() {
    const len = this.size - this._map.size;

    for (let i = 0; i < len; i++)
      this.next();
  }

  async close() {
    const threads = [...this._map.values()];
    const jobs = threads.map(t => t.close());

    return Promise.all(jobs);
  }

  next() {
    const id = this._uid % this.size;

    this._uid += 1;
    this._uid >>>= 0;

    if (!this._map.has(id)) {
      const thread = this._spawn(id);
      this._map.set(id, thread);
      this.threads.add(thread);
    }

    return this._map.get(id);
  }

  terminate(callback) {
    if (callback != null && typeof callback !== 'function')
      throw new TypeError('"callback" must be a function.');

    if (callback) {
      let pending = this._map.size;

      if (pending === 0) {
        setImmediate(() => callback());
        return this;
      }

      const cb = callback;

      callback = () => {
        if (--pending === 0)
          cb();
      };
    }

    for (const thread of this._map.values())
      thread.terminate(callback);

    return this;
  }

  bind(name, handler) {
    if (blacklist.has(name))
      throw new Error(`Cannot bind blacklisted event: "${name}".`);

    this.events.addListener(name, handler);

    return this;
  }

  unbind(name, handler) {
    this.events.removeListener(name, handler);
    return this;
  }

  hook(name, handler) {
    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    if (typeof handler !== 'function')
      throw new TypeError('"handler" must be a function.');

    if (this._hooks.has(name))
      throw new Error(`Hook "${name}" already exists.`);

    this._hooks.set(name, handler);

    return this;
  }

  unhook(name) {
    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    this._hooks.delete(name);

    return this;
  }

  send(msg) {
    this.open();

    for (const thread of this._map.values())
      thread.send(msg);

    return this;
  }

  fire(name, args) {
    this.open();

    for (const thread of this._map.values())
      thread.fire(name, args);

    return this;
  }

  async call(name, args, transferList, timeout) {
    const thread = this.next();
    return thread.call(name, args, transferList, timeout);
  }

  hasRef() {
    return this._ref;
  }

  ref() {
    this._ref = true;

    for (const thread of this._map.values())
      thread.ref();

    return this;
  }

  unref() {
    this._ref = false;

    for (const thread of this._map.values())
      thread.unref();

    return this;
  }
}

/*
 * Helpers
 */

function getCores() {
  return Math.max(2, os.cpus().length);
}

/*
 * Helpers
 */

function encodeError(err) {
  if (!(err instanceof Error)) {
    if (typeof err === 'string')
      err = new Error(err);
    else if (err && typeof err.message === 'string')
      err = new Error(err.message);
    else
      err = new Error();
  }

  const values = [];

  for (const key of Object.keys(err)) {
    if (key === 'name'
        || key === 'message'
        || key === 'stack') {
      continue;
    }

    const value = err[key];

    if (value !== null && typeof value === 'object')
      continue;

    if (typeof value === 'function')
      continue;

    if (typeof value === 'symbol')
      continue;

    values.push([key, value]);
  }

  return [
    String(err.name),
    String(err.message),
    String(err.stack),
    values
  ];
}

function decodeError(items) {
  if (!Array.isArray(items) || items.length !== 4)
    throw new TypeError('"items" must be an array.');

  const [name, message, stack, values] = items;

  let ErrorType = Error;

  switch (name) {
    case 'EvalError':
      ErrorType = EvalError;
      break;
    case 'RangeError':
      ErrorType = RangeError;
      break;
    case 'ReferenceError':
      ErrorType = ReferenceError;
      break;
    case 'SyntaxError':
      ErrorType = SyntaxError;
      break;
    case 'TypeError':
      ErrorType = TypeError;
      break;
    case 'URIError':
      ErrorType = URIError;
      break;
  }

  const err = new ErrorType(message);

  err.name = name;
  err.stack = stack;

  for (const [key, value] of values)
    err[key] = value;

  return err;
}

function resultError() {
  const err = TypeError('Call result must be in the '
                      + 'form of [result, transferList].');

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, resultError);

  return err;
}

/*
 * API
 */

function inject(threads) {
  if (threads == null || typeof threads !== 'object')
    throw new TypeError('"threads" must be an object.');

  if (typeof threads.Worker !== 'function'
      || typeof threads.MessagePort !== 'function'
      || typeof threads.MessageChannel !== 'function') {
    throw new TypeError('Invalid worker backend.');
  }

  threads.Thread = class Thread extends ThreadBase {
    constructor(file, options) {
      if (typeof file === 'function') {
        if (options == null)
          options = { eval: true };

        if (typeof options !== 'object')
          throw new TypeError('"options" must be an object.');

        if (!options.eval) {
          options = Object.assign({}, options);
          options.eval = true;
        }

        file = `(${file}).call(this);`;
      }

      super(threads, new threads.Worker(file, options));
    }
  };

  threads.Port = Port;

  threads.Channel = class Channel extends ChannelBase {
    constructor() {
      super(threads);
    }
  };

  threads.Pool = class Pool extends PoolBase {
    constructor(file, options) {
      super(threads, file, options);
    }
  };

  if (!threads.isMainThread)
    threads.parent = new Port(threads, threads.parentPort);
}

/*
 * Expose
 */

exports.inject = inject;
