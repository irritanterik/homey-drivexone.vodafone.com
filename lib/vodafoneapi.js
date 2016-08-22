var http = require('http.min')
var util = require('util')
var EventEmitter = require('events')

const authEndpoint = 'https://shop.xone.vodafone.com/o/token/'
const apiEndpoint = 'https://drivexone.xone.vodafone.com/drivexone/api/'
const maxSessionRetryCount = 1
const maxNetworkIssueMinutes = 2
const apiError = {
  access_denied: 'access denied',
  no_username: 'no username',
  no_password: 'no password',
  no_vehicles: 'account has no vehicles',
  invalid_grant: 'invalid credentials',
  invalid_token: 'session token is invalid',
  invalid_user: 'user id invalid'
}

function VodafoneApi (options) {
  EventEmitter.call(this)
  if (options == null) { options = {} }
  this.secret = options.secret
  this.user = options.user
  this.password = options.password
  this.userId = null
  this.accessToken = null
  this.activeSessionLast = null
  this.failedSessionCount = 0
  this.networkFailureStart = null
  this.vehicles = []
  this.intervalId = null
  this.intervalMS = options.intervalMS || 10000
}
util.inherits(VodafoneApi, EventEmitter)

VodafoneApi.prototype.getOptions = function () {
  var self = this
  var options = {
    user: self.user,
    userId: self.userId,
    accessToken: self.accessToken,
    vehicles: self.vehicles
  }
  return options
}

VodafoneApi.prototype.getVehicles = function (callback) {
  var self = this
  checkActiveSession(self, function () {
    getVehicles(self.accessToken, callback)
  })
} // End of VodafoneApi.prototype.getItems

VodafoneApi.prototype.getVehicleAddress = function (vehicleId, callback) {
  var self = this
  checkActiveSession(self, function () {
    getVehiclePositionAndStatus(vehicleId, self.accessToken, function (error, position) {
      if (error) return handleError(self, error, 'getVehicleAddress > getVehiclePositionAndStatus')
      getAddress(position.latitude, position.longitude, function (error, address) {
        if (error) return handleError(self, error, 'getVehicleAddress > getAddress')
        return callback(address)
      })
    })
  })
} // End of VodafoneApi.prototype.getVehicleAddress

VodafoneApi.prototype.getVehiclePosition = function (vehicleId, callback) {
  var self = this
  checkActiveSession(self, function () {
    getVehiclePositionAndStatus(vehicleId, self.accessToken, callback)
  })
}

VodafoneApi.prototype.validateAccount = function (callback) {
  var self = this
  login(self.user, self.password, self.secret, function (error, sessionId) {
    if (error) return callback(error)
    callback(null, sessionId)
  })
}

VodafoneApi.prototype.startTracking = function (vehicles) {
  var self = this
  this.vehicles = []
  this.networkFailureStart = null
  this.failedSessionCount = 0
  vehicles.forEach(function (vehicleId) {
    self.vehicles.push({
      vehicleId: vehicleId,
      timestamp: null,
      lat: null,
      lng: null
    })
  })
  Tracking(this)
  this.intervalId = setInterval(
    function () { Tracking(self) }
  , self.intervalMS)
}

VodafoneApi.prototype.stopTracking = function () {
  var self = this
  self.vehicles = []
  this.failedSessionCount = 0
  if (self.intervalId) clearInterval(self.intervalId)
}

function Tracking (self) {
  checkActiveSession(self, function () {
    self.vehicles.forEach(function (item) {
      getVehiclePositionAndStatus(item.vehicleId, self.accessToken, function (error, position) {
        if (error) return handleError(self, error, 'internal > Tracking > getVehiclePositionAndStatus')
        // check diff
        if (position.longitude !== item.lng ||
            position.latitude !== item.lat) {
          item.distance = calculateDistance(position.longitude, position.latitude, item.lng, item.lat, 'M')
          item.lng = position.longitude
          item.lat = position.latitude
          item.timestamp = position.timestamp
          if (item.distance > 0 || !item.address) {
            getAddress(item.lat, item.lng, function (error, address) {
              if (error) return handleError(self, error, 'internal > Tracking > getAddress')
              item.address = address
              self.emit('location', item.vehicleId, item)

              // were so deep here, reset error handling indicators
              this.networkFailureStart = null
              this.failedSessionCount = 0
            })
          } else {
            self.emit('message', item.vehicleId, item)
          }
        } else if (position.timestamp !== item.timestamp) {
          item.timestamp = position.timestamp
          item.distance = 0
          self.emit('message', item.vehicleId, item)
        }
      })
    })
  })
}

function handleError (obj, error, source) {
  if (error === 'invalid_token' || error === 'access_denied') {
    obj.failedSessionCount += 1
    if (obj.failedSessionCount >= maxSessionRetryCount) {
      obj.stopTracking()
      return obj.emit('tracking_terminated', 'Too many failed session errors')
    }
  }
  // invalid username or password
  if (error === 'invalid_grant') {
    obj.stopTracking()
    return obj.emit('tracking_terminated', 'Invalid user name or password')
  }
  // no internet connection
  if (error.stack && error.stack.toUpperCase().indexOf('ENOTFOUND') > -1) {
    if (!obj.networkFailureStart) obj.networkFailureStart = new Date().getTime()
    if (((new Date().getTime() - obj.networkFailureStart) / 1000 / 60) >= maxNetworkIssueMinutes) {
      obj.stopTracking()
      return obj.emit('tracking_terminated', 'Network connection errors for more than ' + maxNetworkIssueMinutes + ' minutes.')
    } else {
      return obj.emit('error', {function: source, error: 'Could not connect to ' + error.hostname})
    }
  }

  obj.emit('error', {function: source, error: error, stack: error.stack})
} // end function handleError

