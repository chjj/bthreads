/*!
 * console.js - console object for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://nodejs.org/api/console.html
 */

'use strict';

const util = require('util');

/**
 * Console
 */

class Console {
  constructor(stdout, stderr) {
    this.Console = this.constructor;
    this.stdout = stdout;
    this.stderr = stderr;
    this.times = Object.create(null);

    for (const key of ['log',
                       'info',
                       'warn',
                       'error',
                       'time',
                       'timeEnd',
                       'trace',
                       'dir',
                       'assert']) {
      this[key] = this[key].bind(this);
    }
  }

  log(msg) {
    if (typeof msg !== 'string')
      this.stdout.write(util.inspect(msg) + '\n');
    else
      this.stdout.write(util.format.apply(util, arguments) + '\n');
  }

  info() {
    return this.log.apply(this, arguments);
  }

  warn(msg) {
    if (typeof msg !== 'string')
      this.stderr.write(util.inspect(msg) + '\n');
    else
      this.stderr.write(util.format.apply(util, arguments) + '\n');
  }

  error(msg) {
    if (typeof msg !== 'string')
      this.stderr.write(util.inspect(msg) + '\n');
    else
      this.stderr.write(util.format.apply(util, arguments) + '\n');
  }

  time(label) {
    this.times[label] = Date.now();
  }

  timeEnd(label) {
    const time = this.times[label];

    if (time == null) {
      this.warn(`No such label '${label}' for console.timeEnd()`);
      return;
    }

    const ms = Date.now() - time;

    this.log(`${label}: ${ms.toFixed(3)}ms`);
  }

  trace() {
    const err = new Error();

    err.name = 'Trace';
    err.message = util.format.apply(util, arguments);

    if (Error.captureStackTrace)
      Error.captureStackTrace(err, this.trace);

    this.error(err.stack);
  }

  dir(obj, options) {
    options = Object.assign({ customInspect: false }, options);
    this.log(util.inspect(obj, options) + '\n');
  }

  assert(ok, ...args) {
    if (!ok)
      this.error('Assertion failed: ' + util.format(...args));
  }

  inject(console) {
    for (const key of ['log',
                       'info',
                       'warn',
                       'error',
                       'time',
                       'timeEnd',
                       'trace',
                       'dir',
                       'assert']) {
      try {
        console[key] = this[key];
      } catch (e) {
        ;
      }
    }
  }
}

/*
 * Expose
 */

module.exports = Console;
