'use strict';

Buffer.poolSize = 1;

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

threads.parentPort.on('message', (buf) => {
  assert(buf instanceof Uint8Array);
  assert(Buffer.from(buf).toString() === 'foobar');

  threads.parentPort.postMessage(buf, [buf.buffer]);

  if (threads.backend === 'web_workers'
      || threads.backend === 'worker_threads') {
    assert(buf.length === 0);
  }

  setTimeout(() => {
    process.exit(0);
  }, 1000);
});
