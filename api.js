var VodafoneAPI = require('./lib/vodafoneapi.js')

module.exports = [{
  // validate account for use with settings page
  description: 'Validate shop.xone.vodafone.com account settings',
  method: 'GET',
  path:	'/validate/account',
  requires_authorization: true,
  role: 'owner',
  fn: function (callback, args) {
    var tracking = new VodafoneAPI({
      secret: Homey.env.SECRET,
      user: args.query.user,
      password: args.query.password
    })
    tracking.validateAccount(function (error, access_token) {
      tracking = null
      if (error) return callback(error)
      return callback(null, {bearer: access_token})
    })
  }
}, {
  description: 'Get location of Homey',
  method: 'GET',
  path: '/geofence/self',
  requires_authorization: true,
  role: 'owner',
  fn: function (callback, args) {
    Homey.manager('geolocation').getLocation(callback)
  }
}, {
  description: 'Get all trackers',
  method: 'GET',
  path: '/trackers',
  requires_authorization: true,
  role: 'owner',
  fn: function (callback, args) {
    Homey.manager('drivers').getDriver('tracker').getTrackers(function (response) {
      callback(null, response)
    })
  }
}]
