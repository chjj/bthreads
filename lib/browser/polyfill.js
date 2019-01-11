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
        this._spawn(name, code);
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

      this._spawn(name, code);
    };

    xhr.send(null);
  }

  _spawn(name, code) {
    if (this._closed)
      return;

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

    this.close = () => this._close();
    this.postMessage = (...args) => this._postMessage(...args);
    this.importScripts = (...args) => this._importScripts(...args);

    this.postMessage._polyfill = true;

    this.execute(code);
  }

  scope() {
    const self = global;
    const location = global.location;
    const close = this.close;
    const postMessage = this.postMessage;
    const importScripts = this.importScripts;
    const name = this.name;
    const onmessage = noop;
    const onmessageerror = noop;
    const onerror = null;

    return [
      // These variables are "guarded", they
      // don't get added as globals but are
      // passed as function arguments in
      // case some code tries to overwrite
      // them directly.
      ['self', self, 0],
      ['location', location, 0],
      ['onerror', onerror, 0],

      // To force parent.js to inject methods
      // into the console. We don't know if
      // we're in browserify or not here.
      ['console', console, 0],

      // These variables are guarded and are
      // temporarily added to global
      // variables. That means code should
      // either access them directly or take
      // a global reference of them
      // immediately (e.g. `{close} = global`)
      // if they plan on doing something
      // with them _later_.
      ['close', close, 1],
      ['postMessage', postMessage, 1],
      ['importScripts', importScripts, 1],
      ['name', name, 1],

      // These variables are temporarily
      // added to globals but are not
      // guarded. Doing `onmessage = foo;`
      // will set onmessage globally. Note
      // that this is temporary, you must
      // assign `onmessage` _immediately_!
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

  _close() {
    if (this.closed)
      throw new Error('Port is closed.');

    this.worker.terminate();
    this.closed = true;
  }

  _postMessage(msg) {
    if (this.closed)
      throw new Error('Port is closed.');

    this.worker._emitMessage(msg);
  }

  _importScripts(...args) {
    if (this.closed)
      throw new Error('Port is closed.');

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
