/*!
 * utils.js - utils for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

/*
 * Utils
 */

function objectString(obj) {
  if (obj === undefined)
    return '[object Undefined]';

  if (obj === null)
    return '[object Null]';

  return Object.prototype.toString.call(obj);
}

function cloneError(obj) {
  const err = new Error(`${objectString(obj)} could not be cloned.`);

  err.name = 'DataCloneError';

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, cloneError);

  return err;
}

function duplicateError() {
  const err = new Error('Duplicate items present in transferList.');

  err.name = 'DataCloneError';

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, duplicateError);

  return err;
}

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
          || list[0] === list[2];
    }
    default: {
      const set = new Set(list);
      return set.size !== list.length;
    }
  }
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
  }

  const err = new ErrorType(message);

  err.name = name;
  err.stack = stack;

  for (const [key, value] of values)
    err[key] = value;

  return err;
}

/*
 * Expose
 */

exports.objectString = objectString;
exports.cloneError = cloneError;
exports.duplicateError = duplicateError;
exports.hasDuplicates = hasDuplicates;
exports.toBuffer = toBuffer;
exports.once = once;
exports.setupRefs = setupRefs;
exports.encodeError = encodeError;
exports.decodeError = decodeError;
