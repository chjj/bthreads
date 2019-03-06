#!/usr/bin/env node

'use strict';

const resolve = require('path').resolve.bind(null, __dirname);

require('bpkg')({
  env: 'browser',
  input: resolve('../lib/browser/eval.js'),
  output: resolve('./index.js'),
  plugins: [
    ['babylonia', {
      targets: 'last 2 chrome versions'
    }],
    ['uglify-es', {
      toplevel: true
    }]
  ]
});
