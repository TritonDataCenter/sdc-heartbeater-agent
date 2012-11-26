var path = require('path');
var amqp = require('amqp-plus');
var async = require('async');
var sprintf = require('sprintf').sprintf;
var system = require('/usr/node/node_modules/system');
var zfs = require('zfs').zfs;
var zpool = require('zfs').zpool;

var cp = require('child_process');
var exec = cp.exec;
var execFile = cp.execFile;
var spawn = cp.spawn;
var VM = require('VM');

var creds;

var debug = !!process.env.DEBUG;
var max_interval = 60000;  // milliseconds frequency for doing full reload
var ping_interval = 5000;  // milliseconds frequency of sending msgs

// Global VM state
var exchange;
var routingKey;

// This specifies whether the cache is dirty.  This could be because a zone
// has changed state, or we've hit max_interval.  Either way, we'll reload the
// list.
var isDirty = true;

// The current sample is stored here and we lock the samplerLock while we're
// updating so that we don't do two lookups at the same time.
var sample = null;
var samplerLock = false;

// pingInterval sends a message
// maxInterval ensures the msg is marked dirty every max_interval ms
var pingInterval;
var maxInterval;

// this is the subprocess that watches for zone changes
var watcher = null;

if (debug) {
    console.log('debug mode');
}

var connection;

process.on('uncaughtException', function (e) {
    console.error('uncaught exception:' + e.message);
    console.log(e.stack);
});

function amqpConfig(callback) {
    execFile('/usr/node/bin/node',
        [ '/opt/smartdc/agents/bin/amqp-config' ],
        function (error, stdout, stderr) {
            if (error) {
                return callback(new Error(stderr.toString()));
            }
            var config = {};
            stdout = stdout.toString().trim().split('\n');
            stdout.forEach(function (line) {
                var kv = line.split('=');
                config[kv[0]] = kv[1];
            });
            return callback(null, config);
        });
}

function onReady() {
    console.log('Connected ' + creds.host + ':' + creds.port);

    function setUUID(uuid, systype) {
        setupPingQueue(uuid);
        routingKey = 'heartbeat.' + uuid;
        console.log('Will publish messages to "' + routingKey + '"');

        exchange = connection.exchange('amq.topic', {type: 'topic'});

        // every max_interval we force an update but we send the state to the
        // best of our knowledge every ping_interval ms.
        maxInterval = setInterval(markDirty, max_interval);
        pingInterval = setInterval(sendSample, ping_interval);
    }

    if (debug) {
        return setUUID('550e8400-e29b-41d4-a716-446655440000');
    } else {
        return loadSysinfo(function (error, exitStatus, stdout, stderr) {
            if (error) {
                throw (new Error('sysinfo error: ' + stderr.toString()));
            }

            // output of sysinfo is a JSON object
            var sysinfo = JSON.parse(stdout);

            // Use the UUID param to uniquely identify this machine on AMQP.
            if (!sysinfo.UUID) {
                throw new Error('Could not find "UUID" in `sysinfo` output.');
            }
            setUUID(sysinfo.UUID, sysinfo['System Type']);
        });
    }
}

function onClose() {
    console.log('Connection closed');
    clearInterval(maxInterval);
    clearInterval(pingInterval);
}

function connect() {
    amqpConfig(function (error, config) {
        creds = {
            login:    config.amqp_login,
            password: config.amqp_password,
            host:     config.amqp_host,
            port:     config.amqp_port
        };
        connection = amqp.createConnection(creds, { log: console });
        connection.on('ready', onReady);
        connection.on('close', onClose);
        connection.reconnect();
    });
}

// Connect now!
connect();

