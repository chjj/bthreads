'use strict';

require('./polyfill');

if (typeof global.postMessage === 'function'
    && typeof global.importScripts === 'function'
    && global.self === global) {
  module.exports = require('./thread');
} else if (typeof global.Worker === 'function') {
  module.exports = require('./main');
} else {
  throw new Error('Web workers are unsupported.');
}
