'use strict';

const { createHash } = require('crypto');

const actions = new Map([
  ['Temporary Override', 'notifications:loop:override-set'],
  ['Temporary Override Cancel', 'notifications:loop:override-cancel'],
  ['Remote Carbs Entry', 'notifications:loop:carbs']
]);

function validText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}

function validCommand(body, now) {
  const fields = ['eventType', 'enteredBy', 'expectedRecipient'];
  if (!actions.has(body.eventType) || !validText(body.enteredBy, 80)) return false;
  if (body.eventType === 'Temporary Override') {
    fields.push('reason', 'reasonDisplay', 'duration');
    if (!validText(body.reason, 80) || body.reasonDisplay !== body.reason ||
        !Number.isInteger(body.duration) || body.duration < 1 || body.duration > 1440) return false;
  } else if (body.eventType === 'Remote Carbs Entry') {
    fields.push('remoteCarbs', 'remoteAbsorption', 'created_at', 'otp');
    const date = Date.parse(body.created_at);
    if (!Number.isFinite(body.remoteCarbs) || body.remoteCarbs <= 0 || body.remoteCarbs > 300 ||
        !Number.isFinite(body.remoteAbsorption) || body.remoteAbsorption < 0.5 || body.remoteAbsorption > 8 ||
        typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp) ||
        typeof body.created_at !== 'string' || !Number.isFinite(date) ||
        new Date(date).toISOString() !== body.created_at || date < now - 12*3600000 || date > now+3600000) return false;
  }
  return Object.keys(body).every(key => fields.includes(key));
}

function selectRecipient(settings, expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
      Object.keys(expected).length !== 2 || !validText(expected.bundleIdentifier, 255) ||
      typeof expected.deviceTokenSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.deviceTokenSha256)) return null;
  if (!settings || settings.bundleIdentifier !== expected.bundleIdentifier ||
      typeof settings.deviceToken !== 'string' || !settings.deviceToken ||
      createHash('sha256').update(settings.deviceToken).digest('hex') !== expected.deviceTokenSha256) return null;
  // Copy verified values. Never resolve the profile again during dispatch.
  return {bundleIdentifier: settings.bundleIdentifier, deviceToken: settings.deviceToken};
}

function handle(ctx, req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !actions.has(body.eventType)) return res.sendStatus(400);
  return ctx.authorization.resolveWithRequest(req, (err, auth) => {
    if (err || !auth || !auth.subject) return res.sendStatus(403);
    const owned = ctx.authorization.storage.rolesToShiros(auth.subject.roles);
    if (!ctx.authorization.checkMultiple(actions.get(body.eventType), owned) ||
        ctx.authorization.checkMultiple('notifications:loop:push', auth.shiros)) return res.sendStatus(403);
    if (!validCommand(body, Date.now())) return res.sendStatus(400);
    const settings = ctx.ddata.profiles && ctx.ddata.profiles[0] && ctx.ddata.profiles[0].loopSettings;
    const recipient = selectRecipient(settings, body.expectedRecipient);
    if (!recipient) return res.sendStatus(409);
    if (body.eventType === 'Temporary Override' && (!Array.isArray(settings.overridePresets) ||
        settings.overridePresets.filter(p => p && p.name === body.reason).length !== 1)) return res.sendStatus(409);
    return ctx.loop.sendNotification(body, req.socket.remoteAddress, (error) => {
      res.sendStatus(error ? 502 : 200);
    }, recipient);
  }).catch(() => { if (!res.headersSent) res.sendStatus(502); });
}

module.exports = {handle, actions, validCommand, selectRecipient};
