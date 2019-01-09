'use strict';

const {EventEmitter} = require('events');
const Packet = require('./packet');

/*
 * Constants
 */

let uid = process.env.BTHREADS_THREAD_ID ? 2 ** 31 - 1 : 5;

/**
 * MessagePort
 */

class MessagePort extends EventEmitter {
  constructor() {
    super();
    this._id = 0;
    this._parent = null;
    this._channel = null;
    this._dead = false;
    this._local = false;
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
    if (this._parent)
      this._parent._ports.delete(this._id);
    return this;
  }

  postMessage(value, transferList) {
    if (!this._parent)
      throw new Error('Message port is not connected.');

    const pkt = new Packet();

    pkt.cmd = 0;
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
    this._parent = null;

    const id = uid;

    uid += 1;
    uid >>>= 0;

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
  if (!Array.isArray(transferList))
    return;

  for (const item of transferList) {
    if (item instanceof MessagePort) {
      const channel = item._channel;

      if (!channel)
        throw new Error('Cannot transfer port without a channel.');

      const {port1, port2} = channel;

      let [local, remote] = [port1, port2];

      if (port1 === item)
        [remote, local] = [local, remote];

      if (local._local)
        throw new Error('Port already activated.');

      if (remote._dead)
        throw new Error('Port already transferred.');

      local._local = true;
      remote._dead = true;

      if (local._id < 5 || parent.ports.has(local._id))
        throw new Error('Port collision.');

      channel._parent = parent;
      port1._parent = parent;
      port2._parent = parent;

      parent._ports.set(local._id, local);
    }
  }
}

/*
 * Expose
 */

exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.activate = activate;
