'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

setInterval(() => {}, 1000);

threads.parentPort.postMessage('kill me');
