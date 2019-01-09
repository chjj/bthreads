'use strict';

const util = require('util');

/**
 * Console
 */

class Console {
  constructor(stdin, stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.times = Object.create(null);
  }

  log(msg) {
    if (typeof msg !== 'string')
      this.stdin.write(util.inspect(msg) + '\n');
    else
      this.stdin.write(util.format.apply(util, arguments) + '\n');
  }

  warn(msg) {
    if (typeof msg !== 'string')
      this.stdin.write(util.inspect(msg) + '\n');
    else
      this.stdin.write(util.format.apply(util, arguments) + '\n');
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

    if (time == null)
      throw new Error(`No such label: ${label}`);

    const duration = Date.now() - time;

    this.log(`${label}: ${duration}ms`);
  }

  trace() {
    const err = new Error();

    err.name = 'Trace';
    err.message = util.format.apply(util, arguments);

    this.error(err.stack);
  }

  dir(obj, options) {
    this.log(util.inspect(obj, options) + '\n');
  }

  assert(ok, ...args) {
    if (!ok)
      this.error('Assertion failed: ' + util.format(...args));
  }
}

/*
 * Expose
 */

module.exports = Console;
