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

function sanitize(rawData) {
  let data = rawData;
  if (data.type === 'window') {
    data.key = sanitizeWindowKey(data.key, data.value);
    data.value = sanitizeWindowTitle(data.key, data.value);
  }

  return data;
}

function sanitizeWindowTitle(application, title) {


  return encode_utf8(title);
}

function sanitizeWindowKey(application, title) {
  let app = application;

  if (/jetbrains-php/i.test(app)) {
    app = 'jetbrains-phpstorm';
  }

  if (app === 'Main.py' && /Guake/i.test(title)) {
    app = 'Guake';
  }

  return encode_utf8(app);
}

function encode_utf8(s) {
  return unescape(encodeURIComponent(s));
}

function decode_utf8(s) {
  return decodeURIComponent(escape(s));
}

// Custom code
const logData = (function (Gda, config) {

  let lastTime = null;

  let lastData = null;

  let connection = null;


  function equals(a, b) {
    return a.type === b.type && a.key === b.key && a.value === b.value;
  }

  function logData(rawData) {
    connect();

    const time = new Date();
    const newData = sanitize(rawData);

    // Don't log the same thing twice.
    if (lastData && equals(lastData, newData)) { return; }
    newData.date = time.toISOString();
    newData.timezone = time.toString().match(/\(([\w]{3,4})\)/)[1] || 'CET';

    if (lastData) {
      let diff = time - lastTime;
      // Bail out if it's too fast, we'll get the offset on the previous event.
      if (diff < config.threshold) {
        return;
      }
      // Store duration as seconds.
      lastData.duration = (diff / 1000).toFixed(3);
      write.apply(this, buildData(lastData));
    }
    lastTime = time;
    lastData = newData;
  }

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

  let windowTitleCallbackID = 0;

  function init() {
    presence = GnomeSession.Presence();
    display = global.display;
  }

  function enable() {
    //presenceCallbackID = presence.connect('notify::status', changeStatus);
    presence.connectSignal('StatusChanged', changeStatus);
    windowCallbackID = display.connect('notify::focus-window', changeWindow);
    windowTitleCallbackID = display.connect('notify::focus-window', changeTitle);
  }

  function disable() {
    if (activeWindow && titleCallbackID) {
      activeWindow.disconnect(titleCallbackID);
    }
    titleCallbackID = 0;

    display.disconnect(windowCallbackID);
    display.disconnect(windowTitleCallbackID);
    //presence.disconnect(presenceCallbackID);
    windowCallbackID = 0;
    windowTitleCallbackID = 0;
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
    // Reset the window focus callback.
    if (windowTitleCallbackID) {
      display.disconnect(windowTitleCallbackID);
    }
    windowCallbackID = display.connect('notify::focus-window', changeWindow);
    windowTitleCallbackID = display.connect('notify::focus-window', changeTitle);
  }

  /**
   * Bind and clean-up the title callback.
   *
   * @param metaDisplay
   * @param paramSpec
   */
  function changeWindow(metaDisplay, paramSpec) {
    if (activeWindow && titleCallbackID) {
      activeWindow.disconnect(titleCallbackID);
    }
    activeWindow = display.focus_window;
    if (activeWindow) {
      titleCallbackID = activeWindow.connect('notify::title', changeTitle);
    }
  }

  function changeTitle(metaDisplay) {
    let win;
    if (metaDisplay && ('get_wm_class' in metaDisplay)) {
      win = metaDisplay;
    }
    else if (display.focus_window && ('get_wm_class' in display.focus_window)) {
      win = display.focus_window;
    }
    else {
      return;
    }
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
