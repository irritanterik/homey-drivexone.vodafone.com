/* global __ */

exports.epochToTimeFormatter = function (epoch) {
  if (epoch == null) {
    epoch = new Date().getTime()
  }
  return (new Date(epoch)).toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1')
}

exports.createAddressSpeech = function (place, city, name) {
  var result = ''
  if (name) {
    result += __('speech.theLocationOfTracker') + name + __('speech.is')
  }

  if (place && city) {
    return result + place + __('speech.placeCityConjunction') + city
  } else if (city) {
    return result + city
  } else if (place) {
    return result + place
  }
  return result + __('speech.positionUnknown')
}

exports.calculateDistance = function (lat1, lon1, lat2, lon2, unit) {
  // based on https://www.geodatasource.com/developers/javascript
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0
  unit = unit.toUpperCase() || 'M'
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
