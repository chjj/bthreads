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
const globalConsole = console;

/*
 * Constants
 */

const methods = [
  'assert',
  'clear',
  'count',
  'countReset',
  'debug',
  'dir',
  'dirxml',
  'error',
  'group',
  'groupCollapsed',
  'groupEnd',
  'info',
  'log',
  'table',
  'time',
  'timeEnd',
  'timeLog',
  'trace',
  'warn',
  'markTimeline',
  'profile',
  'profileEnd',
  'timeStamp',
  'timeline',
  'timelineEnd'
];

/**
 * Console
 */

class Console {
  constructor(stdout, stderr) {
    this.Console = this.constructor;
    this._stdout = stdout;
    this._stderr = stderr;
    this._counts = Object.create(null);
    this._times = Object.create(null);
    this._indents = 0;

    for (const key of methods)
      this[key] = this[key].bind(this);
  }

  assert(ok, ...args) {
    if (!ok) {
      if (args.length > 0)
        this.warn('Assertion failed: ' + util.format(...args));
      else
        this.warn('Assertion failed');
    }
  }

  clear() {
    globalConsole.clear();
  }

  count(label = 'default') {
    if (this._counts[label] == null)
      this._counts[label] = 0;

    this._counts[label] += 1;

    this.log(`${label}: ${this._counts[label]}`);
  }

  countReset(label = 'default') {
    if (this._counts[label] == null)
      this.warn(`Warning: Count for '${label}' does not exist`);
    else
      delete this._counts[label];
  }

  debug(...args) {
    this.log(...args);
  }

  dir(obj, options) {
    const opt = { customInspect: false };

    Object.assign(opt, options);

    this.log(util.inspect(obj, opt) + '\n');
  }

  dirxml(obj, options) {
    this.dir(obj, options);
  }

  error(...args) {
    this._stderr.write(this._indent() + util.format(...args) + '\n');
  }

  group(...labels) {
    this.log(...labels);
    this._indents += 1;
  }

  groupCollapsed(...labels) {
    this.group(...labels);
  }

  groupEnd() {
    if (this._indents > 0)
      this._indents -= 1;
  }

  info(...args) {
    this.log(...args);
  }

  log(...args) {
    this._stdout.write(this._indent() + util.format(...args) + '\n');
  }

  table(...args) {
    this.log(...args);
  }

  time(label = 'default') {
    this._times[label] = Date.now();
  }

  timeEnd(label = 'default') {
    this._time('timeEnd', label);
  }

  timeLog(label = 'default', ...args) {
    this._time('timeLog', label, ...args);
  }

  trace(...args) {
    const err = new Error();

    err.name = 'Trace';
    err.message = util.format(...args);

    if (Error.captureStackTrace)
      Error.captureStackTrace(err, Console.prototype.trace);

    this.error(err.stack);
  }

  warn(...args) {
    this.error(...args);
  }

  markTimeline(label) {
    globalConsole.markTimeline(label);
  }

  profile(label) {
    globalConsole.profile(label);
  }

  profileEnd(label) {
    globalConsole.profileEnd(label);
  }

  timeStamp(label) {
    globalConsole.timeStamp(label);
  }

  timeline(label) {
    globalConsole.timeline(label);
  }

  timelineEnd(label) {
    globalConsole.timelineEnd(label);
  }

  _indent() {
    let out = '';

    for (let i = 0; i < this._indents; i++)
      out += '  ';

    return out;
  }

  _time(method, label, ...args) {
    const time = this._times[label];

    if (time == null) {
      this.warn(`Warning: No such label '${label}' for console.${method}()`);
      return;
    }

    const ms = Date.now() - time;

    let text = `${label}: ${ms.toFixed(3)}ms`;

    if (args.length > 0)
      text += ` ${util.format(...args)}`;

    this.log(text);

    if (method === 'timeEnd')
      delete this._times[label];
  }

  _inject(console) {
    for (const key of ['Console', ...methods]) {
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
