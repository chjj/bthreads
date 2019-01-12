'use strict';

const assert = require('assert');
const {isMainThread, parentPort} = require('bthreads');

assert(!isMainThread);

process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  parentPort.postMessage(data.trim() + 'bar');
});

setTimeout(() => {
  process.exit(0);
}, 100);
