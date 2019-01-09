'use strict';

const {EventEmitter} = require('events');
const once = require('../internal/once');
const walk = require('../internal/walk');

// https://developer.mozilla.org/en-US/docs/Web/API/MessagePort
// https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel
// https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
// https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
// https://nodejs.org/api/worker_threads.html#worker_threads_class_messageport
// https://nodejs.org/api/worker_threads.html#worker_threads_class_messagechannel

/**
 * MessagePort
 */

class MessagePort extends EventEmitter {
  constructor(port) {
    super();
    this._port = port || new global.MessagePort();
    this._init();
  }

  _init() {
    this.on('error', () => {});

    once(this, 'message', () => {
      this._port.onmessage = (event) => {
        const pkt = walk.unmorph(event.data, MessagePort);

        this.emit('_packet', pkt);

        if (event.data.cmd === 'msg')
          this.emit('message', pkt.value);
      };
    });

    once(this, 'error', () => {
      this._port.onmessageerror = (event) => {
        this.emit('error', new Error(event.message));
      };
    });
  }

  close() {
    this._port.close();
    return this;
  }

  _write(value, transferList) {
    const [msg, list] = walk.morph(value, transferList, MessagePort);

    if (this._port.postMessage.length === 1)
      this._port.postMessage(msg);
    else
      this._port.postMessage(msg, list);

    return this;
  }

  postMessage(value, transferList) {
    return this._write({ cmd: 'msg', value }, transferList);
  }

  ref() {
    return this;
  }

  start() {
    this._port.start();
    return this;
  }

  unref() {
    return this;
  }
}

MessagePort.original = global.MessagePort;

/**
 * MessageChannel
 */

class MessageChannel {
  constructor() {
    const {port1, port2} = new global.MessageChannel();

    this.port1 = new MessagePort(port1);
    this.port2 = new MessagePort(port2);
  }
}

MessageChannel.original = global.MessageChannel;

/*
 * Expose
 */

exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
