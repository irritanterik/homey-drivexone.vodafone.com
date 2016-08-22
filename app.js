'use strict'
var Geofences = require('./lib/geofences.js')

var self = module.exports = { // eslint-disable-line
  init: function () {
    Geofences.init()
  } // end of module init function
}
