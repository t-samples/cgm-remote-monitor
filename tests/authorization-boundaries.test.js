'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const delaylist = require('../lib/authorization/delaylist');
const AlarmSocket = require('../lib/api3/alarmSocket');
const middleware = require('../lib/middleware/send-json-status');

describe('authorization boundaries', function() {
  it('expires old failures and applies backoff even when the IP table is full', function() {
    const original = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
      const list = delaylist({settings:{}});
      for (let i=0;i<4097;i++) list.addFailedRequest('client-' + i);
      assert.strictEqual(list.shouldDelayRequest('another-new-address'),5000);
      now += 90000;
      assert.strictEqual(list.shouldDelayRequest('client-1'),false);
      assert.strictEqual(list.shouldDelayRequest('another-new-address'),false);
    } finally { Date.now = original; }
  });

  it('uses the socket peer by default and trusts only named proxy hops', function () {
    const key = require.resolve('../lib/authorization/client-ip');
    const original = process.env.NS_TRUSTED_PROXY_CIDRS;
    const savedModule = require.cache[key];
    const req = {socket:{remoteAddress:'127.0.0.1'}, headers:{'x-forwarded-for':'192.0.2.9, 192.0.2.10'}};
    try {
      delete process.env.NS_TRUSTED_PROXY_CIDRS;
      delete require.cache[key];
      assert.strictEqual(require(key)(req),'127.0.0.1');
      process.env.NS_TRUSTED_PROXY_CIDRS = '127.0.0.1/32';
      delete require.cache[key];
      assert.strictEqual(require(key)(req),'192.0.2.10');
    } finally {
      if (original === undefined) delete process.env.NS_TRUSTED_PROXY_CIDRS;
      else process.env.NS_TRUSTED_PROXY_CIDRS = original;
      delete require.cache[key];
      if (savedModule) require.cache[key] = savedModule;
    }
  });

  it('never returns internal driver data in JSON errors', function() {
    const res = {status() {return this;}, json(value) {this.value = value;}};
    middleware()({},res,()=>{});
    res.sendJSONStatus(res,500,'private fixture','sensitive fixture','private warning');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.value)),{status:500,message:'Internal error'});
  });

  it('revalidates alarm ACK authority and removes it on failed resubscription', function() {
    const socket = new EventEmitter();
    let fires = 0;
    let granted = false;
    const ctx = {levels:{}, notifications:{ack:()=>{fires++;}},authorization:{
      resolveAccessToken:(token,cb) => cb(token === 'fixture' ? null : 'invalid', {shiros:[granted]}),
      checkMultiple:(p,shiros) => p === 'notifications:*:ack' && shiros[0]
    }};
    const alarms = new AlarmSocket({}, {}, ctx);
    alarms.subscribe(socket, {accessToken:'fixture'});
    socket.emit('ack'); assert.strictEqual(fires,0);
    granted = true;
    alarms.subscribe(socket,{accessToken:'fixture'});
    alarms.subscribe(socket,{accessToken:'fixture'});
    socket.emit('ack'); assert.strictEqual(fires,1);
    granted = false;
    socket.emit('ack'); assert.strictEqual(fires,1);
    granted = true;
    alarms.subscribe(socket,{accessToken:'bad'});
    socket.emit('ack'); assert.strictEqual(fires,1);
  });
});
