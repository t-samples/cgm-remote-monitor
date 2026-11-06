'use strict';

var consts = require('../constants');

function configure (app, ctx) {
  var express = require('express')
    , api = express.Router( )
    ;

  api.use(ctx.wares.compression());
  api.use(ctx.wares.rawParser);
  api.use(ctx.wares.bodyParser.json({
      limit: '50Mb'
  }));
  api.use(ctx.wares.urlencodedParser);
  
  // This separately authorized path cannot fall through to legacy push.
  const bound = require('../server/bound-loop');
  api.post('/loop/bound', (req, res) => bound.handle(ctx, req, res));

  api.post('/loop', ctx.authorization.isPermitted('notifications:loop:push'), function (req, res) {
    ctx.loop.sendNotification(req.body, req.connection.remoteAddress, function (error) {
      if (error) {
        res.status(consts.HTTP_INTERNAL_ERROR).send(error)
        console.log("Loop notification failed");
      } else {
        res.sendStatus(consts.HTTP_OK);
      }
    });
  });

  return api;
}
module.exports = configure;
