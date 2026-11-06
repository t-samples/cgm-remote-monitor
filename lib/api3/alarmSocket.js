'use strict';

const apiConst = require('./const');
const getRemoteIP = require('../authorization/client-ip');


/**
 * Socket.IO broadcaster of alarm and annoucements
 */
function AlarmSocket (app, env, ctx) {

  const self = this;

  var levels = ctx.levels;

  const LOG_GREEN = '\x1B[32m'
    , LOG_MAGENTA = '\x1B[35m'
    , LOG_RESET = '\x1B[0m'
    , LOG = LOG_GREEN + 'ALARM SOCKET: ' + LOG_RESET
    , LOG_ERROR = LOG_MAGENTA + 'ALARM SOCKET: ' + LOG_RESET
    , NAMESPACE = '/alarm'
    ;


  /**
   * Initialize socket namespace and bind the events
   * @param {Object} io Socket.IO object to multiplex namespaces
   */
  self.init = function init (io) {
    self.io = io;

    self.namespace = io.of(NAMESPACE);
    self.namespace.on('connection', function onConnected (socket) {

      const remoteIP = getRemoteIP(socket.request);
      console.log(LOG + 'Connection from client ID: ', socket.client.id, ' IP: ', remoteIP);

      socket.on('disconnect', function onDisconnect () {
        console.log(LOG + 'Disconnected client ID: ', socket.client.id);
      });

      socket.on('subscribe', function onSubscribe (message, returnCallback) {
        self.subscribe(socket, message, returnCallback);
      });

    });

    // Turns all notifications on the event bus back into events to be
    // broadcast to clients.
    ctx.bus.on('notification', self.emitNotification);
  };


  /**
   * Authorize Socket.IO client and subscribe him to authorized rooms
   *
   * Support webclient authorization with api_secret is added
   *
   * @param {Object} socket
   * @param {Object} message input message from the client
   * @param {Function} returnCallback function for returning a value back to the client
   */
  self.subscribe = function subscribe (socket, message, returnCallback) {
    const shouldCallBack = typeof(returnCallback) === 'function';

    // Replace any previous grant on this socket. A failed resubscription
    // must not leave an old ACK handler registered.
    if (socket.loopAlarmAck) {
      socket.removeListener('ack', socket.loopAlarmAck);
      delete socket.loopAlarmAck;
    }
    const generation = (socket.loopAlarmGrant || 0) + 1;
    socket.loopAlarmGrant = generation;
    function subscribeAuthorized(err, auth) {
      if (generation !== socket.loopAlarmGrant) return;
      if (err || !auth || !auth.shiros) {
        const rejected = {success:false, message:apiConst.MSG.SOCKET_MISSING_OR_BAD_ACCESS_TOKEN};
        if (shouldCallBack) returnCallback(rejected);
        return;
      }
      const read = ctx.authorization.checkMultiple('api:*:read', auth.shiros);
      const ack = !auth.defaults && ctx.authorization.checkMultiple('notifications:*:ack', auth.shiros);
      if (ack) {
        socket.loopAlarmAck = function (level, group, silenceTime) {
          // Recheck the credential when the action occurs, including expiry
          // or a revoked role while the socket remained connected.
          authorize((error, current) => {
            if (generation === socket.loopAlarmGrant && !error && current && !current.defaults &&
                ctx.authorization.checkMultiple('notifications:*:ack', current.shiros)) {
              ctx.notifications.ack(level, group, silenceTime, true);
            }
          });
        };
        socket.on('ack', socket.loopAlarmAck);
      }
      const result = {success:true, message:'Subscribed for alarms', read, ack};
      if (shouldCallBack) returnCallback(result);
      return result;
    }
    function authorize(done) {
      if (message && message.accessToken)
        return ctx.authorization.resolveAccessToken(message.accessToken, done);
      return ctx.authorization.resolve({api_secret:message.secret, token:message.jwtToken,
        ip:getRemoteIP(socket.request)}, done);
    }
    if (message && message.accessToken) return authorize(subscribeAuthorized);

    if (!message) { message = {}; }
    // Web client (jwt access token or api_hash)
    /*
    * On the web: a client may have saved a secret or using a jwtToken, or may have none.
    * Some pages will automatically prompt for authorization, when needed.
    * To make the main homepage require authorization as well, set
    * AUTHENTICATION_PROMPT_ON_LOAD=true.
    *
    * If there is missing authorization when authorization is required,
    * rejecting the attempt in order to trigger a prompt on the client.
    * If there is no authorization required, or there are available
    * credentials, attempt to resolve the available permissions.
    * When processing ACK messages that dismiss alarms, Authorization should be
    * required.
    */
    var shouldTry = true;
    if (env.settings.authenticationPromptOnLoad) {
      if (!message.jwtToken && !message.secret) {
        shouldTry = false;
      }
    }

    if (message && shouldTry) {
      return authorize(subscribeAuthorized);
    }

    console.log(LOG_ERROR + 'Authorization failed');
    if (shouldCallBack) {
      returnCallback({ success: false, message: apiConst.MSG.SOCKET_MISSING_OR_BAD_ACCESS_TOKEN});
    }
  };


  /**
   * Emit alarm to subscribed clients
   * @param {Object} notofication to emit
   */
   
  self.emitNotification = function emitNotification (notify) {
    if (notify.clear) {
      self.namespace.emit('clear_alarm', notify);
      console.info(LOG + 'emitted clear_alarm to all clients');
    } else if (notify.level === levels.WARN) {
      self.namespace.emit('alarm', notify);
      console.info(LOG + 'emitted alarm to all clients');
    } else if (notify.level === levels.URGENT) {
      self.namespace.emit('urgent_alarm', notify);
      console.info(LOG + 'emitted urgent_alarm to all clients');
    } else if (notify.isAnnouncement) {
      self.namespace.emit('announcement', notify);
      console.info(LOG + 'emitted announcement to all clients');
    } else {
      self.namespace.emit('notification', notify);
      console.info(LOG + 'emitted notification to all clients');
    }
  };
}

module.exports = AlarmSocket;
