/*!
 * polyfill.js - web worker polyfill for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
 */

/* global __bthreads_polyfill_scope, XMLHttpRequest */
/* global Blob, File, FileList, ImageData, ImageBitmap, SharedArrayBuffer */
/* eslint camelcase: "off" */

'use strict';

/*
 * Constants
 */

const log = console.log.bind(console);

const source = (() => {
  if (!global.document)
    return null;

  if (!global.document.currentScript)
    return null;

  if (typeof global.document.currentScript.src !== 'string')
    return null;

  return global.document.currentScript.src || null;
})();

/**
 * EventTarget
 */

class EventTarget {
  constructor() {
    this.onmessage = null;
    this.onmessageerror = null;
    this.onerror = null;
  }

  _emitError(err) {
    if (typeof this.onerror !== 'function')
      throw err;

    setImmediate(() => {
      this.onerror({
        message: err ? String(err.message) : String(err),
        filename: this.location || source || undefined,
        lineno: 0,
        colno: 0,
        error: undefined
      });
    });
  }

  _emitMessage(msg) {
    if (typeof this.onmessage !== 'function')
      return;

    setImmediate(() => {
      this.onmessage({ data: msg });
    });
  }
}

/**
 * Worker
 */

class Worker extends EventTarget {
  constructor(url, options) {
    if (options == null)
      options = {};

    if (typeof url !== 'string')
      throw new TypeError('Worker URL must be a string.');

    if (typeof options !== 'object')
      throw new TypeError('Worker options must be an object.');

    if (options.type === 'module')
      throw new Error('Cannot execute ES module from worker polyfill.');

    if (options.name != null && typeof options.name !== 'string')
      throw new TypeError('Worker name must be a string.');

    super();

    this._child = null;
    this._buffer = [];
    this._closed = false;

    this._init(options.name, url);
  }

  _init(name, url) {
    const proto = url.substring(0, 5);

    if (proto === 'blob:')
      throw new Error(`Blob URL is unsupported: "${url}".`);

    if (proto === 'data:') {
      const index = url.indexOf(',');

      if (index === -1)
        throw new Error(`Invalid data URL: ${url}".`);

      const type = url.substring(5, index);

      if (type !== 'text/javascript'
          && type !== 'application/javascript') {
        throw new Error(`Invalid data URL: ${url}".`);
      }

      const rest = url.substring(index + 1);
      const code = decodeURIComponent(rest);

      setImmediate(() => {
        this._spawn(url, name, code, true);
      });

      return;
    }

    const xhr = new XMLHttpRequest();

    xhr.open('GET', url, true);

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4)
        return;

      if (this._closed)
        return;

      const status = xhr.status >>> 0;

      if (status < 200 || status >= 400) {
        this._closed = true;
        this._emitError(new Error(`Script not found: "${url}".`));
        return;
      }

      const code = String(xhr.responseText || '');

      this._spawn(url, name, code);
    };

    xhr.send(null);
  }

  _spawn(url, name, code, isDataURI) {
    if (this._closed)
      return;

    try {
      this._child = new WorkerScope(this, url, name, code, isDataURI);
    } catch (e) {
      this._closed = true;
      this._emitError(e);
      return;
    }

    for (const msg of this._buffer)
      this._child._emitMessage(msg);

    this._buffer.length = 0;
  }

  postMessage(msg, transferList) {
    if (this._closed)
      throw new Error('Worker is terminated.');

    if (!this._child) {
      this._buffer.push(clone(msg, transferList));
      return;
    }

    this._child._emitMessage(clone(msg, transferList));
  }

  terminate() {
    if (this._closed)
      throw new Error('Worker is terminated.');

    this._closed = true;
  }
}

/**
 * WorkerScope
 */

class WorkerScope extends EventTarget {
  constructor(worker, location, name, code, isDataURI) {
    super();

    this.Worker = Worker;
    this.MessagePort = MessagePort;
    this.MessageChannel = MessageChannel;

    this.worker = worker;
    this.location = location;
    this.name = name;
    this.closed = false;

    this.execute(code, isDataURI);
  }