function setupPingQueue(uuid) {
    var resource = 'heartbeat';
    var queueName = resource + '.ping.' + uuid;
    var pq = connection.queue(queueName, { passive: false });

    pq.addListener('open', function (messageCount, consumerCount) {
        pq.bind('amq.topic', resource + '.ping.' + uuid);

        pq.subscribeJSON({ ack: true }, function (msg) {
            console.log('Received ping message');
            var client_id = msg.client_id;
            var id = msg.id;

            var newmsg = {
                req_id: id,
                timestamp: new Date().toISOString()
            };
            var rk = [
                resource,
                'ack' + client_id,
                uuid
            ].join('.');


            console.log('Publishing ping reply to ' + rk);
            exchange.publish(rk, newmsg);

            pq.shift();
        });
    });
}

/*
 *
 *  sample format:
 *  {
 *    'zoneStatus': [
 *      [0, 'global', 'running', '/', '', 'liveimg', 'shared', '0'],
 *      [2, '91f8fb10-2c22-441e-9a98-84244b44e5e9', 'running',
 *      '/zones/91f8fb10-2c22-441e-9a98-84244b44e5e9',
 *        '91f8fb10-2c22-441e-9a98-84244b44e5e9', 'joyent', 'excl', '1'],
 *      [27, '020a127a-d79d-41eb-aa12-ffd30da81887', 'running',
 *      '/zones/020a127a-d79d-41eb-aa12-ffd30da81887',
 *        '020a127a-d79d-41eb-aa12-ffd30da81887', 'kvm', 'excl', '14']
 *    ],
 *    'zpoolStatus': [
 *      ['zones', '1370.25G', '41.35G', 'ONLINE']
 *    ],
 *    'timestamp': 1328063128.01,
 *    'meminfo': {
 *      'availrmem_bytes': 40618254336,
 *      'arcsize_bytes': 5141061712,
 *      'total_bytes': 51520827392
 *    }
 *  }
 */

function markDirty() {
    isDirty = true;
}

