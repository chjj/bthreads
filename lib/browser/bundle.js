'use strict';

const socket = require('../internal/socket');
const {MessagePortBase, MessageChannel} = require('./common');
const Parent = require('./parent');
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._threadId;
exports.workerData = parent._workerData;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = null;
exports.browser = true;

socket.inject(exports);

global.require = function(location) {
  switch (location) {
    case 'assert':
      return require('assert');
    case 'buffer':
      return require('buffer');
    case 'bthreads':
      return exports;
    case 'console':
      return require('console');
    case 'events':
      return require('events');
    case 'os': // Note: extra.
      return require('os');
    case 'path': // Note: extra.
      return require('path');
    case 'process':
      return require('process');
    case 'querystring': // Note: extra.
      return require('querystring');
    case 'stream': // Note: extra.
      return require('stream');
    case 'string_decoder':
      return require('string_decoder');
    case 'sys':
    case 'util':
      return require('util');
    case 'url': // Note: extra.
      return require('url');
    case 'timers':
      return require('timers');
    default:
      return require(location);
  }
};

global.require.resolve = require.resolve;
global.require.main = null;
global.require.extensions = require.extensions;
global.require.cache = require.extensions;

global.Buffer = Buffer;
global.console = console;
global.process = process;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.setInterval = setInterval;
global.clearInterval = clearInterval;
global.setImmediate = setImmediate;
global.clearImmediate = clearImmediate;
