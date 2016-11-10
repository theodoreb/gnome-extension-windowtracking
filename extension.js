/**
 * @file
 */
'use strict';

const GnomeSession = imports.misc.gnomeSession;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const filePath = GLib.get_user_data_dir() + '/.windowtracking.log';


const throttle = function(func, wait, options) {
  var context, args, result;
  var timeout = null;
  var previous = 0;
  if (!options) options = {};
  var later = function() {
    previous = options.leading === false ? 0 : Date.now();
    timeout = null;
    result = func.apply(context, args);
    if (!timeout) context = args = null;
  };
  return function() {
    var now = Date.now();
    if (!previous && options.leading === false) previous = now;
    var remaining = wait - (now - previous);
    context = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };
};


let focusCallbackID = 0;
let activeWindow = null;
let awCallbackID = 0;
let logFile = null;
let logFileStream;
let presence;

function logData() {
  const win = global.display.focus_window;
  if (!win) { return; }

  writeData({
    date: (new Date).toISOString(),
    origin: 'window',
    type: win.get_wm_class(),
    title: win.get_title()
  });
}

const writeData = throttle(function _writeData(data) {
  log(JSON.stringify(data));
  logFileStream.write(JSON.stringify(data) + "\n", null);
}, 80, {trailing: false});

function onWindowChange() {
  const win = global.display.focus_window;
  if (activeWindow) {
    activeWindow.disconnect(awCallbackID);
  }
  if (win) {
     if(win !== activeWindow) {
       activeWindow = win;
       awCallbackID = win.connect('notify::title', logData);
     }
    logData();
  }
}

function onPresenceChange() {
  logFile = Gio.File.new_for_path(filePath);
  logFileStream = logFile.append_to(Gio.FileCreateFlags.NONE, null);

  writeData({
    date: (new Date).toISOString(),
    origin: 'presence',
    status: ['idle', 'invisible', 'busy', 'available'][presence.status],
  });
}

function init() {}

function enable() {
  logFile = Gio.File.new_for_path(filePath);
  logFileStream = logFile.append_to(Gio.FileCreateFlags.NONE, null);
  presence = GnomeSession.Presence();
  presence.connectSignal('StatusChanged', onPresenceChange);
  focusCallbackID = global.display.connect('notify::focus-window', onWindowChange);
}

function disable() {
  global.display.disconnect(focusCallbackID);
  logFileStream.close();
  focusCallbackID = 0;
}