  execute(code, isDataURI) {
    const args = [['__bthreads_polyfill_scope', this]];

    if (isDataURI) {
      const importScripts = (...args) => this.importScripts(...args);

      // Our wrapper needs these.
      args.push(['__bthreads_importScripts', importScripts]);
      args.push(['self', global]);
    }

    evalScript(code, args);
  }

  close() {
    if (this.closed)
      throw new Error('Port is closed.');

    this.worker.terminate();
    this.closed = true;
  }

  postMessage(msg, transferList) {
    if (this.closed)
      throw new Error('Port is closed.');

    this.worker._emitMessage(clone(msg, transferList));
  }

  importScripts(...args) {
    if (this.closed)
      throw new Error('Port is closed.');

    for (const url of args) {
      if (typeof url !== 'string')
        throw new TypeError('Script URL must be a string.');

      const xhr = new XMLHttpRequest();

      xhr.open('GET', url, false);

      try {
        xhr.send(null);
      } catch (e) {
        throw new Error(`Could not load script: "${url}".`);
      }

      const status = xhr.status >>> 0;

      if (status < 200 || status >= 400)
        throw new Error(`Script not found: "${url}".`);

      this.execute(String(xhr.responseText || ''));
    }
  }
}

/**
 * MessagePort
 */

class MessagePort extends EventTarget {
  constructor() {
    super();

    this._port = null;
    this._closed = false;
    this._onmessage = null;
    this._buffer = [];
    this._bthreadsPort = true;
  }

  _init() {
    if (this.__defineGetter__) {
      delete this.onmessage;

      this.__defineGetter__('onmessage', () => {
        return this._onmessage;
      });

      this.__defineSetter__('onmessage', (func) => {
        this._onmessage = func;
        this._port._flush();
      });
    } else {
      setTimeout(() => this._flush(), 1000);
    }
  }

  _flush() {
    if (typeof this._port.onmessage !== 'function')
      return;

    for (const msg of this._buffer)
      this._port._emitMessage(msg);

    this._buffer.length = 0;
  }

  start() {
    if (this._closed)
      throw new Error('Port is closed.');

    if (!this._port)
      throw new Error('Port has no channel.');

    this._flush();
  }

  close() {
    if (this._closed)
      throw new Error('Port is closed.');

    if (!this._port)
      throw new Error('Port has no channel.');

    this._closed = true;
  }

  postMessage(msg, transferList) {
    if (this._closed)
      throw new Error('Port is closed.');

    if (!this._port)
      throw new Error('Port has no channel.');

    if (typeof this._port.onmessage !== 'function') {
      this._buffer.push(clone(msg, transferList));
      return;
    }

    this._flush();
    this._port._emitMessage(clone(msg, transferList));
  }
}

/**
 * MessageChannel
 */

class MessageChannel {
  constructor() {
    this.port1 = new MessagePort();
    this.port2 = new MessagePort();
    this.port1._port = this.port2;
    this.port2._port = this.port1;
    this.port1._init();
    this.port2._init();
  }
}

/*
 * Helpers
 */

function evalScript(code, args) {
  const names = [];
  const values = [global];

  for (const [name, value] of args) {
    names.push(name);
    values.push(value);
  }

  const func = new Function(names.join(','), code);

  return func.call(...values);
}

function isTransferList(list) {
  if (list === undefined)
    return true;

  if (!Array.isArray(list))
    return false;

  for (const item of list) {
    if (!isTransferable(item))
      return false;
  }

  return true;
}

function isTransferable(item) {
  // https://developer.mozilla.org/en-US/docs/Web/API/Transferable
  if (item instanceof ArrayBuffer)
    return true;

  if (item !== null && typeof item === 'object' && item._bthreadPort)
    return true;

  if (typeof ImageBitmap === 'function') {
    if (item instanceof ImageBitmap)
      return true;
  }

  return false;
}

function clone(value, transferList) {
  if (transferList === undefined)
    transferList = [];

  if (!isTransferList(transferList))
    throw new TypeError('Invalid transferList.');

  return walk(value, new Set(transferList), new Map());
}

