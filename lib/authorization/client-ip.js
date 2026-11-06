'use strict';

const proxyaddr = require('proxy-addr');

// Only a proxy identified by the administrator can supply a forwarding hop.
// Resolve from the socket towards the client and stop at the first untrusted hop.
const cidrs = (process.env.NS_TRUSTED_PROXY_CIDRS || '').split(',').map(s => s.trim()).filter(Boolean);
const trust = cidrs.length ? proxyaddr.compile(cidrs) : () => false;

module.exports = function clientIP(req) {
  if (!req || !(req.socket || req.connection)) return null;
  return proxyaddr(req, trust);
};
