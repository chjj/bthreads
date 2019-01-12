'use strict';

if (global.Worker || global.importScripts) {
  module.exports = {
    self: global.self,
    Worker: global.Worker,
    MessagePort: global.MessagePort,
    MessageChannel: global.MessageChannel,
    location: String(global.location),
    name: global.name,
    close: global.close,
    postMessage: global.postMessage,
    importScripts: global.importScripts,
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
