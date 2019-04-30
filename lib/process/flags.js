/*!
 * flags.js - node flags for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://github.com/nodejs/node/blob/master/src/node_options.cc
 */

'use strict';

/*
 * Options
 * https://github.com/nodejs/node/blob/master/src/node_options.cc
 * Last update: b2abda9ba0b7b8bfbbf14e990ea86434f3f20de3
 */

const isolateOptions = new Set([
  // Debug Options
  '--debug',
  '--debug-port',
  '--debug-brk',
  '--inspect',
  '--inspect-port',
  '--inspect-brk',
  '--inspect-brk-node',

  // Environment Options
  '--experimental-json-modules',
  '--experimental-modules',
  '--experimental-policy',
  '--experimental-repl-await',
  '--experimental-vm-modules',
  '--experimental-worker',
  '--experimental-report',
  '--expose-internals',
  '--frozen-intrinsics',
  '--http-parser',
  '--loader',
  '--es-module-specifier-resolution',
  '--no-deprecation',
  '--no-force-async-hooks-checks',
  '--no-warnings',
  '--pending-deprecation',
  '--prof-process',
  '--redirect-warnings',
  '--throw-deprecation',
  '--trace-deprecation',
  '--trace-sync-io',
  '--trace-warnings',
  '--entry-type',
  '--input-type',
  '-c', '--check',
  '-e', '--eval',
  '-p', '--print',
  '-r', '--require',
  '-i', '--interactive',
  '--napi-modules',
  '--tls-v1.0',
  '--tls-v1.1',

  // Per Isolate Options
  '--track-heap-objects',
  '--abort-on-uncaught-exception',
  '--max-old-space-size',
  '--perf-basic-prof',
  '--perf-basic-prof-only-functions',
  '--perf-prof',
  '--perf-prof-unwinding-info',
  '--stack-trace-limit',
  '--diagnostic-report-uncaught-exception',
  '--diagnostic-report-on-signal',
  '--diagnostic-report-on-fatalerror',
  '--diagnostic-report-signal',
  '--diagnostic-report-filename',
  '--diagnostic-report-directory',
  '--diagnostic-report-verbose'

  // Per Process Options
  // '--title',
  // '--trace-event-categories',
  // '--trace-event-file-pattern',
  // '--trace-events-enabled',
  // '--trace-event-categories',
  // '--max-http-header-size',
  // '--v8-pool-size',
  // '--zero-fill-buffers',
  // '--debug-arraybuffer-allocations',
  // '--security-reverts',
  // '--completion-bash',
  // '-h', '--help',
  // '-v', '--version',
  // '--v8-options',
  // '--icu-data-dir',
  // '--openssl-config',
  // '--tls-cipher-list',
  // '--use-openssl-ca',
  // '--use-bundled-ca',
  // '--enable-fips',
  // '--force-fips'
]);

const valueOptions = new Set([
  // Debug Options (some have optional values)
  // '--debug',
  '--debug-port',
  // '--debug-brk',
  // '--inspect',
  '--inspect-port',
  // '--inspect-brk',
  // '--inspect-brk-node',

  // Environment Options
  '--experimental-policy',
  '--http-parser',
  '--loader',
  '--es-module-specifier-resolution',
  '--redirect-warnings',
  '--entry-type',
  '--input-type',
  '-e', '--eval',
  '-p', '--print',
  '-r', '--require',

  // Per Isolate Options
  '--max-old-space-size',
  '--stack-trace-limit',
  '--diagnostic-report-signal',
  '--diagnostic-report-filename',
  '--diagnostic-report-directory',

  // Per Process Options
  '--title',
  '--trace-event-categories',
  '--trace-event-file-pattern',
  '--max-http-header-size',
  '--v8-pool-size',
  '--icu-data-dir',
  '--openssl-config',
  '--tls-cipher-list',

  // To filter out resource limits:
  '--max-semi-space-size'
]);

const invalidOptions = new Set([
  // Debug Options
  '--debug',
  '--debug-port',
  '--debug-brk',
  '--inspect',
  '--inspect-port',
  '--inspect-brk',
  '--inspect-brk-node',

  // Environment Options
  '--prof-process',
  '-c', '--check',
  '-e', '--eval',
  '-p', '--print',
  '-i', '--interactive',

  // Per Process Options
  '--title',
  '--completion-bash',
  '-h', '--help',
  '-v', '--version',
  '--v8-options',

  // Bad idea to allow this right now.
  '--entry-type',
  '--input-type',

  // At some point in the future, --frozen-intrinsics
  // may disallow us from hooking into the console.
  // This is bad for our worker process since it
  // communicates through stdout. We don't want anyone
  // mistakenly console.logging and screwing up our
  // makeshift IPC channel. See:
  // https://github.com/nodejs/node/pull/25685#issuecomment-457564897
  '--frozen-intrinsics',

  // To filter out resource limits:
  '--max-old-space-size',
  '--max-semi-space-size',

  // Filter out ESM loader.
  '--loader'
]);

/*
 * Helpers
 */

function hasOption(options, arg, slice) {
  if (typeof arg !== 'string')
    return false;

  if (arg.length === 0)
    return false;

  if (arg[0] !== '-')
    return false;

  if (arg.startsWith('-_'))
    return false;

  if (arg === '-' || arg === '--')
    return false;

  if (arg.startsWith('--')) {
    const index = arg.indexOf('=');

    if (index !== -1) {
      if (!slice)
        return false;

      arg = arg.substring(0, index);
    }
  }

  arg = arg.replace(/_/g, '-');

  return options.has(arg);
}

/*
 * API
 */

function isIsolateOption(arg) {
  return hasOption(isolateOptions, arg, true);
}

function isValueOption(arg) {
  return hasOption(valueOptions, arg, false);
}

function isInvalidOption(arg) {
  return hasOption(invalidOptions, arg, true);
}

/*
 * Expose
 */

exports.isIsolateOption = isIsolateOption;
exports.isValueOption = isValueOption;
exports.isInvalidOption = isInvalidOption;
