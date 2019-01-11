'use strict';

const backend = require('./backend');

if (typeof backend.postMessage === 'function'
    && typeof backend.importScripts === 'function'
    && backend.self === global) {
  module.exports = require('./thread');
} else if (typeof backend.Worker === 'function') {
  module.exports = require('./main');
} else {
  throw new Error('Web workers are unsupported.');
}
