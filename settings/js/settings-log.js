/* global $ */

function initLogging () {
  firstLoadLog()
  Homey.on('gpsLog', function (data) {
    addLogEntry(data.datetime, data.message, data.data)
  })
}

function clearGpsLog () {
  Homey.set('gpsLog', [{datetime: new Date(), message: 'Log cleared', data: null}], function (error, result) {
    if (error) return console.error(error)
    firstLoadLog()
  })
}

function firstLoadLog () {
  $('tr.logentry').remove()
  Homey.get('gpsLog', function (error, value) {
    if (error) return console.error(error)
    if (value != null) {
      $.each(value, function (index, obj) {
        addLogEntry(value[index].datetime, value[index].message, value[index].data)
      })
    }
  })
}

function addLogEntry (datetime, message, data) {
  var html = '<tr class="logentry"><td class="datetime">' +
  datetime + '</td><td colspan=2 class="entry">' + message
  if (data == null) {
    html += '</td></tr>'
  } else {
    html += '<br>' + JSON.stringify(data) + '</td></tr>'
  }
  $('table#logs tr:first').after(html)
}
