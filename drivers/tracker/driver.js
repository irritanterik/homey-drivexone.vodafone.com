/* global Homey */
'use strict'

var VodafoneApi = require('../../lib/vodafoneapi.js')
var Util = require('../../lib/util.js')
var Inside = require('point-in-polygon')
var retryTrackingTimeoutId = null
var tracking = null
var trackers = {}
var trackerTimeoutObjects = {}
var geofences = {}
var debugSetting = true
var debugLog = []

function GpsDebugLog (message, data) {
  if (!debugSetting) return
  if (!debugLog) debugLog = []
  if (!data) data = null

  // Push new event, remove items over 100 and save new array
  Homey.manager('api').realtime('gpsLog', {datetime: new Date(), message: message, data: data})
  debugLog.push({datetime: new Date(), message: message, data: data})
  if (debugLog.length > 100) debugLog.splice(0, 1)
  if (data == null) {
    Homey.log(Util.epochToTimeFormatter(), message)
  } else {
    Homey.log(Util.epochToTimeFormatter(), message, data)
  }
  Homey.manager('settings').set('gpsLog', debugLog)
} // function GpsDebugLog

function checkGeofences (notrigger) {
  if (!trackers) return
  Object.keys(trackers).forEach(function (trackerId) {
    checkGeofencesForTracker(trackerId, notrigger)
  })
}

function checkGeofencesForTracker (trackerId, notrigger) {
  if (!geofences) return
  Object.keys(geofences).forEach(function (geofenceId) {
    var trackerInGeofence = false
    var trackerWasInGeofence = trackers[trackerId].geofences.indexOf(geofenceId) !== -1
    if (geofences[geofenceId].type === 'CIRCLE') {
      var distance = Util.calculateDistance(
        trackers[trackerId].location.lat,
        trackers[trackerId].location.lng,
        geofences[geofenceId].circle.center.lat,
        geofences[geofenceId].circle.center.lng,
        'M'
      )
      trackerInGeofence = distance < geofences[geofenceId].circle.radius
    } else {
      var trackerPositionShort = [trackers[trackerId].location.lat, trackers[trackerId].location.lng]
      var geofencePathShort = []
      if (geofences[geofenceId].type === 'POLYGON') {
        geofences[geofenceId].polygon.path.forEach(function (point) {
          geofencePathShort.push([point.lat, point.lng])
        })
      } else {
        geofences[geofenceId].rectangle.path.forEach(function (point) {
          geofencePathShort.push([point.lat, point.lng])
        })
      }
      trackerInGeofence = Inside(trackerPositionShort, geofencePathShort)
    }
    if ((trackerInGeofence) && (!trackerWasInGeofence)) {
      trackers[trackerId].geofences.push(geofenceId)
      if (!notrigger) {
        Homey.manager('flow').triggerDevice(
          'tracker_geofence_entered',
          null, // notokens
          {geofence: geofenceId},
          {id: trackerId},
          function (err, result) {
            GpsDebugLog('flow trigger tracker_geofence_entered ', {id: trackerId, geofenceId: geofenceId, error: err, result: result})
          }
        )
      }
    }
    if ((!trackerInGeofence) && (trackerWasInGeofence)) {
      trackers[trackerId].geofences.splice(trackers[trackerId].geofences.indexOf(geofenceId), 1)
      if (!notrigger) {
        Homey.manager('flow').triggerDevice(
          'tracker_geofence_left',
          null, // notokens
          {geofence: geofenceId},
          {id: trackerId},
          function (err, result) {
            GpsDebugLog('flow trigger tracker_geofence_left ', {id: trackerId, geofenceId: geofenceId, error: err, result: result})
          }
        )
      }
    }
  })
}

