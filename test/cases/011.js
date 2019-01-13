'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

threads.parentPort.on('message', (port) => {
  assert(port instanceof threads.MessagePort);
  port.on('message', (msg) => {
    assert.strictEqual(msg, 'hello world');
    setTimeout(() => {
      process.exit(0);
    }, 100);
  });
  port.postMessage('hello world');
});
