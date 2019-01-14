/*!
 * backend.js - browser backend selection for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

if (global.Worker) {
  module.exports = {
    self: global.self,
    Worker: global.Worker,
    MessagePort: global.MessagePort,
    MessageChannel: global.MessageChannel,
    location: String(global.location),
    name: global.name,
    close: typeof global.close === 'function'
      ? global.close.bind(global)
      : global.close,
    postMessage: typeof global.postMessage === 'function'
      ? global.postMessage.bind(global)
      : global.postMessage,
    importScripts: typeof global.importScripts === 'function'
      ? global.importScripts.bind(global)
      : global.importScripts,
    onmessage(func) {
      global.onmessage = func;
    },
    onmessageerror(func) {
      global.onmessageerror = func;
    },
    onerror(func) {
      global.onerror = func;
    },
    polyfill: false
  };
} else {
  module.exports = require('./polyfill');
}
