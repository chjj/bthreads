'use strict';

const log = console.log.bind(console);

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
    log,
    polyfill: false
  };
} else {
  module.exports = require('./polyfill');
}
