'use strict';

const {
  Worker, isMainThread, parentPort, workerData, MessagePort
} = require('bthreads');

if (isMainThread) {
  (async function() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: Buffer.from('foo')
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0)
          reject(new Error(`Worker stopped with exit code ${code}`));
      });
    });
  })().then((result) => {
    console.log(result);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  parentPort.postMessage(Buffer.from('bar'));
}
