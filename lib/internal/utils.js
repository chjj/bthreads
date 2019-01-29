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