function stopMoving (trackerId) {
  GpsDebugLog('stopMoving called', {trackerId: trackerId, moving: trackers[trackerId].moving})
  trackerTimeoutObjects[trackerId] = null
  if (!trackers[trackerId].moving) return
  if (!trackers[trackerId].route) return

  // create route object for persistancy
  var route = trackers[trackerId].route
  route.end = trackers[trackerId].location
  route.end.time = trackers[trackerId].timeLastUpdate
  route.trackerId = trackerId

  // only save route if distance > 1000m
  if ((trackers[trackerId].route.distance || 0) > 1000) {
    // TODO: Read setting if route analysis is allowed
    var allRoutes = Homey.manager('settings').get('gpsRoutes') || []
    allRoutes.push(route)
    Homey.manager('settings').set('gpsRoutes', allRoutes)
  }
  // update tracker
  delete trackers[trackerId].route
  trackers[trackerId].moving = false
  Homey.manager('api').realtime('gpsLocation', trackers[trackerId])

  // handle flows
  var tracker_tokens = {
    start_location: Util.createAddressSpeech(route.start.place, route.start.city),
    stop_location: Util.createAddressSpeech(route.end.place, route.end.city),
    distance: Math.ceil(route.distance) || 0
  }

  Homey.manager('flow').triggerDevice(
    'tracker_stopt_moving',
    tracker_tokens,
    null,
    {id: trackerId},
    function (err, result) {
      GpsDebugLog('flow trigger tracker_stopt_moving ', {id: trackerId, error: err, result: result})
    }
  )
}

function updateTracker (trackerId, callback) {
  GpsDebugLog('######### VODAFONE DRIVEXONE ## updateTracker #########################')
  var settings = Homey.manager('settings').get('gpsaccount')
  if (!settings) return callback('no settings!')
  if (!trackerId) return callback('no device!')

  var singleTrack = new VodafoneApi({
    secret: Homey.env.SECRET,
    user: settings.user,
    password: settings.password
  })
  singleTrack.getVehicleAddress(trackerId, function (address) {
    trackers[trackerId].location = address
    callback(null, trackerId)
  })
  singleTrack.on('error', function (error) {
    GpsDebugLog('event: error', error)
    if (error) return callback(error)
  })
}

