/*!
 * common.js - common functions for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/worker_threads.html#worker_threads_class_messageport
 *   https://nodejs.org/api/worker_threads.html#worker_threads_class_messagechannel
 *   https://developer.mozilla.org/en-US/docs/Web/API/MessagePort
 *   https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel
 *   https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
 *   https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
 */

'use strict';

const {EventEmitter} = require('events');
const clone = require('../internal/clone');
const utils = require('../internal/utils');
const backend = require('./backend');

const {
  custom,
  inspectify,
  errors,
  DataCloneError,
  once
} = utils;

/*
 * Constants
 */

const types = {
  MESSAGE: 0,
  STDIO_READ: 1,
  STDIO_WRITE: 2,
  ERROR: 3,
  OPEN: 4,
  CLOSE: 5,
  EXIT: 6,
  MAX_TYPE: 6
};

/**
 * Cloner
 */

class Cloner extends clone.Cloner {
  isPort(value, options) {
    return value instanceof MessagePortBase;
  }

  toPort(value, options) {
    if (value._closed || !value._port)
      throw new DataCloneError(errors.DETACHED);
    return value._port;
  }
}

/**
 * Uncloner
 */

class Uncloner extends clone.Uncloner {
  isPort(value, options) {
    return value instanceof backend.MessagePort;
  }

  toPort(value, options) {
    return new MessagePort(value);
  }
}

/**
 * MessagePortBase
 */

class MessagePortBase extends EventEmitter {
  constructor() {
    super();

    this._port = null;
    this._bound = false;
    this._closed = true;
    this._onmessage = null;
    this._onclose = null;

    // For encoding.stringify:
    this._dead = false;
    this._bthreadsPort = true;
  }

  get onmessage() {
    return this._onmessage;
  }

  set onmessage(func) {
    if (this._onmessage) {
      this.removeListener('message', this._onmessage);
      this._onmessage = null;
    }

    if (typeof func === 'function') {
      this.addListener('message', func);
      this._onmessage = func;
    }
  }

  get onclose() {
    return this._onclose;
  }

  set onclose(func) {
    if (this._onclose) {
      this.removeListener('close', this._onclose);
      this._onclose = null;
    }

    if (typeof func === 'function') {
      this.addListener('close', func);
      this._onclose = func;
    }
  }

  close() {
    return;
  }

  postMessage(value, transferList) {
    return;
  }

  ref() {
    return;
  }

  start() {
    return;
  }

  unref() {
    return;
  }

  [custom]() {
    return inspectify(MessagePort, {
      active: !this._closed,
      refed: this._bound && !this._closed
    });
  }
}

/**
 * MessagePort
 */

class MessagePort extends MessagePortBase {
  constructor(port) {
    super();

    if (!(port instanceof backend.MessagePort))
      throw new TypeError('"port" must be a MessagePort.');

    this._port = port;
    this._closed = false;

    this._init();
  }

  _bind() {
    if (this._bound)
      return;

    this._port.onmessage = (event) => {
      try {
        this._handleMessage(event);
      } catch (e) {
        this.emit('error', e);
      }
    };

    this._bound = true;
  }

  _init() {
    once(this, ['message', 'close'], () => {
      this._bind();
    });

    once(this, 'error', () => {
      this._port.onmessageerror = (event) => {
        this._handleError(event);
      };
    });
  }

  _handleMessage(event) {
    if (this._closed)
      return;

    const pkt = Packet.decode(event.data);

    switch (pkt.type) {
      case types.MESSAGE: {
        this.emit('message', pkt.value);
        break;
      }

      case types.CLOSE: {
        this._port.close();
        this._closed = true;
        this.emit('close');
        this.removeAllListeners();
        break;
      }

      default: {
        throw new Error(`Port received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _handleError(event) {
    const err = errorify(event);

    if (this._parent)
      this._parent.emit('error', err);
    else
      this.emit('error', err);
  }

  close() {
    if (this._closed)
      return;

    this._closed = true;

    this._send(new Packet(types.CLOSE));
    this._port.close();

    setImmediate(() => {
      this.emit('close');
      this.removeAllListeners();
    });
  }

  _send(pkt, transferList) {
    const [msg, list] = pkt.morph(transferList);

    this._port.postMessage(msg, list);
  }

  postMessage(value, transferList) {
    if (this._closed)
      return;

    this._send(new Packet(types.MESSAGE, value), transferList);
  }

  ref() {
    return;
  }

  start() {
    this._bind();
  }

  unref() {
    return;
  }
}

/**
 * MessageChannel
 */

class MessageChannel {
  constructor() {
    const {port1, port2} = new backend.MessageChannel();

    this.port1 = new MessagePort(port1);
    this.port2 = new MessagePort(port2);
  }
}

/**
 * Packet
 */

class Packet {
  constructor(type, value) {
    this.type = type || 0;
    this.value = value;
  }

  morph(transferList) {
    const [value, list, port] = Cloner.morph(this.value, transferList);
    return [[this.type, value, port], list];
  }

  encode(port) {
    const value = port
      ? Cloner.clone(this.value)
      : this.value;

    return [this.type, value, port];
  }

  decode(msg) {
    if (!Array.isArray(msg) || msg.length !== 3)
      throw new TypeError('Invalid packet.');

    const [type, value, port] = msg;

    if ((type >>> 0) !== type || type > types.MAX_TYPE)
      throw new TypeError('Invalid packet type.');

    this.type = type;
    this.value = port ? Uncloner.unclone(value) : value;

    return this;
  }

  static decode(msg) {
    return new this().decode(msg);
  }
}

/*
 * Static
 */

Packet.types = types;

/*
 * Helpers
 */

function errorify(event) {
  if (event instanceof Error)
    return event;

  if (event.error instanceof Error)
    return event.error;

  if (event.message == null && event.filename == null)
    return new Error(String(event.type || 'unknown'));

  return new Error(`${event.message} `
                 + `(${event.filename}`
                 + `:${event.lineno}`
                 + `:${event.colno})`);
}

/*
 * Expose
 */

exports.MessagePortBase = MessagePortBase;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.types = types;
exports.Packet = Packet;
exports.errorify = errorify;
