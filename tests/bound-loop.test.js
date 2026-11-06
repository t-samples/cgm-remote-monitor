'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bound = require('../lib/server/bound-loop');

describe('bound Loop notifications', function () {
  const settings = {bundleIdentifier:'org.example.loop', deviceToken:'synthetic-token', overridePresets:[{name:'fixture'}]};
  const expected = {bundleIdentifier:settings.bundleIdentifier,
    deviceTokenSha256:crypto.createHash('sha256').update(settings.deviceToken).digest('hex')};
  const cancel = {eventType:'Temporary Override Cancel', enteredBy:'Fixture', expectedRecipient:expected};
  async function request(body, grants, options = {}) {
    const sends = [];
    const response = {sendStatus(code) {this.code = code;}};
    const profile = Object.assign({}, settings, options.profile);
    const ctx = {
      authorization:{
        resolveWithRequest:async (req, cb) => cb(null,{subject:options.anonymous ? null : {roles:grants}, shiros:grants}),
        storage:{rolesToShiros:roles => roles},
        checkMultiple:(permission, roles) => roles.includes('*') || roles.includes(permission)
      },
      ddata:{profiles:[{loopSettings:profile}]},
      loop:{sendNotification:(data, address, done, recipient) => {
        profile.deviceToken = 'changed-after-comparison';
        sends.push(recipient);
        done(options.transportFailed ? 'uncertain' : undefined);
      }}
    };
    await bound.handle(ctx, {body,socket:{remoteAddress:'127.0.0.1'}}, response);
    return {code:response.code,sends};
  }
  it('sends to the immutable recipient captured at validation', async function() {
    assert.deepStrictEqual(await request(cancel,['notifications:loop:override-cancel']),
      {code:200,sends:[{bundleIdentifier:settings.bundleIdentifier,deviceToken:settings.deviceToken}]});
  });
  it('blocks changed identity, unbound input and unknown presets before dispatch', async function() {
    for (const body of [Object.assign({},cancel,{expectedRecipient:null}),
      Object.assign({},cancel,{expectedRecipient:{...expected,bundleIdentifier:'other'}})]) {
      assert.deepStrictEqual(await request(body,['notifications:loop:override-cancel']),{code:409,sends:[]});
    }
    assert.deepStrictEqual(await request(cancel,['notifications:loop:override-cancel'],{profile:{deviceToken:'moved'}}),
      {code:409,sends:[]});
    const override = {...cancel, eventType:'Temporary Override', reason:'missing', reasonDisplay:'missing',duration:15};
    assert.deepStrictEqual(await request(override,['notifications:loop:override-set']),{code:409,sends:[]});
  });
  it('requires an explicit action-specific subject and rejects a broad or other grant', async function() {
    for (const grants of [[],['notifications:loop:carbs'],['*'],['notifications:loop:push','notifications:loop:override-cancel']]) {
      assert.deepStrictEqual(await request(cancel,grants),{code:403,sends:[]});
    }
    assert.deepStrictEqual(await request(cancel,['notifications:loop:override-cancel'],{anonymous:true}),{code:403,sends:[]});
    assert.deepStrictEqual(await request({...cancel,eventType:'Remote Bolus Entry'},['notifications:loop:carbs']),{code:400,sends:[]});
    assert.deepStrictEqual(await request({...cancel,remoteBolus:1},['notifications:loop:override-cancel']),{code:400,sends:[]});
  });
  it('validates the bounded carb fields and keeps failed transport uncertain', async function() {
    const body = {...cancel,eventType:'Remote Carbs Entry',remoteCarbs:2,remoteAbsorption:1,
      created_at:new Date().toISOString(),otp:'123456'};
    assert.strictEqual((await request(body,['notifications:loop:carbs'])).code,200);
    for (const extra of [{otp:123456},{created_at:'bad-date'},{remoteAbsorption:'1'},{remoteCarbs:Infinity}]) {
      assert.deepStrictEqual(await request({...body,...extra},['notifications:loop:carbs']),{code:400,sends:[]});
    }
    assert.strictEqual((await request(cancel,['notifications:loop:override-cancel'],{transportFailed:true})).code,502);
  });
});

describe('bound Loop HTTP route with a simulated APNs provider', function () {
  it('keeps legacy and bound grants separate and sends one verified target exactly once', async function () {
    const apn = require('@parse/node-apn');
    const express = require('express');
    const request = require('supertest');
    const profile = {deviceToken:'device-a',bundleIdentifier:'org.example.fixture'};
    const permission = 'notifications:loop:override-cancel';
    const config = {extendedSettings:{loop:{apnsKey:'fake',apnsKeyId:'fake',developerTeamId:'1234567890'}}};
    const seen = [];
    const original = apn.Provider;
    let shutdowns = 0;
    let uncertain = false;
    apn.Provider = class {
      send(notification, devices) {
        profile.deviceToken = 'changed';
        seen.push({topic:notification.topic,devices});
        if (uncertain) return Promise.reject(new Error('private APNs error'));
        return Promise.resolve({sent:devices});
      }
      shutdown() {shutdowns++;}
    };
    try {
      const ctx = {wares:require('../lib/middleware')({}), ddata:{profiles:[{loopSettings:profile}]}, authorization:{
        resolveWithRequest:async (req,done) => {
          const grant=req.body.token; delete req.body.token;
          return done(null,{subject:{roles:[grant]},shiros:[grant]});
        },
        storage:{rolesToShiros:roles=>roles},
        checkMultiple:(scope,roles)=>roles.includes(scope),
        isPermitted:scope=>(req,res,next)=>req.body.token === scope ? next() : res.sendStatus(403)
      }};
      ctx.loop = require('../lib/server/loop')(config,ctx);
      const app = express();
      app.use('/api/v2/notifications',require('../lib/api2/notifications-v2')(app,ctx));
      const body = {eventType:'Temporary Override Cancel', enteredBy:'Test',token:permission,
        expectedRecipient:{bundleIdentifier:profile.bundleIdentifier,
          deviceTokenSha256:crypto.createHash('sha256').update('device-a').digest('hex')}};
      await request(app).post('/api/v2/notifications/loop').send(body).expect(403);
      await request(app).post('/api/v2/notifications/loop/bound').send(body).expect(200);
      await request(app).post('/api/v2/notifications/loop/bound').send(body).expect(409);
      assert.deepStrictEqual(seen,[{topic:'org.example.fixture',devices:['device-a']}]);
      profile.deviceToken = 'device-a';
      uncertain = true;
      await request(app).post('/api/v2/notifications/loop/bound').send(body).expect(502);
      assert.strictEqual(seen.length,2);
      assert.strictEqual(shutdowns,2);
    } finally {apn.Provider = original;}
  });
});
