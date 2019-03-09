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
  TRANSFER: 'Cannot transfer object of unsupported type.', // TransferError

  // Worker Errors
  INVALID_PATH: [
    'ERR_WORKER_PATH',
    'The worker script filename must be a path. Received %j.'
  ],

  UNSUPPORTED_EXTENSION: [
    'ERR_WORKER_UNSUPPORTED_EXTENSION',
    'The worker script extension must be ".js" or ".mjs". Received %j.'
  ],

  INVALID_ARGV: [
    'ERR_WORKER_INVALID_EXEC_ARGV',
    'Initiated Worker with invalid execArgv flags: %a'
  ],

  BUNDLED_EVAL: [
    'ERR_WORKER_BUNDLED_EVAL',
    'Cannot eval worker script when bundled.'
  ],

  INVALID_PACKET: [
    'ERR_WORKER_INVALID_PACKET',
    'Received invalid packet (%s).'
  ],

  INVALID_PORT: [
    'ERR_WORKER_PORT_ID',
    'Invalid port (%s).'
  ],

  UNSERIALIZABLE_ERROR: [
    'ERR_WORKER_UNSERIALIZABLE_ERROR',
    'Serializing an uncaught exception failed'
  ],

  UNSUPPORTED_OPERATION: [
    'ERR_WORKER_UNSUPPORTED_OPERATION',
    '%s is not supported in workers'
  ],

  ES_MODULE: [
    'ERR_WORKER_ES_MODULE',
    'Cannot execute ES module from worker. Reason: %s.'
  ],

  // High Level Worker Errors
  FATAL_ERROR: ['ERR_WORKER_FATAL_ERROR', 'Fatal exception.'],
  PORT_CLOSED: ['ERR_WORKER_PORT_CLOSED', 'Port is closed.'],
  PORT_DESTROYED: ['ERR_WORKER_PORT_DESTROYED', 'Port was destroyed.'],
  BLACKLIST: ['ERR_WORKER_BLACKLIST', 'Cannot bind blacklisted event: %j.'],
  HOOK_NONE: ['ERR_WORKER_HOOK_NONE', 'Hook does not exist: %j.'],
  HOOK_EXISTS: ['ERR_WORKER_HOOK_EXISTS', 'Hook already exists: %j.'],
  JOB_NONE: ['ERR_WORKER_JOB_NONE', 'Job is not in progress (%s).'],
  JOB_COLLISION: ['ERR_WORKER_JOB_COLLISION', 'Job collision (%s).'],
  JOB_TIMEOUT: ['ERR_WORKER_JOB_TIMEOUT', 'Job timed out (%s).'],
  JOB_DESTROYED: ['ERR_WORKER_JOB_DESTROYED', 'Job was destroyed (%s).']
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

/**
 * ArgError
 */

class ArgError extends TypeError {
  constructor(name, value, expect, start) {
    let msg;

    if (Array.isArray(expect) && expect.length === 1)
      [expect] = expect;

    if (Array.isArray(expect)) {
      const last = expect.pop();

      msg = `The "${name}" argument must be one of type `
          + `${expect.join(', ')}, or ${last}. `
          + `Received type ${typeof value}`;
    } else {
      msg = `The "${name}" argument must be of type ${expect}. `
          + `Received type ${typeof value}`;
    }

    super(msg);

    this.code = 'ERR_INVALID_ARG_TYPE';
    this.name = `TypeError [${this.code}]`;

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, start || this.constructor);
  }
}

/**
 * WorkerError
 */

class WorkerError extends Error {
  constructor(desc, arg, start) {
    super();

    if (!Array.isArray(desc))
      desc = errors.FATAL_ERROR;

    let msg = String(desc[1]);

    if (arg != null) {
      msg = msg.replace(/%[ajs]/, (type) => {
        switch (type) {
          case '%j':
            return JSON.stringify(arg);
          case '%a':
            if (Array.isArray(arg))
              return arg.join(', ');
          case '%s':
          default:
            return String(arg);
        }
      });
    }

    this.code = String(desc[0]);
    this.name = `Error [${this.code}]`;
    this.message = msg;

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
    ee.addListener(event, handler);

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
      ee.addListener(event, handler);
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
      err = new WorkerError(errors.UNSERIALIZABLE_ERROR);
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
    throw new ArgError('items', items, 'Array');

  const [name, message, stack, values] = items;

  if (typeof name !== 'string')
    throw new ArgError('name', name, 'string');

  if (typeof message !== 'string')
    throw new ArgError('message', message, 'string');

  if (typeof stack !== 'string')
    throw new ArgError('stack', stack, 'string');

  if (!Array.isArray(values))
    throw new ArgError('values', values, 'Array');

  for (const item of values) {
    if (!Array.isArray(item) || item.length !== 2)
      throw new ArgError('item', item, 'Array');

    if (typeof item[0] !== 'string')
      throw new ArgError('key', item[0], 'string');
  }

  let ErrorType = Error;

  switch (name.split(' [')[0]) {
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

function getter(obj, name, get) {
  Object.defineProperty(obj, name, { get });
}

function noop() {}

/*
 * Expose
 */

exports.custom = custom;
exports.errors = errors;
exports.DataCloneError = DataCloneError;
exports.TransferError = TransferError;
exports.ArgError = ArgError;
exports.WorkerError = WorkerError;
exports.hasDuplicates = hasDuplicates;
exports.hasSelf = hasSelf;
exports.toBuffer = toBuffer;
exports.setupRefs = setupRefs;
exports.bindDefault = bindDefault;
exports.encodeError = encodeError;
exports.decodeError = decodeError;
exports.inspectify = inspectify;
exports.getter = getter;
exports.noop = noop;
