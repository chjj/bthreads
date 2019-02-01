/*!
 * common.js - common functions for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/worker_threads.html#worker_threads_class_messageport
 *   https://nodejs.org/api/worker_threads.html#worker_threads_class_messagechannel
 */

'use strict';

const util = require('util');
const {EventEmitter} = require('events');
const utils = require('../internal/utils');
const clone = require('../internal/clone');
const Packet = require('./packet');
const {types} = Packet;

const {
  errors,
  DataCloneError,
  TransferError,
  hasDuplicates
} = utils;

/*
 * Constants
 */

// 32-bit pid + 20-bit id = 52 bit max
const PID = process.pid * (2 ** 20);
const MIN_ID = 1;
const MAX_ID = 2 ** 20;

let uid = MIN_ID;

/**
 * Collector
 */

class Collector extends clone.Collector {
  isPort(value) {
    return value instanceof MessagePort;
  }
}

/**
 * Cloner
 */

class Cloner extends clone.FullCloner {
  isPort(value, list) {
    return value instanceof MessagePortBase;
  }

  toPort(value, list) {
    if (value._closed
        || !value._channel
        || value._dead
        || value._active) {
      throw new DataCloneError(errors.DETACHED);
    }

    return value;
  }
}

/**
 * FakeMessagePort
 */

const FakeMessagePort = class MessagePort {};

/**
 * MessagePortBase
 */

class MessagePortBase extends EventEmitter {
  constructor() {
    super();
    this._id = 0;
    this._parent = null;
    this._channel = null;
    this._dead = false;
    this._active = false;
    this._closed = true;
    this._bthreadsPort = true;
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

  [util.inspect.custom]() {
    return Object.assign(new FakeMessagePort(), {
      active: !this._closed,
      refed: !this._closed,
      domain: this.domain,
      _events: this._events,
      _eventsCount: this._eventsCount
    });
  }
}

/**
 * MessagePort
 */

class MessagePort extends MessagePortBase {
  constructor() {
    super();
    this._closed = false;
  }

  _handleMessage(pkt) {
    switch (pkt.type) {
      case types.MESSAGE: {
        this.emit('message', pkt.value);
        break;
      }

      case types.CLOSE: {
        if (this._parent)
          this._parent._ports.delete(this._id);

        if (!this._closed) {
          this._closed = true;
          this.emit('close');
          this.removeAllListeners();
        }

        break;
      }

      default: {
        throw new Error(`Port received invalid packet type (${pkt.type}).`);
      }
    }
  }

  _sendClose() {
    if (this._parent)
      this._parent._send(new Packet(types.CLOSE, this._id));
  }

  _remote() {
    if (this._closed
        || !this._channel
        || this._dead
        || this._active) {
      return null;
    }

    const {port1, port2} = this._channel;

    let [local, remote] = [port1, port2];

    if (local !== this)
      [local, remote] = [remote, local];

    if (remote._closed)
      return null;

    return remote;
  }

  close() {
    if (this._closed)
      return;

    const remote = this._remote();

    if (remote) {
      this._closed = true;
      remote._closed = true;
      setImmediate(() => {
        this.emit('close');
        this.removeAllListeners();
        remote.emit('close');
        remote.removeAllListeners();
      });
      return;
    }

    if (!this._parent)
      return;

    this._closed = true;

    this._sendClose();
    this._parent._ports.delete(this._id);

    setImmediate(() => {
      this.emit('close');
      this.removeAllListeners();
    });
  }

  postMessage(value, transferList) {
    if (this._closed)
      return;

    const remote = this._remote();

    if (remote) {
      const msg = Cloner.clone(value, transferList);
      setImmediate(() => {
        remote.emit('message', msg);
      });
      return;
    }

    if (!this._parent)
      return;

    const pkt = new Packet();

    pkt.type = types.MESSAGE;
    pkt.port = this._id;
    pkt.value = value;

    activate(transferList, this._parent);

    this._parent._send(pkt);
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
}

/**
 * MessageChannel
 */

class MessageChannel {
  constructor() {
    if ((process.pid >>> 0) !== process.pid)
      throw new Error('Invalid PID for worker.');

    const id = PID + uid;

    uid += 1;

    if (uid === MAX_ID)
      uid = MIN_ID;

    this.port1 = new MessagePort();
    this.port1._id = id;
    this.port1._channel = this;

    this.port2 = new MessagePort();
    this.port2._id = id;
    this.port2._channel = this;
  }
}

/*
 * Helpers
 */

function activate(transferList, parent) {
  if (transferList === undefined)
    return;

  if (!Array.isArray(transferList))
    throw new TypeError(errors.INVALID_LIST);

  if (hasDuplicates(transferList))
    throw new DataCloneError(errors.DUPLICATE_ITEM);

  for (const item of transferList) {
    if (item instanceof MessagePort) {
      if (item === parent)
        throw new DataCloneError(errors.SOURCE_PORT);

      if (item._closed)
        throw new DataCloneError(errors.DETACHED);

      let channel = item._channel;

      if (!channel) {
        if (!item._active)
          throw new Error('Invalid state.');

        // We received a port but sent it somewhere else.
        channel = new MessageChannel();
        channel.port2 = item;

        const [local, remote] = [channel.port1, channel.port2];

        // Make it look like the `local._dead` case below for brevity.
        local._dead = true;
        local._id = item._id;

        remote._channel = channel;
      }

      const {port1, port2} = channel;

      let [local, remote] = [port1, port2];

      if (port1 === item)
        [local, remote] = [remote, local];

      if (remote._dead) {
        // Message port already transferred.
        throw new DataCloneError(errors.DETACHED);
      }

      if (local._active) {
        // Message port already activated.
        throw new DataCloneError(errors.DETACHED);
      }

      if (local._id === 0 || parent._ports.has(local._id))
        throw new Error('Invalid state.');

      if (local._dead) {
        // We sent port1 to thread A and port2 to thread B.
        if (!remote._active)
          throw new Error('Invalid state.');

        // Technically incorrect behavior.
        if (parent === remote._parent)
          throw new TransferError('Cannot transfer whole channel to port.');

        // Now we're the middleman for two threads.
        proxy(local, remote);
      } else {
        // We sent port1 to thread A and kept port2.
        if (remote._active)
          throw new Error('Invalid state.');
      }

      remote._dead = true;

      local._parent = parent;
      local._active = true;

      parent._ports.set(local._id, local);

      continue;
    }

    if (item instanceof MessagePortBase) {
      if (item === parent)
        throw new DataCloneError(errors.SOURCE_PORT);

      throw new DataCloneError(errors.DETACHED);
    }

    if (!(item instanceof ArrayBuffer))
      throw new DataCloneError(errors.INVALID_OBJECT);
  }
}

function proxy(port1, port2) {
  // We need to crawl the message,
  // collect all the ports, and add
  // them to the transfer list.
  port1.on('message', (msg) => {
    if (!port2._closed)
      port2.postMessage(msg, Collector.collect(msg));
  });

  port1.on('close', () => {
    port2._sendClose();
  });

  port2.on('message', (msg) => {
    if (!port1._closed)
      port1.postMessage(msg, Collector.collect(msg));
  });

  port2.on('close', () => {
    port1._sendClose();
  });
}

/*
 * Expose
 */

exports.MessagePortBase = MessagePortBase;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.activate = activate;
