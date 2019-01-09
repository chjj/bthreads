'use strict';

const threads = require('worker_threads');
const EventEmitter = require('events');
const once = require('../internal/once');
const walk = require('../internal/walk');

/**
 * MessagePort
 */

class MessagePort extends EventEmitter {
  constructor(port) {
    super();
    this._port = port || new threads.MessagePort();
    this._init();
  }

  _init() {
    once(this, 'error', () => {
      this._port.on('error', (err) => {
        this.emit('error', err);
      });
    });

    once(this, 'close', () => {
      this._port.on('close', () => {
        this.emit('close');
      });
    });

    once(this, 'message', () => {
      this._port.on('message', (msg) => {
        this.emit('message', walk.unmorph(msg, MessagePort));
      });
    });
  }

  close() {
    this._port.close();
    return this;
  }

  postMessage(value, transferList) {
    const [msg, list] = walk.morph(value, transferList, MessagePort);
    this._port.postMessage(msg, list);
    return this;
  }

  ref() {
    this._port.ref();
    return this;
  }

  start() {
    this._port.start();
    return this;
  }

  unref() {
    this._port.unref();
    return this;
  }
}

MessagePort.original = threads.MessagePort;

/**
 * MessageChannel
 */

class MessageChannel {
  constructor() {
    const {port1, port2} = new threads.MessageChannel();

    this.port1 = new MessagePort(port1);
    this.port2 = new MessagePort(port2);
  }
}

MessageChannel.original = threads.MessageChannel;

/*
 * Expose
 */

exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
