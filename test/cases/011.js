'use strict';

const assert = require('assert');
const {isMainThread, parentPort, MessagePort} = require('bthreads');

assert(!isMainThread);

parentPort.on('message', (port) => {
  assert(port instanceof MessagePort);
  port.on('message', (msg) => {
    assert.strictEqual(msg, 'hello world');
    setTimeout(() => {
      process.exit(0);
    }, 100);
  });
  port.postMessage('hello world');
});
