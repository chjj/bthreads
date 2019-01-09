'use strict';

try {
  module.exports = require('./threads');
} catch (e) {
  module.exports = require('./process');
}