function checkActiveSession (obj, callback) {
  // TODO test sessionmanagement
  if (obj.accessToken == null ||
     (obj.activeSessionLast + (36000 * 1000)) < new Date().getTime() ||
     obj.failedSessionCount > 0) {
    login(obj.user, obj.password, obj.secret, function (error, sessionId) {
      if (error) return handleError(obj, error, 'internal > checkActiveSession > login')
      // obj.userId = userId
      obj.accessToken = sessionId
      obj.activeSessionLast = new Date().getTime()
      obj.failedSessionCount = 0
      callback()
    })
  } else {
    obj.activeSessionLast = new Date().getTime()
    callback()
  }
} // End of checkActiveSession

// login function returns bearer
function login (user, password, secret, callback) {
  if (!user) return callback('no_username')
  if (!password) return callback('no_password')

  var options = {
    uri: authEndpoint, headers: { authorization: 'Basic ' + secret },
    json: true, form: { username: user, password: password, grant_type: 'password' }
  }

  http.post(options).then(function (result) {
    if (result.data.error) return callback(result.data.error)
    callback(null, result.data.access_token)
  }).catch(function (reason) {
    callback(reason)
  })
} // end login

// function getUser returns all user details
function getUser (userId, bearer, callback) {
  getApiResponse('user/' + userId, bearer, function (e, r) {
    callback(e ? 'invalid_user' : null, r)
  })
}
// end getUser

// function getUser returns all user details
function getMe (bearer, callback) {
  getApiResponse('user/me', bearer, function (e, r) {
    callback(e ? 'invalid_user' : null, r)
  })
}
// end getUser

function getVehicles (bearer, callback) {
  getApiResponse('vehicles', bearer, function (e, r) {
    callback(e || !r[0] ? 'no_vehicles' : null, r)
  })
}
// end getVehicles

// function getVehiclesOwnerId returns userId via vehicles owner
function getVehiclesOwnerId (bearer, callback) {
  getApiResponse('vehicles', bearer, function (e, r) {
    callback(e || !r[0] ? 'no_vehicles' : null, (!r[0] ? null : r[0].owner.id))
  })
}
// end getVehiclesOwnerId

function getVehicle (vehicleId, bearer, callback) {
  getApiResponse('vehicles/' + vehicleId, bearer, function (e, r) {
    callback(e, r)
  })
}

// function getVehiclePositionAndStatus
function getVehiclePositionAndStatus (vehicleId, bearer, callback) {
  getApiResponse('vehicles/' + vehicleId + '/currentPositionAndStatus', bearer, function (e, r) {
    callback(e, r)
  })
}
// end getVehiclePositionAndStatus

// getApiResponse executes api get request, returns data
function getApiResponse (service, bearer, callback) {
  var options = {
    uri: apiEndpoint + service,
    headers: {Authorization: 'Bearer ' + bearer}
  }
  http.json(options).then(function (result) {
    if (result.error) return callback(result.error)
    callback(null, result)
  }).catch(function (reason) {
    callback(reason)
  })
} // end getApiResponse function

function calculateDistance (lat1, lon1, lat2, lon2, unit) {
  // based on https://www.geodatasource.com/developers/javascript
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0

  var radlat1 = Math.PI * lat1 / 180
  var radlat2 = Math.PI * lat2 / 180
  var theta = lon1 - lon2
  var radtheta = Math.PI * theta / 180
  var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
  dist = Math.acos(dist)
  dist = dist * 180 / Math.PI
  dist = dist * 60 * 1.1515 // result in Miles per default
  if (unit === 'K') { dist = dist * 1.609344 }
  if (unit === 'M') { dist = dist * 1.609344 * 1000 }
  if (unit === 'N') { dist = dist * 0.8684 }
  return dist
}

function getAddress (latitude, longitude, callback) {
  var osmOptions = {
    uri: 'http://nominatim.openstreetmap.org/reverse',
    query: {format: 'json', lat: latitude, lon: longitude},
    headers: {
      'User-Agent': 'Homey Gps Tracking App - https://github.com/irritanterik/homey-gps-trace.com',
      'Accept-Language': __('settings.OSMlanguage')  // TODO: pass through location settings
    },
    protocol: 'http:'
  }
  http.json(osmOptions).then(function (result) {
    var address = {
      place: result.address.cycleway || result.address.road || result.address.retail || result.address.footway || result.address.address29 || result.address.path || result.address.pedestrian,
      city: result.address.city || result.address.town || result.address.village
    }
    callback(null, address)
  }).catch(function (reason) {
    callback(reason)
  })
} // end getAddress function

exports = module.exports = VodafoneApi
