'use strict';

const assert = require('assert');
const {join} = require('path');
const bthreads = require('../');

describe('Threads', () => {
  it('should create worker', () => {
    const worker = new bthreads.Worker(join(__dirname, 'util/worker.js'), {
      stdin: true,
      stdout: true,
      stderr: true,
      workerData: { foo: 1 }
    });

    worker.on('message', (msg) => {
      console.log(msg);
    });
  });
});
