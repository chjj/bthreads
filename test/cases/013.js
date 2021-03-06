'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

threads.parentPort.on('message', (port) => {
  assert(port instanceof threads.MessagePort);
  port.postMessage('hello from below');
  setTimeout(() => {
    process.exit(0);
  }, 10);
});