function initiateTracking () {
  if (retryTrackingTimeoutId) clearTimeout(retryTrackingTimeoutId)
  debugLog = Homey.manager('settings').get('gpsLog')
  debugSetting = true
  retryTrackingTimeoutId = null

  GpsDebugLog('######### VODAFONE DRIVEXONE ## initiateTracking #########################')
  if (tracking) tracking.stopTracking()
  tracking = null

  geofences = Homey.manager('settings').get('geofences')
  var settings = Homey.manager('settings').get('gpsaccount')
  if (!settings) return GpsDebugLog('  no settings!')
  if (!settings.debug) debugSetting = false
  if (!Object.keys(trackers).length) return GpsDebugLog('  no devices to track!')
  if (!settings.polling) return GpsDebugLog('  polling disabled in settings')

  Object.keys(trackers).forEach(function (trackerId) {
    trackers[trackerId].timeLastTrigger = 0
    // clear route tracking if tracker is not moving or never initiated before
    if (trackers[trackerId].moving !== true) {
      trackers[trackerId].moving = null // picked on location event
      if (trackerTimeoutObjects[trackerId]) {
        clearTimeout(trackerTimeoutObjects[trackerId])
        trackerTimeoutObjects[trackerId] = null
        delete trackers[trackerId].route
      }
    }
  })

  tracking = new VodafoneApi({
    secret: Homey.env.SECRET,
    user: settings.user,
    password: settings.password,
    intervalMS: 10000 // TODO: read from app setting
  })
  tracking.on('error', function (error) {
    GpsDebugLog('event: error', error)
  })
  tracking.on('tracking_terminated', function (reason) {
    if (tracking) {
      GpsDebugLog('event: tracking_terminated, will retry in 10 minutes.', reason)
      tracking = null
      if (!retryTrackingTimeoutId) {
        retryTrackingTimeoutId = setTimeout(initiateTracking, 10 * 60 * 1000)
      }
    }
  })
  tracking.on('message', function (trackerId, data) {
    GpsDebugLog('event: message', {id: trackerId, distance: data.distance})
  })
  tracking.on('location', function (trackerId, data) {
    var previousLocation = trackers[trackerId].location
    var place = data.address.place
    var city = data.address.city
    var wasMoving = trackers[trackerId].moving

    trackers[trackerId].location = {
      place: place,
      city: city,
      lat: data.lat,
      lng: data.lng
    }
    trackers[trackerId].timeLastUpdate = data.t // TODO convert to epoch * 1000

    var timeConstraint = (trackers[trackerId].timeLastUpdate - trackers[trackerId].timeLastTrigger) < (trackers[trackerId].settings.retriggerRestrictTime * 1000)
    var distanceConstraint = data.distance < trackers[trackerId].settings.retriggerRestrictDistance

    // ignore initial location on (re)initiation
    if (wasMoving == null) {
      trackers[trackerId].moving = false
      checkGeofencesForTracker(trackerId, true)
      GpsDebugLog('initial location for tracker', {id: trackerId, place: place, city: city})
      return
    }

    // handle flows
    GpsDebugLog('event: location', {id: trackerId, place: place, city: city, distance: data.distance, wasMoving: wasMoving, timeConstraint: timeConstraint, distanceConstraint: distanceConstraint})
    checkGeofencesForTracker(trackerId)
    if (wasMoving) {
      // next if part is temp fix. Should be removed when bug final fixed
      if (!trackers[trackerId].route) {
        GpsDebugLog('tracker was moving, but without route object', {id: trackerId, tracker: trackers[trackerId]})
        trackers[trackerId].route = {
          distance: data.distance,
          start: previousLocation
        }
      } else {
        trackers[trackerId].route.distance += data.distance
      }
    }

    if (!wasMoving && !distanceConstraint) {
      trackers[trackerId].moving = true
      trackers[trackerId].route = {
        distance: data.distance,
        start: previousLocation
      }
      trackers[trackerId].route.start.time = data.t * 1000
      Homey.manager('flow').triggerDevice(
        'tracker_start_moving',
        {
          address: Util.createAddressSpeech(previousLocation.place, previousLocation.city),
          distance: Math.ceil(data.distance) || 0
        },
        null,
        {id: trackerId},
        function (err, result) {
          GpsDebugLog('flow trigger tracker_start_moving ', {id: trackerId, error: err, result: result})
        }
      )
    }

    if (!timeConstraint && !distanceConstraint) {
      trackers[trackerId].timeLastTrigger = data.t * 1000
      Homey.manager('flow').triggerDevice(
        'tracker_moved',
        {
          address: Util.createAddressSpeech(place, city),
          distance: Math.ceil(data.distance) || 0
        },
        null,
        {id: trackerId},
        function (err, result) {
          GpsDebugLog('flow trigger tracker_moved ', {id: trackerId, error: err, result: result})
        }
      )
    }

    // postpone stopmoving trigger
    if (trackers[trackerId].moving) {
      if (trackerTimeoutObjects[trackerId]) clearTimeout(trackerTimeoutObjects[trackerId])
      trackerTimeoutObjects[trackerId] = setTimeout(
        stopMoving,
        trackers[trackerId].settings.stoppedMovingTimeout * 1000,
        trackerId
      )
    }

    Homey.manager('api').realtime('gpsLocation', trackers[trackerId])
  })
  tracking.startTracking(Object.keys(trackers))
} // function initiateTracking

