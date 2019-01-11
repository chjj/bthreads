/* eslint no-var: "off" */
/* global importScripts */

'use strict';

const threads = require('./thread');

global.require = function(location) {
  switch (location) {
    case 'assert':
      return require('assert');
    case 'async_hooks': // Empty.
      return require('async_hooks');
    case 'buffer':
      return require('buffer');
    case 'bthreads':
      return threads;
    case 'child_process': // Empty.
      return require('child_process');
    case 'cluster': // Empty.
      return require('cluster');
    case 'constants': // Extra.
      return require('constants');
    case 'console':
      return require('console');
    case 'crypto': // Extra.
      return require('crypto');
    case 'dgram': // Empty.
      return require('dgram');
    case 'dns': // Empty.
      return require('dns');
    case 'domain': // Extra.
      return require('domain');
    case 'events':
      return require('events');
    case 'fs': // Empty.
      return require('fs');
    case 'http': // Extra.
      return require('http');
    case 'http2': // Extra.
      return require('http2');
    case 'https': // Extra.
      return require('https');
    case 'inspector': // Empty.
      return require('inspector');
    case 'module': // Empty.
      return require('module');
    case 'net': // Empty.
      return require('net');
    case 'os': // Extra.
      return require('os');
    case 'path': // Extra.
      return require('path');
    case 'process':
      return require('process');
    case 'perf_hooks': // Empty.
      return require('perf_hooks');
    case 'punycode': // Extra.
      return require('punycode');
    case 'querystring': // Extra.
      return require('querystring');
    case 'readline': // Empty.
      return require('readline');
    case 'repl': // Empty.
      return require('repl');
    case 'stream': // Extra.
      return require('stream');
    case 'string_decoder':
      return require('string_decoder');
    case 'sys':
      return require('sys');
    case 'timers':
      return require('timers');
    case 'tls': // Empty.
      return require('tls');
    case 'tty': // Extra.
      return require('tty');
    case 'url': // Extra.
      return require('url');
    case 'util':
      return require('util');
    case 'v8': // Empty.
      return require('v8');
    case 'vm': // Extra.
      return require('vm');
    case 'worker_threads':
      return threads;
    case 'zlib': // Extra.
      return require('zlib');
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
global.global = global;
global.process = process;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.setInterval = setInterval;
global.clearInterval = clearInterval;
global.setImmediate = setImmediate;
global.clearImmediate = clearImmediate;

module.exports = threads;
