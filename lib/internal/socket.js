'use strict';

/* global Blob, File, FileList, ImageData, SharedArrayBuffer */

const {EventEmitter} = require('events');
const os = require('os');

/*
 * Constants
 */

const types = {
  MESSAGE: 0,
  EVENT: 1,
  CALL: 2,
  ACK: 3,
  ERROR: 4,
  CONNECT: 5,
  MAX_TYPE: 5
};

/**
 * Socket
 */

class Socket extends EventEmitter {
  constructor(threads, port) {
    super();

    this._threads = threads;
    this._port = port;
    this._id = 0;
    this._hooks = new Map();
    this._jobs = new Map();
    this._bound = false;
    this._closed = false;

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

    for (const job of this._jobs.values())
      job.destroy();
  }

  _next() {
    const id = this._id;

    this._id += 1;
    this._id >>>= 0;

    return id;
  }

  _send(pkt, transferList) {
    if (this._closed)
      throw new Error('Port is closed.');

    if (transferList === null)
      transferList = undefined;

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

  _sendConnect(port) {
    this._send([types.CONNECT, port, null, null], [port]);
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

        this.emit('message', this._bufferize(msg));

        break;
      }
      case types.EVENT: {
        const [, name, args] = pkt;

        if (typeof name !== 'string')
          throw new TypeError('"name" must be a string.');

        if (!Array.isArray(args))
          throw new TypeError('"args" must be an array.');

        this._bufferize(args);
        this.events.emit(name, ...args);
        this.emit('event', name, args);

        break;
      }
      case types.CALL: {
        const [, id, name, args] = pkt;

        if (typeof name !== 'string')
          throw new TypeError('"name" must be a string.');

        if (!Array.isArray(args))
          throw new TypeError('"args" must be an array.');

        const func = this._hooks.get(name);

        if (!func)
          throw new Error('Call received for non-existent hook.');

        this._bufferize(args);

        let items;
        try {
          items = await func.apply(this, args);
        } catch (e) {
          this._sendError(id, e);
          return;
        }

        if (!Array.isArray(items)) {
          this._sendAck(id, items, undefined);
          break;
        }

        let result;
        let list;

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
          job.resolve(this._bufferize(result));

        break;
      }
      case types.CONNECT: {
        const [, port] = pkt;

        if (!(port instanceof this._threads.MessagePort))
          throw new TypeError('"port" must be a MessagePort.');

        this.emit('port', new Port(this._threads, port));

        break;
      }
      default: {
        throw new Error('Fatal exception.');
      }
    }
  }

  _bufferize(value) {
    return this._walk(value, null);
  }

  _walk(value, seen) {
    if (value === null || typeof value !== 'object')
      return value;

    if (Buffer.isBuffer(value))
      return value;

    if (ArrayBuffer.isView(value)) {
      if (value instanceof Uint8Array) {
        return Buffer.from(value.buffer,
                           value.byteOffset,
                           value.byteLength);
      }
      return value;
    }

    if (value instanceof Error)
      return value;

    if (value instanceof RegExp)
      return value;

    if (value instanceof Date)
      return value;

    if (value instanceof Promise)
      return value;

    // Todo: figure out how to do this one.
    // if (value instanceof Proxy)
    //   return value;

    if (value instanceof ArrayBuffer)
      return value;

    if (typeof SharedArrayBuffer === 'function') {
      if (value instanceof SharedArrayBuffer)
        return value;
    }

    if (typeof Blob === 'function') {
      if (value instanceof Blob)
        return value;
    }

    if (typeof File === 'function') {
      if (value instanceof File)
        return value;
    }

    if (typeof FileList === 'function') {
      if (value instanceof FileList)
        return value;
    }

    if (typeof ImageData === 'function') {
      if (value instanceof ImageData)
        return value;
    }

    if (value instanceof this._threads.MessagePort)
      return value;

    if (!seen)
      seen = new Set();

    if (seen.has(value))
      return value;

    if (Array.isArray(value)) {
      seen.add(value);

      for (let i = 0; i < value.length; i++)
        value[i] = this._walk(value[i], seen);

      seen.delete(value);

      return value;
    }

    if (value instanceof Map) {
      const added = [];

      seen.add(value);

      for (const [key, val] of value) {
        const k = this._walk(key, seen);
        const v = this._walk(val, seen);

        if (k !== key) {
          value.delete(key);
          added.push([k, v]);
        } else if (v !== val) {
          value.set(k, v);
        }
      }

      for (const [k, v] of added)
        value.set(k, v);

      seen.delete(value);

      return value;
    }

    if (value instanceof Set) {
      const added = [];

      seen.add(value);

      for (const key of value) {
        const k = this._walk(key, seen);

        if (k !== key) {
          value.delete(key);
          added.push(k);
        }
      }

      for (const k of added)
        value.add(k);

      seen.delete(value);

      return value;
    }

    seen.add(value);

    for (const key of Object.keys(value)) {
      const val = value[key];
      const v = this._walk(val, seen);

      if (v !== val)
        value[key] = v;
    }

    seen.delete(value);

    return value;
  }

  start() {
    throw new Error('Abstract method.');
  }

  close() {
    throw new Error('Abstract method.');
  }

  terminate(callback) {
    throw new Error('Abstract method.');
  }

  bind(name, handler) {
    this.events.on(name, handler);
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

  connect(port) {
    if (!(port instanceof Port))
      throw new Error('"port" must be a Port.');

    this._bind();
    this._sendConnect(port._port);

    return this;
  }

  ref() {
    this._port.ref();
    return this;
  }

  unref() {
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
  }

  get stdin() {
    return this._port.stdin;
  }

  get stdout() {
    return this._port.stdout;
  }

  get stderr() {
    return this._port.stderr;
  }

  get threadId() {
    return this._port.threadId;
  }

  start() {
    this._bind();
    return this;
  }

  close() {
    this._port.terminate();
    return this;
  }

  terminate(callback) {
    this._port.terminate(callback);
    return this;
  }

  _bind() {
    if (!super._bind())
      return false;

    this._port.on('exit', (code) => {
      this._close();
      this.emit('close');
      this.emit('exit', code);
    });

    this._port.on('online', () => {
      this.emit('online');
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

  terminate(callback) {
    this._port.close();

    if (typeof callback === 'function')
      setImmediate(callback);

    return this;
  }

  _bind() {
    if (!super._bind())
      return false;

    this._port.on('close', () => {
      this._close();
      this.emit('close');
      this.emit('exit', 0);
    });

    setImmediate(() => {
      this.emit('online');
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

    super();

    this._threads = threads;
    this._map = new Map();
    this._uid = 0;
    this._hooks = new Map();
    this._encoding = null;
    this._ref = true;
    this._closed = false;

    this.file = file;
    this.options = Object.assign({}, options);
    this.size = (options.size >>> 0) || getCores();
    this.events = new EventEmitter();
  }

  _spawn(id) {
    const thread = new this._threads.Thread(this.file, this.options);

    if (!this._ref)
      thread.unref();

    thread.events = this.events;
    thread._hooks = this._hooks;

    thread.on('error', (err) => {
      this.emit('error', err, thread);
    });

    thread.on('message', (msg) => {
      this.emit('message', msg, thread);
    });

    thread.on('port', (port) => {
      this.emit('port', port, thread);
    });

    thread.on('close', () => {
      this.emit('close', thread);
    });

    thread.on('exit', (code) => {
      this.emit('exit', code, thread);

      if (this._map.get(id) === thread)
        this._map.delete(id);
    });

    thread.on('online', () => {
      this.emit('online', thread);
    });

    thread.on('event', (name, args) => {
      this.emit('event', name, args, thread);
    });

    if (this.options.stdin) {
      thread.stdin.on('error', (err) => {
        this.emit('error', err, thread);
      });
    }

    if (this.options.stdout) {
      if (this._encoding)
        thread.stdout.setEncoding(this._encoding);

      thread.stdout.on('error', (err) => {
        this.emit('error', err, thread);
      });

      thread.stdout.on('data', (data) => {
        this.emit('stdout', data, thread);
        this.emit('data', data, 'stdout', thread);
      });
    }

    if (this.options.stderr) {
      if (this._encoding)
        thread.stderr.setEncoding(this._encoding);

      thread.stderr.on('error', (err) => {
        this.emit('error', err, thread);
      });

      thread.stderr.on('data', (data) => {
        this.emit('stderr', data, thread);
        this.emit('data', data, 'stderr', thread);
      });
    }

    return thread;
  }

  _alloc() {
    if (this._closed)
      throw new Error('Port is closed.');

    const id = this._uid % this.size;

    this.uid += 1;
    this.uid >>>= 0;

    if (!this._map.has(id))
      this._map.set(id, this._spawn(id));

    return this._map.get(id);
  }

  start() {
    return this;
  }

  stop() {
    return this.terminate();
  }

  terminate() {
    for (const thread of this._map.values())
      thread.terminate();

    this._closed = true;

    return this;
  }

  bind(name, handler) {
    this.events.on(name, handler);
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

  fire() {
    if (this._closed)
      throw new Error('Port is closed.');

    for (const thread of this._map.values())
      thread.fire.apply(thread, arguments);
  }

  async call(name, args, transferList, timeout) {
    const thread = this._alloc();
    return thread.call(name, args, transferList, timeout);
  }

  connect(port) {
    this._alloc().connect(port);
    return this;
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

  write() {
    if (!this.options.stdin)
      throw new Error('"stdin" is not enabled.');

    if (this._closed)
      throw new Error('Port is closed.');

    let result = true;

    for (const thread of this._map.values()) {
      if (!thread.stdin.write.apply(thread, arguments))
        result = false;
    }

    return result;
  }

  setEncoding(enc) {
    if (enc != null && typeof enc !== 'string')
      throw new TypeError('"enc" must be a string.');

    if (!this.options.stdout && !this.options.stderr)
      throw new Error('"stdout" and "stderr" are not enabled.');

    if (this._closed)
      throw new Error('Port is closed.');

    this._encoding = enc;

    for (const thread of this._map.values()) {
      if (this.options.stdout)
        thread.stdout.setEncoding(enc);

      if (this.options.stderr)
        thread.stderr.setEncoding(enc);
    }

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

  return [
    String(err.message),
    String(err.name),
    err.type != null ? err.type : undefined,
    err.code != null ? err.code : undefined,
    String(err.stack)
  ];
}

function decodeError(items) {
  if (!Array.isArray(items) || items.length !== 5)
    throw new TypeError('"err" must be an error.');

  const [message, name, type, code, stack] = items;
  const err = new Error(message);

  err.name = name;

  if (type !== undefined)
    err.type = type;

  if (code !== undefined)
    err.code = code;

  err.stack = stack;

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