function walk(value, list, seen) {
  if (typeof value === 'function')
    throw cloneError(value);

  if (value === null || typeof value !== 'object')
    return value;

  if (value instanceof Error)
    throw cloneError(value);

  if (value instanceof RegExp)
    return new RegExp(value.source, value.flags);

  if (value instanceof Date)
    return new Date(value.getTime());

  if (value instanceof Promise)
    throw cloneError(value);

  if (value instanceof ArrayBuffer) {
    if (list.has(value))
      return value;

    const arr = new Uint8Array(value, 0, value.byteLength);

    return (new Uint8Array(arr)).buffer;
  }

  if (typeof SharedArrayBuffer === 'function') {
    if (value instanceof SharedArrayBuffer)
      return value;
  }

  if (Buffer.isBuffer(value)) {
    if (list.has(value.buffer)) {
      return new Uint8Array(value.buffer,
                            value.byteOffset,
                            value.byteLength);
    }

    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    if (list.has(value.buffer))
      return value;

    return new value.constructor(value);
  }

  if (typeof Blob === 'function') {
    if (value instanceof Blob)
      throw cloneError(value);
  }

  if (typeof File === 'function') {
    if (value instanceof File)
      throw cloneError(value);
  }

  if (typeof FileList === 'function') {
    if (value instanceof FileList)
      throw cloneError(value);
  }

  if (typeof ImageData === 'function') {
    if (value instanceof ImageData) {
      const data = new Uint8ClampedArray(value.data);
      const {width, height} = value;

      return new ImageData(data, width, height);
    }
  }

  if (typeof ImageBitmap === 'function') {
    if (value instanceof ImageBitmap) {
      if (list.has(value))
        return value;

      throw cloneError(value);
    }
  }

  if (value._bthreadsPort)
    return value;

  if (seen.has(value))
    return seen.get(value);

  if (Array.isArray(value)) {
    const out = [];

    seen.set(value, out);

    for (const val of value)
      out.push(walk(val, list, seen));

    seen.delete(value);

    return out;
  }

  if (value instanceof Map) {
    const out = new Map();

    seen.set(value, out);

    for (const [key, val] of value)
      out.set(walk(key, list, seen), walk(val, list, seen));

    seen.delete(value);

    return out;
  }

  if (value instanceof Set) {
    const out = new Set();

    seen.set(value, out);

    for (const key of value)
      out.add(walk(key, list, seen));

    seen.delete(value);

    return out;
  }

  const out = Object.create(null);

  seen.set(value, out);

  for (const key of Object.keys(value))
    out[key] = walk(value[key], list, seen);

  seen.delete(value);

  return out;
}

function objectString(obj) {
  if (obj === undefined)
    return '[object Undefined]';

  if (obj === null)
    return '[object Null]';

  return Object.prototype.toString.call(obj);
}

function cloneError(obj) {
  const err = new Error(`${objectString(obj)} could not be cloned.`);

  err.name = 'DataCloneError';

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, cloneError);

  return err;
}

/*
 * Expose
 */

module.exports = (() => {
  if (typeof __bthreads_polyfill_scope === 'object') {
    const scope = __bthreads_polyfill_scope;

    return {
      self: global,
      Worker: scope.Worker,
      MessagePort: scope.MessagePort,
      MessageChannel: scope.MessageChannel,
      location: scope.location,
      name: scope.name,
      close() {
        scope.close();
      },
      postMessage(msg) {
        scope.postMessage(msg);
      },
      importScripts(...args) {
        scope.importScripts(...args);
      },
      onmessage(func) {
        scope.onmessage = func;
      },
      onmessageerror(func) {
        scope.onmessageerror = func;
      },
      onerror(func) {
        scope.onerror = func;
      },
      log,
      polyfill: true
    };
  }

  return {
    self: global,
    Worker,
    MessagePort,
    MessageChannel,
    location: String(global.location),
    name: undefined,
    close: undefined,
    postMessage: undefined,
    importScripts: undefined,
    onmessage(func) {
      global.onmessage = func;
    },
    onmessageerror(func) {
      global.onmessageerror = func;
    },
    onerror(func) {
      global.onerror = func;
    },
    log,
    polyfill: true
  };
})();
