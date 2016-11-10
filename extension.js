/**
 * @file
 */
'use strict';

const GnomeSession = imports.misc.gnomeSession;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

let focusCallbackID = 0;
let activeWindow = null;
let awCallbackID = 0;

let filePath;
let logFile;
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

function writeData(data) {
  log(JSON.stringify(data));
  logFileStream.write(JSON.stringify(data) + "\n", null);
}

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
  writeData({
    date: (new Date).toISOString(),
    origin: 'presence',
    status: ['idle', 'invisible', 'busy', 'available'][presence.status],
  });
  if (focusCallbackID) {
    global.display.disconnect(focusCallbackID);
  }
  if (presence.status === 3) {
    logData();
  }
  focusCallbackID = global.display.connect('notify::focus-window', onWindowChange);
}

function init() {
  filePath = GLib.get_user_data_dir() + '/.windowtracking.log';
  logFile = Gio.File.new_for_path(filePath);
  logFileStream = logFile.append_to(Gio.FileCreateFlags.NONE, null);
  presence = GnomeSession.Presence();
}

function enable() {
  presence.connectSignal('StatusChanged', onPresenceChange);
  focusCallbackID = global.display.connect('notify::focus-window', onWindowChange);
}

function disable() {
  global.display.disconnect(focusCallbackID);
  logFileStream.close();
  focusCallbackID = 0;
}
