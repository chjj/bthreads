'use strict';

/* global ImageBitmap */

const {EventEmitter} = require('events');
const once = require('../internal/once');

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

  _init() {
    this.on('error', () => {});

    once(this, 'message', () => {
      this._port.onmessage = (event) => {
        const pkt = unmorph(event.data);

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
    const [msg, list] = morph(value, transferList);

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

/*
 * Morphing
 */

function morph(value, transferList) {
  if (!hasPort(transferList))
    return [value, transferList];

  const list = [];

  for (const item of transferList) {
    if (item instanceof MessagePort)
      list.push(item._port);
    else
      list.push(item);
  }

  return [{ value: walk(value), _hasBthreadPort: true }, list];
}

function unmorph(value) {
  if (value == null || typeof value !== 'object')
    return value;

  if (!value._hasBthreadPort)
    return value;

  return unwalk(value);
}

/*
 * Helpers
 */

function hasPort(transferList) {
  if (!Array.isArray(transferList))
    return false;

  for (const item of transferList) {
    if (item instanceof MessagePort)
      return true;
  }

  return false;
}

function walk(value, seen = new Map()) {
  if (value == null || typeof value !== 'object')
    return value;

  if (seen.has(value))
    return seen.get(value);

  if (value instanceof Error)
    return value;

  if (value instanceof Date)
    return value;

  if (value instanceof RegExp)
    return value;

  if (value instanceof ArrayBuffer)
    return value;

  if (typeof value.readUInt32LE === 'function')
    return value;

  if (ArrayBuffer.isView(value))
    return value;

  if (Array.isArray(value)) {
    const out = [];

    seen.set(value, out);

    for (const val of value)
      out.push(walk(val, seen));

    seen.delete(value);

    return out;
  }

  if (value instanceof Map) {
    const out = new Map();

    seen.set(value, out);

    for (const [key, val] of value)
      out.set(walk(key, seen), walk(val, seen));

    seen.delete(value);

    return out;
  }

  if (value instanceof Set) {
    const out = new Set();

    seen.set(value, out);

    for (const key of value)
      out.add(walk(key, seen));

    seen.delete(value);

    return out;
  }

  if (value instanceof MessagePort)
    return value._port;

  if (typeof ImageBitmap === 'function') {
    if (value instanceof ImageBitmap)
      return value;
  }

  const out = Object.create(null);

  seen.set(value, out);

  for (const key of Object.keys(value))
    out[key] = walk(value[key], seen);

  seen.delete(value);

  return out;
}

function unwalk(value, seen = new Set()) {
  if (value == null || typeof value !== 'object')
    return value;

  if (seen.has(value))
    return value;

  if (value instanceof Error)
    return value;

  if (value instanceof Date)
    return value;

  if (value instanceof RegExp)
    return value;

  if (value instanceof ArrayBuffer)
    return value;

  if (typeof value.readUInt32LE === 'function')
    return value;

  if (ArrayBuffer.isView(value))
    return value;

  if (Array.isArray(value)) {
    seen.add(value);

    for (let i = 0; i < value.length; i++)
      value[i] = unwalk(value[i], seen);

    seen.delete(value);

    return value;
  }

  if (value instanceof Map) {
    const del = [];
    const set = [];

    seen.add(value);

    for (const [key, val] of value) {
      const newKey = unwalk(key, seen);
      const newVal = unwalk(val, seen);

      if (newKey !== key) {
        del.push(key);
        set.push([newKey, newVal]);
      } else if (newVal !== val) {
        set.push([newKey, newVal]);
      }
    }

    for (const oldKey of del)
      value.delete(oldKey);

    for (const [newKey, newVal] of set)
      value.set(newKey, newVal);

    seen.delete(value);

    return value;
  }

  if (value instanceof Set) {
    const del = [];
    const add = [];

    seen.add(value);

    for (const key of value) {
      const newKey = unwalk(key, seen);

      if (newKey !== key) {
        del.push(key);
        add.push(newKey);
      }
    }

    for (const oldKey of del)
      value.delete(oldKey);

    for (const newKey of add)
      value.add(newKey);

    seen.delete(value);

    return value;
  }

  if (value instanceof global.MessagePort)
    return new MessagePort(value);

  if (typeof ImageBitmap === 'function') {
    if (value instanceof ImageBitmap)
      return value;
  }

  seen.add(value);

  for (const key of Object.keys(value)) {
    const val = value[key];
    const newVal = unwalk(val, seen);

    if (newVal !== val)
      value[key] = newVal;
  }

  seen.delete(value);

  return value;
}

/*
 * Expose
 */

exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.morph = morph;
exports.unmorph = unmorph;