function updateSample() {
    var newSample = {};

    if (samplerLock) {
        console.log('ERROR: samplerLock is still held, skipping update.');
        return;
    }

    samplerLock = true;

    // set this now in case another update comes in while we're running.
    isDirty = false;

    // newline and timestamp when we *start* an update
    process.stdout.write('\n[' + (new Date()).toISOString() + '] ');

    async.series([
        function (cb) { // zone info
            VM.lookup({}, {'full': true}, function (err, vmobjs) {
                var vmobj;
                var hbVm;
                var running = 0;
                var newStatus;
                var notRunning = 0;
                var nonInventory = 0;

                if (err) {
                    console.log(
                        'ERROR: unable update VM list: ' + err.message);
                    markDirty();
                    return cb(new Error('unable to update VM list.'));
                } else {
                    newSample.vms = {};
                    newSample.zoneStatus = [];

                    // add GZ info for historical reasons
                    newSample.zoneStatus.push(
                        [0, 'global', 'running',
                         '/', '', 'liveimg', 'shared', '0']);

                    for (vmobj in vmobjs) {
                        vmobj = vmobjs[vmobj];
                        if (!vmobj.do_not_inventory) {
                            hbVm = {
                                uuid: vmobj.uuid,
                                owner_uuid: vmobj.owner_uuid,
                                quota: vmobj.quota,
                                max_physical_memory: vmobj.max_physical_memory,
                                zone_state: vmobj.zone_state,
                                state: vmobj.state
                            };
                            newStatus = [
                                vmobj.zoneid ? vmobj.zoneid : '-',
                                vmobj.zonename,
                                vmobj.zone_state,
                                vmobj.zonepath,
                                vmobj.uuid,
                                vmobj.brand,
                                'excl',
                                vmobj.zoneid ? vmobj.zoneid : '-'
                            ];
                            if (vmobj.hasOwnProperty('last_modified')) {
                                // this is only conditional until all platforms
                                // we might run this heartbeater on support the
                                // last_modified property.
                                hbVm.last_modified = vmobj.last_modified;
                                newStatus.push(vmobj.last_modified);
                            }
                            newSample.zoneStatus.push(newStatus);
                            newSample.vms[vmobj.uuid] = hbVm;
                            if (vmobj.zone_state === 'running') {
                                running++;
                            } else {
                                notRunning++;
                            }
                        } else {
                            nonInventory++;
                        }
                    }

                    process.stdout.write('Z(' + running + ',' + notRunning);
                    if (nonInventory > 0) {
                        process.stdout.write(',' + nonInventory);
                    }
                    process.stdout.write(')');
                    return cb();
                }
            });
        },
        function (cb) { // zpool info
            zpool.list(function (err, fields, lines) {
                if (err) {
                    console.log('zpool list error: ' + err);
                    return cb(err);
                }

                newSample.zpoolStatus = [];

                var getSpaceStats = function (line, callback) {
                    var pool = line[0];

                    zfs.get(pool, [ 'used', 'available' ], true,
                        function (zfsError, props) {
                            if (zfsError) {
                                console.log('zfs get error: ' + zfsError);
                                return callback(zfsError);
                            }

                            /*
                             * used and available are returned as strings, not
                             * numbers
                             */
                            var bytes_to_GiB = 1024 * 1024 * 1024;
                            var allocated = Number(props.used) / bytes_to_GiB;
                            var size
                            = (Number(props.used) + Number(props.available))
                            / bytes_to_GiB;

                            newSample.zpoolStatus.push([
                                pool,
                                sprintf('%.2fG', size),
                                sprintf('%.2fG', allocated),
                                line[5]
                            ]);
                            return callback();
                        });
                };

                return (
                    async.forEach(lines, getSpaceStats,
                        function (forEachError) {
                        if (forEachError) {
                            console.log('zfs get error: ' + forEachError);
                            return cb(forEachError);
                        }

                        process.stdout.write('P');
                        return cb();
                    }));
            });
        },
        function (cb) { // meminfo
            system.getMemoryInfo(function (err, meminfo) {
                if (!err && meminfo) {
                    newSample.meminfo = meminfo;
                    process.stdout.write('M');
                    return cb();
                } else {
                    console.log('Warning: unable to get memory info:'
                        + JSON.stringify(err));
                    return cb(err);
                }
            });
        },
        function (cb) { // timestamp
            newSample.timestamp = (new Date()).getTime() / 1000;
            cb();
        }
        ], function (err) {
            if (err) {
                console.log('ERROR: ' + err.message);
            } else {
                sample = newSample;
            }
            samplerLock = false;
        });
}

function startZoneWatcher() {
    watcher = spawn('/usr/vm/sbin/zoneevent', [], {'customFds': [-1, -1, -1]});
    console.log('INFO: zoneevent running with pid ' + watcher.pid);
    watcher.stdout.on('data', function (data) {
        // If we cared about the data here, we'd parse it (JSON) but we just
        // care that *something* changed, not what it was so we always just
        // mark our sample dirty when we see any changes.  It's normal to
        // see multiple updates ('C's) for one zone action.
        process.stdout.write('C');
        markDirty();
    });
    watcher.stdin.end();

    watcher.on('exit', function (code) {
        console.log('WARN: zoneevent watcher exited.');
        watcher = null;
    });
}

function sendSample() {
    if (!watcher) {
        // watcher is either not running or exited, try to start it.
        startZoneWatcher();
    }

    if (isDirty) {
        // start an update for the next cycle
        updateSample();
    }

    if (sample) {
        if (debug) {
            console.log('Sending sample: ' + JSON.stringify(sample));
        }
        exchange.publish(routingKey, sample);
        process.stdout.write('.');
    } else {
        if (debug) {
            console.log('NOT Sending NULL sample');
        }
    }
}

// Run the sysinfo script and return the captured stdout, stderr, and exit
// status code.
function loadSysinfo(callback) {
    execFile('/usr/bin/sysinfo', [], function (exitStatus, stdout, stderr) {
        if (exitStatus) {
            return callback(new Error(stderr), exitStatus, stdout, stderr);
        }

        return callback(
            undefined, exitStatus,
            stdout.toString().trim(), stderr.toString().trim());
    });
}
