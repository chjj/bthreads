'use strict';

/* eslint camelcase: "off" */
/* global __bthreads_polyfill_scope, XMLHttpRequest */

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

  postMessage(msg) {
    if (this.closed)
      throw new Error('Port is closed.');

    this.worker._emitMessage(msg);
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

  postMessage(msg) {
    if (this._closed)
      throw new Error('Port is closed.');

    if (!this._port)
      throw new Error('Port has no channel.');

    if (typeof this._port.onmessage !== 'function') {
      this._buffer.push(msg);
      return;
    }

    this._flush();
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
