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

/*
 * Expose
 */

exports.objectString = objectString;
exports.cloneError = cloneError;