var self = {
  init: function (devices_data, callback) {
    // initial load of trackers object
    devices_data.forEach(function (device_data) {
      Homey.manager('drivers').getDriver('tracker').getName(device_data, function (err, name) {
        if (err) return
        trackers[device_data.id] = {
          trackerId: device_data.id,
          name: name,
          location: {},
          geofences: []
        }
        trackerTimeoutObjects[device_data.id] = null
        module.exports.getSettings(device_data, function (err, settings) {
          if (err) GpsDebugLog('Error on loading device settings', {device_data: device_data, error: err})
          var trackersettings = {
            retriggerRestrictTime: settings.retriggerRestrictTime || 1,
            retriggerRestrictDistance: settings.retriggerRestrictDistance || 1,
            stoppedMovingTimeout: settings.stoppedMovingTimeout || 120
          }
          trackers[device_data.id].settings = trackersettings
        })
      })
    })

    function geofencesFilteredList (value) {
      var result = []
      if (!geofences) return result
      Object.keys(geofences).forEach(function (geofenceId) {
        if (geofences[geofenceId].name.toUpperCase().indexOf(value.toUpperCase()) > -1) {
          result.push({name: geofences[geofenceId].name, geofenceId: geofenceId})
        }
      })
      return result
    }

    Homey.manager('flow').on('condition.tracker_geofence.geofence.autocomplete', function (callback, value) {
      callback(null, geofencesFilteredList(value.query))
    })
    Homey.manager('flow').on('trigger.tracker_geofence_entered.geofence.autocomplete', function (callback, value) {
      callback(null, geofencesFilteredList(value.query))
    })
    Homey.manager('flow').on('trigger.tracker_geofence_left.geofence.autocomplete', function (callback, value) {
      callback(null, geofencesFilteredList(value.query))
    })
    Homey.manager('flow').on('condition.tracker_moving', function (callback, args) {
      GpsDebugLog('Flow condition tracker_moving', args)
      callback(null, trackers[args.device.id].moving === true)
    })
    Homey.manager('flow').on('condition.tracker_geofence', function (callback, args) {
      GpsDebugLog('Flow condition tracker_geofence', args)
      checkGeofencesForTracker(args.device.id, true)
      callback(null, trackers[args.device.id].geofences.indexOf(args.geofence.geofenceId) !== -1)
    })
    Homey.manager('flow').on('action.get_position', function (callback, args) {
      GpsDebugLog('Flow action get_position', args)
      // TODO: force position update for tracker if polling is disabled
      // TODO: do *all* the update and trigger magic here
    })
    Homey.manager('flow').on('trigger.tracker_geofence_entered', function (callback, args, state) {
      GpsDebugLog('flow trigger tracker_geofence_entered evaluation', {card: args.geofence.geofenceId.toString(), state: state.geofence.toString()})
      if (args.geofence.geofenceId.toString() === state.geofence.toString()) {
        callback(null, true)
      } else {
        callback(null, false)
      }
    })
    Homey.manager('flow').on('trigger.tracker_geofence_left', function (callback, args, state) {
      GpsDebugLog('flow trigger tracker_geofence_left evaluation', {card: args.geofence.geofenceId.toString(), state: state.geofence.toString()})
      if (args.geofence.geofenceId.toString() === state.geofence.toString()) {
        callback(null, true)
      } else {
        callback(null, false)
      }
    })
    Homey.manager('flow').on('action.say_address', function (callback, args, state) {
      GpsDebugLog('Flow action say_address', args)
      var trackerId = args.device.id

      function ready (err, trackerId) {
        if (err) return callback(err)
        var result = Util.createAddressSpeech(trackers[trackerId].location.place, trackers[trackerId].location.city, trackers[trackerId].name)
        GpsDebugLog('result for speech', result)
        Homey.manager('speech-output').say(result, {session: state.session})
        callback(null, true)
      }

      // polling is disabled
      if (tracking == null) {
        updateTracker(trackerId, ready)
      } else {
        ready(null, trackerId)
      }
    })

    Homey.manager('speech-input').on('speech', function (speech, callback) {
      var settings = Homey.manager('settings').get('gpsaccount')
      if (!settings.speech) { return callback(true, null) }

      function ready (err, trackerId) {
        if (err) return
        speech.say(Util.createAddressSpeech(trackers[trackerId].location.place, trackers[trackerId].location.city, trackers[trackerId].name))
      }

      if (speech.devices) {
        speech.devices.forEach(function (device) {
          if (tracking == null) {
            updateTracker(device.id, ready)
          } else {
            ready(null, device.id)
          }
        })
        callback(null, true)
      } else {
        callback(true, null)
      }
    })

    Homey.manager('settings').on('set', function (setting) {
      if (setting === 'gpsaccount') {
        initiateTracking()
      }
      if (setting === 'geofences') {
        geofences = Homey.manager('settings').get('geofences')
        checkGeofences()
      }
    })

    // delay initiation becouse getting settings per defice take time
    setTimeout(initiateTracking, 5000)
    callback()
  },
  renamed: function (device, name, callback) {
    GpsDebugLog('rename tracker', [device, name])
    trackers[device.id].name = name
    callback()
  },
  deleted: function (device) {
    GpsDebugLog('delete tracker', device)
    delete trackers[device.id]
    initiateTracking()
  },
  pair: function (socket) {
    var settings = Homey.manager('settings').get('gpsaccount')
    if (settings) {
      var tracking = new VodafoneApi({
        secret: Homey.env.SECRET,
        user: settings.user,
        password: settings.password
      })
    }
    socket.on('start', function (data, callback) {
      if (!settings) { return callback('errorNoSettings') }
      tracking.validateAccount(function (error, userId) {
        if (error) return callback('errorInvalidSettings')
        callback(null)
      })
    })
    socket.on('list_devices', function (data, callback) {
      var devices = []
      tracking.getVehicles(function (error, items) {
        if (error) return callback(error)
        items.forEach(function (item) {
          devices.push({
            name: item.nickname,
            data: {id: item.id.toString()},
            icon: 'icon.svg'
          }  // TODO: Let user choose icon
          )
        })
        callback(null, devices)
      })
    })
    socket.on('add_device', function (device, callback) {
      GpsDebugLog('pairing: tracker added', device)
      trackers[device.data.id] = {
        trackerId: device.data.id,
        name: device.name,
        location: {},
        geofences: [],
        settings: {
          retriggerRestrictTime: 1,
          retriggerRestrictDistance: 1,
          stoppedMovingTimeout: 120
        }
      }
      trackerTimeoutObjects[device.data.id] = null
      initiateTracking()
      callback(null)
    })
  },
  settings: function (device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
    GpsDebugLog('settings changed', {device_data: device_data, newSettingsObj: newSettingsObj, changedKeysArr: changedKeysArr})

    // TODO: translate errors
    if (newSettingsObj.retriggerRestrictTime < 0) { return callback('Negative value') }
    if (newSettingsObj.retriggerRestrictDistance < 0) { return callback('Negative value') }
    if (newSettingsObj.stoppedMovingTimeout < 30) { return callback('Timout cannot be smaller than 30 seconds') }
    try {
      changedKeysArr.forEach(function (key) {
        trackers[device_data.id].settings[key] = newSettingsObj[key]
      })
      callback(null, true)
    } catch (error) {
      callback(error)
    }
  },
  capabilities: {
    location: {
      get: function (device_data, callback) {
        GpsDebugLog('capabilities > location > get', device_data)
        var location = {
          lng: trackers[device_data.id].location.lng,
          lat: trackers[device_data.id].location.lat
        }
        callback(null, JSON.stringify(location))
      }
    },
    moving: {
      get: function (device_data, callback) {
        GpsDebugLog('capabilities > moving > get', device_data)
        callback(null, trackers[device_data.id].moving)
      }
    }
  },
  getTrackers: function (callback) {
    callback(trackers)
  }
}

module.exports = self
