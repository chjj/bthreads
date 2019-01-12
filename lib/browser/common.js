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

/* global Blob, File, FileList, ImageData, SharedArrayBuffer */

'use strict';

const {EventEmitter} = require('events');
const backend = require('./backend');

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
  constructor(port) {
    super();
    this._port = port || new backend.MessagePort();
    this._bound = false;
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

  _bind() {
    if (this._bound)
      return;

    this._port.onmessage = (event) => {
      const pkt = unmorph(event.data);

      this.emit('_packet', pkt);

      if (event.data.cmd === 'msg')
        this.emit('message', pkt.value);
    };

    this._bound = true;
  }

  _init() {
    this.on('error', () => {});

    once(this, ['_packet', 'message'], () => {
      this._bind();
    });

    once(this, 'error', () => {
      this._port.onmessageerror = (event) => {
        this.emit('error', new Error(format(event)));
      };
    });
  }

  close() {
    this._port.close();
    this.emit('close');
    return this;
  }

  _write(value, transferList) {
    const [msg, list] = morph(value, transferList);

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
    this._bind();
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
    const {port1, port2} = new backend.MessageChannel();

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

function unmorph(msg) {
  if (msg == null || typeof msg !== 'object')
    return msg;

  if (!msg._hasBthreadPort)
    return msg;

  return unwalk(msg.value);
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
  if (value === null || typeof value !== 'object')
    return value;

  if (value instanceof Error)
    return value;

  if (value instanceof RegExp)
    return value;

  if (value instanceof Date)
    return value;

  if (value instanceof Promise)
    return value;

  // Todo: figure out how to do this one.
  // if (value instanceof Proxy)
  //   return value;

  if (value instanceof ArrayBuffer)
    return value;

  if (typeof SharedArrayBuffer === 'function') {
    if (value instanceof SharedArrayBuffer)
      return value;
  }

  if (Buffer.isBuffer(value))
    return value;

  if (ArrayBuffer.isView(value))
    return value;

  if (typeof Blob === 'function') {
    if (value instanceof Blob)
      return value;
  }

  if (typeof File === 'function') {
    if (value instanceof File)
      return value;
  }

  if (typeof FileList === 'function') {
    if (value instanceof FileList)
      return value;
  }

  if (typeof ImageData === 'function') {
    if (value instanceof ImageData)
      return value;
  }

  if (value instanceof MessagePort)
    return value._port;

  if (seen.has(value))
    return seen.get(value);

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

  const out = Object.create(null);

  seen.set(value, out);

  for (const key of Object.keys(value))
    out[key] = walk(value[key], seen);

  seen.delete(value);

  return out;
}

function unwalk(value, seen = new Set()) {
  if (value === null || typeof value !== 'object')
    return value;

  if (value instanceof Error)
    return value;

  if (value instanceof RegExp)
    return value;

  if (value instanceof Date)
    return value;

  if (value instanceof Promise)
    return value;

  // Todo: figure out how to do this one.
  // if (value instanceof Proxy)
  //   return value;

  if (value instanceof ArrayBuffer)
    return value;

  if (typeof SharedArrayBuffer === 'function') {
    if (value instanceof SharedArrayBuffer)
      return value;
  }

  if (Buffer.isBuffer(value))
    return value;

  if (ArrayBuffer.isView(value))
    return value;

  if (typeof Blob === 'function') {
    if (value instanceof Blob)
      return value;
  }

  if (typeof File === 'function') {
    if (value instanceof File)
      return value;
  }

  if (typeof FileList === 'function') {
    if (value instanceof FileList)
      return value;
  }

  if (typeof ImageData === 'function') {
    if (value instanceof ImageData)
      return value;
  }

  if (value instanceof backend.MessagePort)
    return new MessagePort(value);

  if (seen.has(value))
    return value;

  if (Array.isArray(value)) {
    seen.add(value);

    for (let i = 0; i < value.length; i++)
      value[i] = unwalk(value[i], seen);

    seen.delete(value);

    return value;
  }

  if (value instanceof Map) {
    const added = [];

    seen.add(value);

    for (const [key, val] of value) {
      const k = unwalk(key, seen);
      const v = unwalk(val, seen);

      if (k !== key) {
        value.delete(key);
        added.push([k, v]);
      } else if (v !== val) {
        value.set(k, v);
      }
    }

    for (const [k, v] of added)
      value.set(k, v);

    seen.delete(value);

    return value;
  }

  if (value instanceof Set) {
    const added = [];

    seen.add(value);

    for (const key of value) {
      const k = unwalk(key, seen);

      if (k !== key) {
        value.delete(key);
        added.push(k);
      }
    }

    for (const k of added)
      value.add(k);

    seen.delete(value);

    return value;
  }

  seen.add(value);

  for (const key of Object.keys(value)) {
    const val = value[key];
    const v = unwalk(val, seen);

    if (v !== val)
      value[key] = v;
  }

  seen.delete(value);

  return value;
}

function format(event) {
  if (event.message == null && event.filename == null)
    return String(event.type || 'unknown');

  return `${event.message} (${event.filename}:${event.lineno}:${event.colno})`;
}

/*
 * Expose
 */

exports.MessagePortBase = MessagePortBase;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.once = once;
exports.morph = morph;
exports.unmorph = unmorph;
exports.format = format;
