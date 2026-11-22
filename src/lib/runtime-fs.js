'use strict';

let activeFilesystem = require('node:fs');

function setFilesystem(filesystem) {
  activeFilesystem = filesystem;
}

module.exports = new Proxy({ setFilesystem }, {
  get(target, property) {
    if (Object.prototype.hasOwnProperty.call(target, property)) return target[property];
    return Reflect.get(activeFilesystem, property, activeFilesystem);
  },
  set(_target, property, value) {
    activeFilesystem[property] = value;
    return true;
  },
  has(_target, property) {
    return property === 'setFilesystem' || property in activeFilesystem;
  }
});
