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

const {EventEmitter} = require('events');
const Packet = require('./packet');

/*
 * Constants
 */

// 32-bit pid + 20-bit id = 52 bit max
const PID = process.pid * (2 ** 20);
const MIN_ID = 5;
const MAX_ID = 2 ** 20;

let uid = MIN_ID;

/**
 * MessagePortBase
 */

class MessagePortBase extends EventEmitter {
  constructor() {
    super();
  }
}

/**
 * MessagePort
 */

class MessagePort extends MessagePortBase {
  constructor() {
    super();
    this._id = 0;
    this._parent = null;
    this._channel = null;
    this._dead = false;
    this._active = false;
    this._bthreadPort = true;
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
    if (this._parent) {
      this._parent._ports.delete(this._id);
      this.emit('close');
    }
    return this;
  }

  postMessage(value, transferList) {
    if (!this._parent)
      throw new Error('Message port is not connected.');

    const pkt = new Packet();

    pkt.port = this._id;
    pkt.value = value;

    activate(transferList, this._parent);

    this._parent._write(pkt.encode());

    return this;
  }

  ref() {
    return this;
  }

  start() {
    if (!this._parent)
      throw new Error('Message port is not connected.');

    if (this._id < 5)
      throw new Error('Message port ID collision.');

    this._parent._ports.set(this._id, this);

    return this;
  }

  unref() {
    return this;
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

function once(obj, names, func) {
  if (!Array.isArray(names))
    names = [names];

  const on = (name) => {
    if (names.indexOf(name) !== -1) {
      obj.removeListener('newListener', on);
      func();
    }
  };

  obj.addListener('newListener', on);
}

function activate(transferList, parent) {
  if (!Array.isArray(transferList))
    return;

  for (const item of transferList) {
    if (item instanceof MessagePort) {
      let channel = item._channel;

      if (!channel) {
        if (!item._active)
          throw new Error('Cannot transfer message port without a channel.');

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

      if (remote._dead)
        throw new Error('Message port already transferred.');

      if (local._active)
        throw new Error('Message port already activated.');

      if (local._id < 5 || parent._ports.has(local._id))
        throw new Error('Message port ID collision.');

      if (local._dead) {
        // We sent port1 to thread A and port2 to thread B.
        if (!remote._active)
          throw new Error('Invalid state.');

        if (parent === remote._parent)
          throw new Error('Cannot transfer whole channel to port.');

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
    }
  }
}

function proxy(port1, port2) {
  port1.on('message', (msg) => {
    port2.postMessage(msg);
  });

  port2.on('message', (msg) => {
    port1.postMessage(msg);
  });
}

/*
 * Expose
 */

exports.MessagePortBase = MessagePortBase;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.once = once;
exports.activate = activate;
