'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  threads.parentPort.postMessage(data.trim() + 'bar');
});

setTimeout(() => {
  process.exit(0);
}, 100);
