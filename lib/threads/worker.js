'use strict';

const threads = require('worker_threads');
const {EventEmitter} = require('events');
const once = require('../internal/once');
const walk = require('../internal/walk');
const {MessagePort} = require('./common');

/**
 * Worker
 */

class Worker extends EventEmitter {
  constructor(file, options) {
    super();

    if (options == null)
      options = Object.create(null);

    if (typeof options !== 'object')
      throw new TypeError('"options" must be an object.');

    options = Object.assign(Object.create(null), options, {
      workerData: walk.morph(options.workerData, null, MessagePort)[0]
    });

    this._worker = new threads.Worker(file, options);
    this._init();
  }

  _init() {
    once(this, 'error', () => {
      this._worker.on('error', (err) => {
        this.emit('error', err);
      });
    });

    once(this, 'exit', () => {
      this._worker.on('exit', (code) => {
        this.emit('exit', code);
      });
    });

    once(this, 'message', () => {
      this._worker.on('message', (msg) => {
        this.emit('message', walk.unmorph(msg, MessagePort));
      });
    });

    once(this, 'online', () => {
      this._worker.on('online', () => {
        this.emit('online');
      });
    });
  }

  get stdin() {
    return this._worker.stdin;
  }

  get stdout() {
    return this._worker.stdout;
  }

  get stderr() {
    return this._worker.stderr;
  }

  postMessage(value, transferList) {
    const [msg, list] = walk.morph(value, transferList, MessagePort);
    this._worker.postMessage(msg, list);
    return this;
  }

  ref() {
    this._worker.ref();
    return this;
  }

  terminate(callback) {
    this._worker.terminate(callback);
    return this;
  }

  unref() {
    this._worker.unref();
    return this;
  }
}

/*
 * Expose
 */

module.exports = Worker;
