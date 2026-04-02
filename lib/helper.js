/* global describe, it, step */
/* eslint-disable import/no-unassigned-import, prefer-arrow-callback, max-params, capitalized-comments */

const cp = require('child_process');
const path = require('path');
const streamSplitter = require('stream-splitter');
const Rega = require('homematic-rega');
const indentStringModule = require('indent-string');
const indent = indentStringModule.default || indentStringModule;
const binrpc = require('binrpc');

const regaOutput = false; // Set to true to show stdout/stderr of ReGaHss process
const simOutput = false; // Set to true to show stdout/stderr of hm-simulator

require('should');
require('mocha-steps');

const simCmd = path.join(__dirname, '../node_modules/.bin/hm-simulator');
const simArgs = [];

let rpcClient = null;

let simPipeOut;
let simPipeError;
let simSubscriptions = {};
let simBuffer = [];

const procs = {};

let regaSubscriptions = {};
let regaBuffer = [];

let regaStarted = false;
let simulatorStarted = false;
let rpcClientStarted = false;

let subIndex = 0;

let flavors = [];
flavors = process.env.FLAVOR ? ['.' + process.env.FLAVOR] : ['.normal', '.community'];

function subscribe(type, rx, cb) {
    subIndex += 1;
    if (type === 'sim') {
        simSubscriptions[subIndex] = {rx, cb};
    } else if (type === 'rega') {
        regaSubscriptions[subIndex] = {rx, cb};
    }

    matchSubscriptions(type);
    return subIndex;
}

function matchSubscriptions(type, data) {
    let subs;
    let buf;
    if (type === 'sim') {
        subs = simSubscriptions;
        buf = simBuffer;
    } else if (type === 'rega') {
        subs = regaSubscriptions;
        buf = regaBuffer;
    }

    if (data) {
        buf.push(data);
    }

    for (const [index, line] of buf.entries()) {
        for (const key of Object.keys(subs)) {
            const sub = subs[key];
            if (sub.rx.test(line)) {
                sub.cb(line);
                delete subs[key];
                buf.splice(index, 1);
            }
        }
    }
}

function rpcCall(method, data, cb) {
    rpcClient.methodCall(method, data, cb);
}

function rpcWrite(buf) {
    rpcClient.socket.write(buf);
    rpcClient.socket.destroy();
}

function startRPC() {
    rpcClient = binrpc.createClient({host: '127.0.0.1', port: '31999', reconnectTimeout: 0});
}

function startSim() {
    simSubscriptions = {};
    simBuffer = [];
    procs.sim = cp.spawn(simCmd, simArgs);
    simPipeOut = procs.sim.stdout.pipe(streamSplitter('\n'));
    simPipeError = procs.sim.stderr.pipe(streamSplitter('\n'));
    simPipeOut.on('token', function (data) {
        if (simOutput) {
            console.log('sim', data.toString());
        }

        matchSubscriptions('sim', data.toString());
    });
    simPipeError.on('token', function (data) {
        if (simOutput) {
            console.log('sim', data.toString());
        }

        matchSubscriptions('sim', data.toString());
    });
}

function startRega(flavor, faketime, nocopy = false) {
    // copy homematic.regadom before each test
    if (nocopy === false) {
        cp.execSync('/bin/cp ' + path.join(__dirname, '..', 'homematic.regadom') + ' /etc/config/');
    }

    regaSubscriptions = {};
    regaBuffer = [];
    if (!flavor) {
        flavor = '.' + process.env.FLAVOR;
    }

    procs.rega = faketime ? cp.spawn('unbuffer', ['/bin/faketime', faketime, '/bin/ReGaHss' + flavor, '-c', '-l', '0', '-f', '/etc/rega.conf']) : cp.spawn('unbuffer', ['/bin/ReGaHss' + flavor, '-c', '-l', '0', '-f', '/etc/rega.conf']);

    // Console.log('spawned /bin/ReGaHss' + flavor + ' (pid ' + procs.rega.pid + ')');
    const regaPipeOut = procs.rega.stdout.pipe(streamSplitter('\n'));
    const regaPipeError = procs.rega.stderr.pipe(streamSplitter('\n'));
    regaPipeOut.on('token', function (data) {
        if (regaOutput) {
            console.log('ReGaHss', data.toString());
        }

        matchSubscriptions('rega', data.toString());
    });
    regaPipeError.on('token', function (data) {
        if (regaOutput) {
            console.log('ReGaHss', data.toString());
        }

        matchSubscriptions('rega', data.toString());
    });
}

