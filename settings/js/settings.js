/* global $ */

function showPanel (panel) {
  $('.panel').hide()
  $('.panel-button').removeClass('panel-button-active').addClass('panel-button-inactive')
  $('#panel-button-' + panel).removeClass('panel-button-inactive').addClass('panel-button-active')
  $('#panel-' + panel).show()

  if (panel === 2) { showGeofences() }
}

function onHomeyReady () {
  initAccount()
  initLogging()
  initGeofences()
  showPanel(1)

  Homey.ready()
}
