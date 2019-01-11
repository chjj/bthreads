'use strict';

const {EventEmitter} = require('events');

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
 * SocketBase
 */

class SocketBase extends EventEmitter {
  constructor() {
    super();
  }
}

/**
 * Socket
 */

class Socket extends SocketBase {
  constructor(threads, port) {
    super();

    this._threads = threads;
    this._port = port;
    this._id = 0;
    this._binds = new EventEmitter();
    this._hooks = new Map();
    this._jobs = new Map();
    this._bound = false;
    this._closed = false;
    this._init();
  }

  _init() {
    this.once('newListener', () => {
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
      job.reject(new Error('Job terminated prematurely.'));

    this._jobs.clear();
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

        this.emit('message', msg);

        break;
      }
      case types.EVENT: {
        const [, name, args] = pkt;

        if (typeof name !== 'string')
          throw new TypeError('"name" must be a string.');

        if (!Array.isArray(args))
          throw new TypeError('"args" must be an array.');

        this._binds.emit(name, ...args);

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

        let result;
        try {
          result = await func.apply(this, args);
        } catch (e) {
          this._sendError(id, e);
          return;
        }

        this._sendAck(id, result);
        break;
      }
      case types.ACK:
      case types.ERROR: {
        const [, id, result] = pkt;

        if ((id >>> 0) !== id)
          throw new TypeError('"id" must be an integer.');

        const job = this._jobs.get(id);

        if (!job)
          throw new Error('Ack received for non-existent job.');

        this._jobs.delete(id);

        if (type === types.ERROR)
          job.reject(decodeError(result));
        else
          job.resolve(result);

        break;
      }
      case types.CONNECT: {
        const [, port] = pkt;

        if (!(port instanceof this._threads.MessagePort))
          throw new TypeError('"port" must be a MessagePort.');

        this.emit('port', new PortSocket(this._threads, port));

        break;
      }
      default: {
        throw new Error('Fatal exception.');
      }
    }
  }

  start() {
    throw new Error('Abstract');
  }

  close() {
    throw new Error('Abstract');
  }

  terminate(callback) {
    throw new Error('Abstract');
  }

  bind(name, handler) {
    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    if (typeof handler !== 'function')
      throw new TypeError('"handler" must be a function.');

    this._bind();
    this._binds.on(name, handler);

    return this;
  }

  unbind(name, handler) {
    if (typeof name !== 'string')
      throw new TypeError('"name" must be a string.');

    if (typeof handler !== 'function')
      throw new TypeError('"handler" must be a function.');

    this._binds.removeListener(name, handler);

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

  async call(name, args, transferList) {
    if (args == null)
      args = [];

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
      const job = new Job(id, resolve, reject);

      this._jobs.set(id, job);
    });
  }

  connect() {
    const {port1, port2} = new this._threads.MessageChannel();

    this._bind();
    this._sendConnect(port1);

    return new PortSocket(this._threads, port2);
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
  constructor(id, resolve, reject) {
    this.id = id;
    this.resolve = resolve;
    this.reject = reject;
  }
}

/**
 * WorkerSocket
 */

class WorkerSocket extends Socket {
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
 * PortSocket
 */

class PortSocket extends Socket {
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

/*
 * Helpers
 */

function encodeError(err) {
  if (!(err instanceof Error)) {
    if (typeof err === 'string')
      err = new Error(err);
    if (err && typeof err.message === 'string')
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

  threads.Thread = SocketBase;

  threads.create = (file, options) => {
    const worker = new threads.Worker(file, options);
    return new WorkerSocket(threads, worker);
  };

  if (!threads.isMainThread)
    threads.parent = new PortSocket(threads, threads.parentPort);
}

/*
 * Expose
 */

exports.Socket = Socket;
exports.WorkerSocket = WorkerSocket;
exports.PortSocket = PortSocket;
exports.inject = inject;
