'use strict';

/* global XMLHttpRequest */

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
        filename: undefined,
        lineno: undefined,
        colno: undefined,
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
    if (/^data:(text|application)\/(x-)?javascript,/.test(url)) {
      const index = url.indexOf(',') + 1;
      const code = decodeURIComponent(url.substring(index));
      this._spawn(name, code);
      return;
    }

    const xhr = new XMLHttpRequest();

    xhr.open('GET', url, true);

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4)
        return;

      const status = xhr.status >>> 0;

      if (status < 200 || status >= 400) {
        this._closed = true;
        this._emitError(new Error(`Script not found: "${url}".`));
        return;
      }

      const code = String(xhr.responseText || '');

      this._spawn(name, code);
    };

    xhr.send(null);
  }

  _spawn(name, code) {
    try {
      this._child = new WorkerScope(this, name, code);
    } catch (e) {
      this._closed = true;
      this._emitError(e);
      return;
    }

    for (const msg of this._buffer)
      this._child._emitMessage(msg);

    this._buffer.length = 0;
  }

  postMessage(msg) {
    if (this._closed)
      throw new Error('Worker is terminated.');

    if (!this._child) {
      this._buffer.push(msg);
      return;
    }

    this._child._emitMessage(msg);
  }

  terminate() {
    if (this._closed)
      throw new Error('Worker is terminated.');

    this._closed = true;
  }
}

Worker._polyfill = true;

/**
 * WorkerScope
 */

class WorkerScope extends EventTarget {
  constructor(worker, name, code) {
    super();

    this.worker = worker;
    this.name = name;
    this.closed = false;

    this.execute(code);
  }

  scope() {
    const self = global;
    const location = global.location;
    const close = () => this.close();
    const postMessage = (...args) => this.postMessage(...args);
    const importScripts = (...args) => this.importScripts(...args);
    const name = this.name;
    const onmessage = noop;
    const onmessageerror = noop;
    const onerror = null;

    return [
      ['self', self, 0],
      ['location', location, 0],
      ['close', close, 0],
      ['onerror', onerror, 0],
      ['postMessage', postMessage, 1],
      ['importScripts', importScripts, 1],
      ['name', name, 1],
      ['onmessage', onmessage, 2],
      ['onmessageerrror', onmessageerror, 2]
    ];
  }

  execute(code) {
    const scope = this.scope();
    const names = [];
    const values = [global];
    const saved = [];

    for (const [name, value, type] of scope) {
      if (type === 0 || type === 1) {
        names.push(name);
        values.push(value);
      }

      if (type === 1 || type === 2) {
        saved.push([name, global[name]]);
        global[name] = value;
      }
    }

    const args = names.join(',');

    try {
      (new Function(args, code)).call(...values);
    } finally {
      if (global.onmessage !== noop)
        this.onmessage = global.onmessage;

      if (global.onmessageerrror !== noop)
        this.onmessageerror = global.onmessageerror;

      for (const [name, value] of saved)
        global[name] = value;
    }
  }

  close() {
    if (this.closed)
      throw new Error('Port is closed.');

    this.worker.terminate();
    this.closed = true;
  }

  postMessage(msg) {
    if (this.closed)
      throw new Error('Port is closed.');

    this.worker._emitMessage(msg);
  }

  importScripts(...args) {
    for (const url of args) {
      if (typeof url !== 'string')
        throw new TypeError('Script URL must be a string.');

      const xhr = new XMLHttpRequest();

      xhr.open('GET', url, false);
      xhr.send(null);

      const status = xhr.status >>> 0;

      if (status < 200 || status >= 400)
        throw new Error(`Script not found: "${url}".`);

      this.execute(String(xhr.responseText || ''));
    }
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
  }

  start() {
    if (this._closed)
      throw new Error('Port is closed.');

    if (!this._port)
      throw new Error('Port has no channel.');
  }

  close() {
    if (this._closed)
      throw new Error('Port is closed.');

    if (!this._port)
      throw new Error('Port has no channel.');

    this._closed = true;
  }

  postMessage(msg) {
    if (this._closed)
      throw new Error('Port is closed.');

    if (!this._port)
      throw new Error('Port has no channel.');

    this._port._emitMessage(msg);
  }
}

/*
 * Helpers
 */

function noop() {}

/*
 * Expose
 */

if (!global.Worker) {
  global.self = global;
  global.Worker = Worker;
  global.MessagePort = MessagePort;
  global.MessageChannel = MessageChannel;
}