function initTest(flavor, sim = true, time = null, rpc = null, nocopy = false) {
    describe('init', function () {
        // if (time) {
        //    step('should fake datetime', function (done) {
        //        this.slow(5 * 365 * 24 * 60 * 60 * 1000);
        //        this.timeout(5 * 365 * 24 * 60 * 60 * 1000);
        //        cp.exec('sudo /bin/date -s "' + time + '" +"%Y-%m-%d %H:%M:%S %z (%Z) : %s"', function (e, stdout) {
        //            if (e) {
        //                done(e);
        //            } else {
        //                if (!stdout || stdout.replace('\n', '').length === 0) {
        //                    done(new Error('invalid faketime: "' + time + '"'));
        //                } else {
        //                    done();
        //                }
        //                console.log(indent(stdout.replace('\n', ''), 8));
        //            }
        //        });
        //    });
        // }

        if (sim) {
            step('should start rfd/hmipserver simulator', function () {
                startSim();
            });
            simulatorStarted = true;
        }

        if (rpc) {
            step('should start rpcClient', function () {
                startRPC();
            });
            rpcClientStarted = true;
        }

        step('should start ReGaHss' + flavor, function () {
            startRega(flavor, time, nocopy);
        });
        regaStarted = true;

        step('wait for HTTP server to be ready', function (done) {
            this.slow(10_000);
            this.timeout(60_000);
            subscribe('rega', /HTTP server started successfully/, function () {
                done();
            });
        });

        if (time) {
            step('should output DST offset', function (done) {
                this.slow(10_000);
                this.timeout(30_000);
                subscribe('rega', /ISETIMEZONE =/, function (output) {
                    console.log(indent(output, 8));
                });
                subscribe('rega', /DST offset =/, function (output) {
                    done();
                    console.log(indent(output, 8));
                });
            });

            step('should output reference time', function (done) {
                this.slow(10_000);
                this.timeout(30_000);
                subscribe('rega', /reference time =/, function (output) {
                    done();
                    console.log(indent(output, 8));
                });
            });
        }

        if (sim) {
            step('should do init on simulated rfd', function (done) {
                this.slow(10_000);
                this.timeout(30_000);
                subscribe('sim', /rpc rfd < init \["xmlrpc_bin:\/\/127\.0\.0\.1:31999","\d+"]/, function () {
                    done();
                });
            });
        }

        if (rpc) {
            step('wait for ReGa normal operation', function (done) {
                this.timeout(60_000);
                subscribe('rega', /ReGa entering normal operation/, function () {
                    done();
                });
            });
        }
    });
}

function cleanupTest(flavor) {
    describe('cleanup', function () {
        if (regaStarted === true) {
            it('should still run ReGaHss' + flavor, function (done) {
                this.slow(60_000);
                this.timeout(60_000);
                const result = cp.spawnSync('pgrep', ['-f', 'ReGaHss' + flavor]).status;
                if (result === 0) {
                    done();
                }
            });
            regaStarted = false;
            it('should stop ReGaHss' + flavor, function (done) {
                this.slow(60_000);
                this.timeout(60_000);
                procs.rega.on('close', function () {
                    procs.rega = null;
                    done();
                });
                cp.spawnSync('killall', ['-9', 'ReGaHss' + flavor]);
            });
        }

        if (simulatorStarted === true) {
            simulatorStarted = false;
            it('should stop rfd/hmipserver simulator', function (done) {
                procs.sim.kill();
                procs.sim = null;
                done();
            });
        }

        if (rpcClientStarted === true) {
            rpcClientStarted = false;
            it('should disconnect rpc client', function (done) {
                rpcClient.reconnectTimeout = 0;
                rpcClient.socket.unref();
                rpcClient.socket.destroy();
                rpcClient = null;
                done();
            });
        }
    });
}

const rega = new Rega({host: '127.0.0.1', port: '8183'});

module.exports = {
    cp,
    rega,
    subscribe,
    procs,
    simSubscriptions,
    simBuffer,
    regaSubscriptions,
    regaBuffer,
    flavors,
    indent,
    initTest,
    cleanupTest,
    rpcCall,
    rpcWrite
};
