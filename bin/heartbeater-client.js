#!/usr/node/bin/node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var amqp = require('amqp');
var execFile = require('child_process').execFile;
var util  = require('util');
var async = require('async');

var creds = {
    host:     process.env['AMQP_HOST'] || 'localhost',
    port:     process.env['AMQP_PORT'] || 5672,
    login:    process.env['AMQP_LOGIN'] || 'guest',
    password: process.env['AMQP_PASSWORD'] || 'guest',
    vhost:    process.env['AMQP_VHOST'] || '/'
};

var connection = amqp.createConnection(creds);
connection.addListener('ready', function () {
    sysinfo(function (error, info) {
        if (error) {
            throw error;
        }
        var queuename = 'provisioner.'+info['UUID'];
        var queue = connection.queue(queuename);
        queue.addListener('open', function () {
            console.log('Ready to delete queue');
            //       queue.destroy();
        });
    });
});


function execFileParseJSON(bin, args, callback) {
    execFile(bin, args, function (error, stdout, stderr) {
        if (error) {
            return callback(Error(stderr.toString()));
        }
        var obj = JSON.parse(stdout.toString());
        return callback(null, obj);
    });
}

function sysinfo(callback) {
    execFileParseJSON('/usr/bin/sysinfo', [], function (error, config) {
        if (error) {
            return callback(error);
        }
        return callback(null, config);
    });
}
