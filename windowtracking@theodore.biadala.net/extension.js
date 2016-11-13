/**
 * @file
 */
'use strict';

// User configuration
const config = {
  dbName: '.windowtraking.sqlite',
  dbDir: imports.gi.GLib.get_home_dir(),
  // Ignore events faster than 'threshold' ms.
  threshold: 125,
};

const Mainloop = imports.mainloop;


function debounce(func, wait, immediate) {
  var timeout, args, context, timestamp, result;

  var later = function() {
    var last = Date.now() - timestamp;

    if (last < wait && last >= 0) {
      timeout = Mainloop.timeout_add(wait - last, later);
    } else {
      timeout = null;
      if (!immediate) {
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      }
    }
    return false;
  };

  return function() {
    context = this;
    args = arguments;
    timestamp = Date.now();
    var callNow = immediate && !timeout;
    if (!timeout) timeout = Mainloop.timeout_add(wait, later);
    if (callNow) {
      result = func.apply(context, args);
      context = args = null;
    }

    return result;
  };
}


/*
const Convenience = imports.misc.extensionUtils.getCurrentExtension().imports.convenience;
let settings = Convenience.getSettings();
const Mainloop = imports.mainloop;
*/

function sanitize(rawData) {
  let data = rawData;
  if (data.type === 'window') {
    data.key = sanitizeWindowKey(data.key, data.value);
  }

  return data;
}

function sanitizeWindowKey(application, title) {
  let app = application;

  if (/jetbrains-php/i.test(app)) {
    app = 'jetbrains-phpstorm';
  }

  if (app === 'Main.py' && /Guake/i.test(title)) {
    app = 'Guake';
  }

  return app;
}

// Custom code
const logData = (function (Gda, config) {

  let lastTime = null;

  let connection = null;

  let logData = function _logData(rawData) {
    connect();

    // This is not a copy but it should be!
    const data = rawData;
    const time = new Date();
    data.date = time.toISOString();
    data.timezone = time.toString().match(/\(([\w]{3,4})\)/)[1] || 'CET';
    if (lastTime) {
      let diff = time - lastTime;
      if (diff < config.threshold) {
        return;
      }
      // Store duration as seconds.
      data.duration = (diff / 1000).toFixed(3);
    }
    const sanitizedData = sanitize(data);
    const builtData = buildData(sanitizedData);
    write.apply(this, builtData);
    lastTime = time;
  }

  logData.init = function () {
    connect();
  };

  function buildData(rawData) {
    const keys = ['date', 'timezone', 'type', 'key', 'value', 'duration', 'origin'];
    const def = {
      type: '',
      key: '',
      value: '',
      duration: null,
      origin: 'monkey'
    };
    return [keys, keys.map(key => rawData[key] || def[key])];
  }

  function write(keys, values) {
    connection.execute_non_select_command('INSERT INTO log (' + keys.join(',') + ') VALUES ("' + values.join('","') + '");');
  }

  function connect() {
    if (!connection) {
      log('[windowTraking]: Connecting to DB.');
      connection = new Gda.Connection({
        provider: Gda.Config.get_provider('SQLite'),
        cnc_string: 'DB_DIR=' + config.dbDir + ';DB_NAME=' + config.dbName
      });
      connection.open();
      if (!checkDb()) {
        initializeDb();
      }
    }
  }

  function checkDb() {
    try {
      connection.execute_select_command('SELECT id FROM log WHERE id = 1');
    }
    catch (e) {
      return false;
    }
    return true;
  }

  function initializeDb() {
    log('[windowTracking]: Creating database');
    connection.execute_non_select_command(['CREATE TABLE log (',
      'id INTEGER PRIMARY KEY,',
      'date TEXT NOT NULL,',
      'timezone TEXT NOT NULL,',
      'type TEXT NOT NULL,',
      'key TEXT NOT NULL,',
      'value TEXT NOT NULL,',
      'duration INTEGER NULL,',
      'origin TEXT NOT NULL',
      ')'].join('\n'));
    connection.execute_non_select_command('CREATE INDEX date_timezone ON log(date, timezone)');
    connection.execute_non_select_command('CREATE INDEX type_key_origin ON log(type, key, origin)');
    connection.execute_non_select_command('CREATE INDEX key_value ON log(key,value)');
    connection.execute_non_select_command('CREATE INDEX duration ON log(duration)');
  }

  function disconnect() {
    connection.close();
    connection = null;
  }

  return logData;
}(imports.gi.Gda, config));

const tracking = (function (global, GnomeSession, log) {

  let display = null;

  let activeWindow = null;

  let presence = null;

  let windowCallbackID = 0;

  let titleCallbackID = 0;

  //let presenceCallbackID = 0;

  function init() {
    log.init();
    presence = GnomeSession.Presence();
    display = global.display;
  }

  function enable() {
    //presenceCallbackID = presence.connect('notify::status', changeStatus);
    presence.connectSignal('StatusChanged', changeStatus);
    windowCallbackID = display.connect('notify::focus-window', changeWindow);
  }

  function disable() {
    if (activeWindow && titleCallbackID) {
      activeWindow.disconnect(titleCallbackID);
    }
    titleCallbackID = 0;

    display.disconnect(windowCallbackID);
    //presence.disconnect(presenceCallbackID);
    windowCallbackID = 0;
    //presenceCallbackID = 0;
  }

  function changeStatus() {
    log({
      type: 'presence',
      key: 'status',
      value: ['available', 'invisible', 'busy', 'idle'][presence.status],
    });

    // Log the window when going out of idle state.
    if (presence.status === 3) {
      changeWindow();
    }

    // Reset the window focus callback.
    if (windowCallbackID) {
      display.disconnect(windowCallbackID);
    }
    windowCallbackID = display.connect('notify::focus-window', changeWindow);
  }

  function changeWindow() {
    changeTitle();
    if (activeWindow && titleCallbackID) {
      activeWindow.disconnect(titleCallbackID);
    }
    activeWindow = display.focus_window;
    if (activeWindow) {
      titleCallbackID = activeWindow.connect('notify::title', changeTitle);
    }
  }

  function changeTitle() {
    const win = display.focus_window;
    if (!win) { return; }

    log({
      type: 'window',
      key: win.get_wm_class(),
      value: win.get_title()
    });
  }

  return {
    init: init,
    enable: enable,
    disable: disable
  };
}(global, imports.misc.gnomeSession, logData));


function init() {
  log('[windowTraking]: initialized.');
  tracking.init();
}

function enable() {
  log('[windowTraking]: enabled.');
  tracking.enable();
}

function disable() {
  log('[windowTraking]: disabled.');
  tracking.disable();
}
