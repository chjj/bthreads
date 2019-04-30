/*!
 * index.js - worker_threads backend for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

if (process.env.BTHREADS_BACKEND
    && process.env.BTHREADS_BACKEND !== 'worker_threads'
    && process.env.BTHREADS_BACKEND !== 'web_workers') {
  throw new Error('Non-native backend selected.');
}

// Make sure we're not loading a third-party module.
if (require.resolve('worker_threads') !== 'worker_threads') {
  const err = new Error('Cannot find module: \'worker_threads\'');
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

// Ignore all warnings inside worker.
if (!process.chdir)
  process.removeAllListeners('warning');

const threads = require('worker_threads');
const socket = require('../internal/socket');
const source = require('../internal/source');
const utils = require('../internal/utils');

const {
  errors,
  getter,
  bindDefault,
  ArgError,
  WorkerError
} = utils;

exports.isMainThread = threads.isMainThread;
getter(exports, 'parentPort', () => threads.parentPort);
exports.threadId = threads.threadId;
exports.workerData = threads.isMainThread ? null : threads.workerData;
exports.MessagePort = threads.MessagePort;
exports.MessageChannel = threads.MessageChannel;
exports.Worker = threads.Worker;
exports.moveMessagePortToContext = threads.moveMessagePortToContext || null;
exports.receiveMessageOnPort = threads.receiveMessageOnPort || null;
exports.SHARE_ENV = threads.SHARE_ENV || null;
exports._parseOptions = parseOptions;

exports.backend = 'worker_threads';
exports.browser = false;
getter(exports, 'base', () => source.base(__filename));
exports.require = req => source.require(req, __filename);
exports.require.resolve = source.require.resolve;
exports.resolve = req => source.resolve(req, __filename);

exports.exit = process.exit.bind(process);

getter(exports, 'stdin', () => process.stdin);
getter(exports, 'stdout', () => process.stdout);
getter(exports, 'stderr', () => process.stderr);
getter(exports, 'console', () => console);

socket.inject(exports);

/*
 * Bind
 */

if (!threads.isMainThread) {
  bindDefault(process, 'unhandledRejection', (err) => {
    if (!(err instanceof Error))
      err = new Error('Unhandled rejection: ' + err);

    throw err;
  });

  global.importScripts = (url) => {
    global.bthreads = exports;
    delete global.importScripts;
  };
}

/*
 * Helpers
 */

function parseOptions(file, options) {
  if (options == null)
    options = {};

  options = Object.assign({}, options);

  if (typeof file !== 'string')
    throw new ArgError('file', file, 'string');

  if (typeof options !== 'object')
    throw new ArgError('options', options, 'object');

  if (options.eval) {
    if (options.type === 'module')
      throw new WorkerError(errors.ES_MODULE, 'eval');

    if (options.dirname != null) {
      if (typeof options.dirname !== 'string')
        throw new ArgError('dirname', options.dirname, 'string');

      file = wrapDirname(options.dirname, file);
    }
  } else {
    if (options.type != null)
      throw new WorkerError(errors.ES_MODULE, '"type" requires "eval"');
  }

  if (!options.execArgv)
    options.execArgv = process.execArgv.slice();

  if (!Array.isArray(options.execArgv))
    throw new ArgError('execArgv', options.execArgv, 'Array');

  const req = `--require=${__dirname}`;

  if (!options.execArgv.includes(req))
    options.execArgv.push(req);

  return [file, options];
}

function wrapDirname(dirname, body) {
  const code = JSON.stringify(body);
  return ''
    + 'const path = require("path");'
    + 'const modulePaths = require("module")._nodeModulePaths;'
    + `global.__dirname = path.resolve(${JSON.stringify(dirname)});`
    + 'global.__filename = path.join(__dirname, "[worker eval]");'
    + 'module.paths.length = 0;'
    + 'module.paths.push(...modulePaths(__dirname));'
    + 'module.filename = __filename;'
    + `require("vm").runInThisContext(${code}, {`
    + '  filename: __filename,'
    + '  displayErrors: true'
    + '});';
}
