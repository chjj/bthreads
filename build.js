#!/usr/bin/env node

'use strict';

const fs = require('fs');
const {resolve} = require('path');
const bpkg = require('bpkg');
const input = resolve(__dirname, 'lib/browser/bundle.js');
const output = resolve(__dirname, 'lib/browser/bundle.json');

(async () => {
  const code = await bpkg({
    env: 'browser',
    input: input,
    plugins: [
      ['babylonia', {
        targets: 'last 2 versions'
      }],
      ['uglify-es', {
        toplevel: true
      }]
    ]
  });

  fs.writeFileSync(output, JSON.stringify(code.trim()) + '\n');
})();
