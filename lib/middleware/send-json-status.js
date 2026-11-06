'use strict';

// Craft a JSON friendly status (or error) message.
function sendJSONStatus(res, status, title, description, warning) {
  var json = {
    status: status,
    message: status >= 500 ? 'Internal error' : title,
    description: status >= 500 ? undefined : description
  };

  // Add optional warning message.
  if (warning && status < 500) { json.warning = warning; }

  res.status(status).json(json);
}

function configure ( ) {
  function middleware (req, res, next) {
    res.sendJSONStatus = sendJSONStatus;
    next( );
  }
  return middleware;
}

module.exports = configure;
