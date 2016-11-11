/**
 * @file
 */
'use strict';

// User configuration
const config = {
  dbName: '.windowtraking.sqlite',
  dbDir: imports.gi.GLib.get_home_dir(),
};


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

  function log(rawData) {
    connect();

    // This is not a copy but it should be!
    const data = rawData;
    const time = new Date();
    data.date = time.toISOString();
    data.timezone = time.toString().match(/\(([\w]{3,4})\)/)[1] || 'CET';
    if (lastTime) {
      // Store duration as seconds.
      data.duration = (time - lastTime) / 1000;
    }
    const sanitizedData = sanitize(data);
    const builtData = buildData(sanitizedData);
    write.apply(this, builtData);
    lastTime = time;
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
    if (!connection || connection && !connection.is_active()) {
      connection = new Gda.Connection({
        provider: Gda.Config.get_provider('SQLite'),
        cnc_string: 'DB_DIR=' + config.dbDir + ';DB_NAME=' + config.dbName
      });
      connection.open();
      initializeDb();
    }
  }


  function initializeDb() {
    try {
      connection.execute_select_command('SELECT id FROM log LIMIT 1');
    }
    catch (e) {
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
  }

  function disconnect() {
    connection.close();
    connection = null;
  }

  return log;
}(imports.gi.Gda, config));

const tracking = (function (global, GnomeSession, log) {

  let display = null;

  let activeWindow = null;

  let presence = null;

  let windowCallbackID = 0;

  let titleCallbackID = 0;

  //let presenceCallbackID = 0;

  function init() {
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
  tracking.init();
}

function enable() {
  tracking.enable();
}

function disable() {
  tracking.disable();
}