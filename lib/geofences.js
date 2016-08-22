const geofenceVersion = 0
const geofenceRadiusDefault = 50
var geofenceVersionUpdated = false

function getGeofenceDefault (ready) {
  Homey.manager('geolocation').getLocation(function (error, homeyLocation) {
    if (error) console.error(error)
    var result = {
      version: geofenceVersion,
      name: __('defaultGeofenceName'),
      source: 'DEFAULT',
      type: 'CIRCLE',
      circle: {
        radius: geofenceRadiusDefault,
        center: {
          lat: homeyLocation.latitude || 52,
          lng: homeyLocation.longitude || 5
        }
      },
      active: true,
      isHome: true
    }
    ready(result)
  })
} // end of getGeofenceDefault function

function checkGeofenceVersions (geofences) {
  Object.keys(geofences).forEach(function (geofenceid) {
    // if (geofences[geofenceid].version === 0) {
    //   // migrate to version 1
    //   geofences[geofenceid].version = 1
    //   geofenceVersionUpdated = true
    // }
  })
  return geofences
} // end of checkGeofenceVersions function

function reset () {
  var geofences = {}
  geofenceVersionUpdated = true
  getGeofenceDefault(function (defaultGeoFence) {
    var newGeofenceId = new Date().getTime()
    geofences[newGeofenceId] = defaultGeoFence
    geofences = checkGeofenceVersions(geofences)
    saveGeofenceSettings(geofences)
  })
}

function saveGeofenceSettings (geofences) {
  Homey.manager('settings').set('geofences', geofences)
} // end of saveGeofenceSettings function

exports.init = function () {
  var geofences = Homey.manager('settings').get('geofences')
  if (!geofences) return reset()
  geofences = checkGeofenceVersions(geofences)
  if (geofenceVersionUpdated) { saveGeofenceSettings(geofences) }
}
