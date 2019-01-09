'use strict';

function once(obj, name, func) {
  const on = (event) => {
    if (event === name) {
      obj.removeListener('newListener', on);
      func();
    }
  };

  obj.addListener('newListener', on);
}

module.exports = once;
