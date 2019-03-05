/*!
 * utils.js - utils for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const util = require('util');

/*
 * Constants
 */

const custom = util.inspect.custom || 'inspect';

const errors = {
  COULD_NOT_CLONE: 'Object could not be cloned.',
  DUPLICATE_ITEM: 'Transfer list contains duplicate item.',
  SOURCE_PORT: 'Transfer list contains source port.',
  DETACHED: 'MessagePort in transfer list is already detached.',
  NO_PORT: 'MessagePort was found in message but not listed in transferList.',
  INVALID_OBJECT: 'Found invalid object in transferList.',
  RESULT: 'Call result must be in the form of [result, transferList].',
  INVALID_LIST: 'Invalid transfer list.', // TypeError
  TRANSFER: 'Cannot transfer object of unsupported type.' // TransferError
};

/**
 * DataCloneError
 */

class DataCloneError extends Error {
  constructor(msg, start) {
    super();

    if (msg == null)
      msg = errors.COULD_NOT_CLONE;

    this.name = 'DataCloneError';
    this.message = String(msg || '');

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, start || this.constructor);
  }
}

/**
 * TransferError
 */

class TransferError extends TypeError {
  constructor(msg, start) {
    super();

    if (msg == null)
      msg = errors.TRANSFER;

    this.code = 'ERR_CANNOT_TRANSFER_OBJECT';
    this.message = String(msg || '');

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, start || this.constructor);
  }
}

/*
 * Utils
 */

function hasDuplicates(list) {
  if (!Array.isArray(list))
    return false;

  switch (list.length) {
    case 0:
    case 1: {
      return false;
    }
    case 2: {
      return list[0] === list[1];
    }
    case 3: {
      return list[0] === list[1]
          || list[1] === list[2]
          || list[2] === list[0];
    }
    default: {
      const set = new Set(list);
      return set.size !== list.length;
    }
  }
}

function hasSelf(list, port) {
  if (!Array.isArray(list))
    return false;

  return list.includes(port);
}

function toBuffer(value) {
  if (value instanceof Uint8Array)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

function once(obj, names, func) {
  if (!Array.isArray(names))
    names = [names];

  const on = (name) => {
    if (names.includes(name)) {
      obj.removeListener('newListener', on);
      func();
    }
  };

  obj.addListener('newListener', on);
}

function setupRefs(ref, ee, event) {
  ref.unref();

  ee.on('newListener', (name) => {
    if (name === event && ee.listenerCount(event) === 0)
      ref.ref();
  });

  ee.on('removeListener', (name) => {
    if (name === event && ee.listenerCount(event) === 0)
      ref.unref();
  });
}

function bindDefault(ee, event, handler) {
  const maxListeners = ee._maxListeners;

  ee.setMaxListeners(Infinity);

  if (ee.listenerCount(event) === 0)
    ee.on(event, handler);

  // Note: newListener increments count _after_ emission.
  ee.on('newListener', (name, listener) => {
    if (name !== event || handler === listener)
      return;

    if (ee.listenerCount(event) === 1)
      ee.removeListener(event, handler);
  });

  // Note: removeListener decrements count _before_ emission.
  ee.on('removeListener', (name, listener) => {
    if (name !== event || handler === listener)
      return;

    if (ee.listenerCount(event) === 0)
      ee.on(event, handler);
  });

  ee._maxListeners = maxListeners;
}

function encodeError(err) {
  if (!(err instanceof Error)) {
    if (typeof err === 'string')
      err = new Error(err);
    else if (err && typeof err.message === 'string')
      err = new Error(err.message);
    else
      err = new Error('Could not serialize error.');
  }

  const values = [];

  for (const key of Object.keys(err)) {
    if (key === 'name'
        || key === 'message'
        || key === 'stack') {
      continue;
    }

    const value = err[key];

    if (value !== null && typeof value === 'object')
      continue;

    if (typeof value === 'function')
      continue;

    if (typeof value === 'symbol')
      continue;

    values.push([key, value]);
  }

  return [
    String(err.name),
    String(err.message),
    String(err.stack),
    values
  ];
}

function decodeError(items) {
  if (!Array.isArray(items) || items.length !== 4)
    throw new TypeError('"items" must be an array.');

  const [name, message, stack, values] = items;

  let ErrorType = Error;

  switch (name) {
    case 'EvalError':
      ErrorType = EvalError;
      break;
    case 'RangeError':
      ErrorType = RangeError;
      break;
    case 'ReferenceError':
      ErrorType = ReferenceError;
      break;
    case 'SyntaxError':
      ErrorType = SyntaxError;
      break;
    case 'TypeError':
      ErrorType = TypeError;
      break;
    case 'URIError':
      ErrorType = URIError;
      break;
    case 'DataCloneError':
      ErrorType = DataCloneError;
      break;
  }

  const err = new ErrorType(message);

  err.name = name;
  err.stack = stack;

  for (const [key, value] of values)
    err[key] = value;

  return err;
}

function inspectify(parent, ...details) {
  const obj = Object.create({ constructor: parent });
  return Object.assign(obj, ...details);
}

/*
 * Expose
 */

exports.custom = custom;
exports.errors = errors;
exports.DataCloneError = DataCloneError;
exports.TransferError = TransferError;
exports.hasDuplicates = hasDuplicates;
exports.hasSelf = hasSelf;
exports.toBuffer = toBuffer;
exports.once = once;
exports.setupRefs = setupRefs;
exports.bindDefault = bindDefault;
exports.encodeError = encodeError;
exports.decodeError = decodeError;
exports.inspectify = inspectify;
