/* global $ */

function initAccount () {
  clearBusy()
  clearError()
  clearSuccess()

  Homey.get('gpsaccount', function (error, currentGpsAccount) {
    if (error) return console.error(error)
    if (currentGpsAccount != null) {
      $('#gpsUsername').val(currentGpsAccount['user'])
      $('#gpsPassword').val(currentGpsAccount['password'])
      $('#gpsSpeech').prop('checked', currentGpsAccount['speech'])
      $('#gpsPolling').prop('checked', currentGpsAccount['polling'])
      $('#gpsDebug').prop('checked', currentGpsAccount['debug'])
    }
  })
}

function clearGpsAccount () {
  Homey.confirm(__('settings.account.messages.confirmClearAccount'), 'warning', function (error, result) {
    if (error) return console.error(error)
    if (result) {
      showBusy(__('settings.account.messages.busyClearing'))
      Homey.set('gpsaccount', null, function (error, result) {
        if (error) return console.error(error)
        $('#gpsUsername').val('')
        $('#gpsPassword').val('')
        $('#gpsSpeech').prop('checked', true)
        $('#gpsPolling').prop('checked', true)
        $('#gpsDebug').prop('checked', false)
        showSuccess(__('settings.account.messages.successClearing'), 3000)
      })
    }
  })
}

function saveGpsAccount () {
  var currentGpsAccount = {
    user: $('#gpsUsername').val(),
    password: $('#gpsPassword').val(),
    speech: $('#gpsSpeech').prop('checked'),
    polling: $('#gpsPolling').prop('checked'),
    debug: $('#gpsDebug').prop('checked')
  }
  showBusy(__('settings.account.messages.busyValidation'))
  $('#saveGpsAccount').prop('disabled', true)
  Homey.api('GET', '/validate/account?' + $.param(currentGpsAccount), function (error, result) {
    if (error) {
      $('#saveGpsAccount').prop('disabled', false)
      return showError(__('settings.account.messages.errorValidation.' + error))
    }
    showBusy(__('settings.account.messages.busySaving'))
    setTimeout(function () {
      Homey.set('gpsaccount', currentGpsAccount, function (error, settings) {
        $('#saveGpsAccount').prop('disabled', false)
        if (error) { return showError(__('settings.account.messages.errorSaving')) }
        showSuccess(__('settings.account.messages.successSaving'), 3000)
      })
    }, 2000)
  })
}

function clearBusy () { $('#busy').hide() }
function showBusy (message, showTime) {
  clearError()
  clearSuccess()
  $('#busy span').html(message)
  $('#busy').show()
  if (showTime) $('#busy').delay(showTime).fadeOut()
}

function clearError () { $('#error').hide() }
function showError (message, showTime) {
  clearBusy()
  clearSuccess()
  $('#error span').html(message)
  $('#error').show()
  if (showTime) $('#error').delay(showTime).fadeOut()
}

function clearSuccess () { $('#success').hide() }
function showSuccess (message, showTime) {
  clearBusy()
  clearError()
  $('#success span').html(message)
  $('#success').show()
  if (showTime) $('#success').delay(showTime).fadeOut()
}
