#!/usr/bin/env node

'use strict';

require('bpkg')({
  env: 'browser',
  input: 'lib/browser/bundle.js',
  output: 'etc/bundle.js',
  plugins: [
    ['babylonia', {
      targets: 'last 2 chrome versions'
    }],
    ['uglify-es', {
      toplevel: true
    }]
  ]
});
