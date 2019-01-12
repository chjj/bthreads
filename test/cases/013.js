'use strict';

const assert = require('assert');
const {isMainThread, parentPort, MessagePort} = require('bthreads');

assert(!isMainThread);

parentPort.on('message', (port) => {
  assert(port instanceof MessagePort);
  port.postMessage('hello from below');

  setTimeout(() => {
    process.exit(0);
  }, 1000);
});
