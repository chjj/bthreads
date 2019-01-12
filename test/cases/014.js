'use strict';

Buffer.poolSize = 1;

const assert = require('assert');
const {isMainThread, parentPort, backend} = require('bthreads');

assert(!isMainThread);

parentPort.on('message', (buf) => {
  assert(buf instanceof Uint8Array);
  assert(Buffer.from(buf).toString() === 'foobar');

  parentPort.postMessage(buf, [buf.buffer]);

  if (backend === 'web_workers'
      || backend === 'worker_threads') {
    assert(buf.length === 0);
  }

  setTimeout(() => {
    process.exit(0);
  }, 1000);
});
