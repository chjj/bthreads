'use strict';

const assert = require('assert');
const {isMainThread, parentPort} = require('bthreads');

assert(!isMainThread);

setInterval(() => {}, 1000);

parentPort.postMessage('kill me');
