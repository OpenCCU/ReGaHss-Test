/* global describe, it, step, before */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const cp = require('child_process');
const path = require('path');
const streamSplitter = require('stream-splitter');
const Rega = require('homematic-rega');
const indentStringModule = require('indent-string');
const indent = indentStringModule.default || indentStringModule;
const binrpc = require('binrpc');

const fs = require('fs');

const regaOutput = process.env.REGA_OUTPUT === '1'; // Set REGA_OUTPUT=1 to show stdout/stderr of ReGaHss process
const simOutput = process.env.SIM_OUTPUT === '1'; // Set SIM_OUTPUT=1 to show stdout/stderr of hm-simulator

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

// ReGaHss binary under test and the label used in test titles
const regaBin = process.env.REGA_BIN || '/bin/ReGaHss';
const regaLabel = process.env.REGA_LABEL || path.basename(regaBin);

// fail hard instead of silently skipping if the binary under test is missing
if (!fs.existsSync(regaBin)) {
    throw new Error('ReGaHss binary ' + regaBin + ' not found (set REGA_BIN)');
}

// optional libraries preloaded into the ReGaHss process only (e.g. the
// AddressSanitizer runtime for sanitizer instrumented libraries)
const regaPreload = process.env.REGA_PRELOAD || '';

// signal to stop ReGaHss with (TERM lets it e.g. write gcov coverage data)
const regaStopSignal = process.env.REGA_STOP_SIGNAL || 'KILL';

// time to wait for a graceful ReGaHss shutdown before killing it
const regaStopTimeout = 20_000;

// directory to write the output of each ReGaHss instance to
const regaLogDir = process.env.REGA_LOG_DIR || '';
let regaLogIndex = 0;

// matches the ReGaHss process itself (also when started via faketime)
// but not the unbuffer wrapper process
const regaProcPattern = '^' + regaBin.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + '( |$)';

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

    // consume each buffered line matching any pending subscription(s); the
    // callbacks are called afterwards as they may subscribe again
    const matches = [];
    for (let index = 0; index < buf.length;) {
        const line = buf[index];
        const keys = Object.keys(subs).filter(key => subs[key].rx.test(line));
        if (keys.length === 0) {
            index += 1;
            continue;
        }

        for (const key of keys) {
            matches.push({cb: subs[key].cb, line});
            delete subs[key];
        }

        buf.splice(index, 1);
    }

    for (const match of matches) {
        match.cb(match.line);
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

function startRega(faketime, nocopy = false, testFile = '') {
    // copy homematic.regadom before each test
    if (nocopy === false) {
        cp.execSync('/bin/cp ' + path.join(__dirname, '..', 'homematic.regadom') + ' /etc/config/');
    }

    regaSubscriptions = {};
    regaBuffer = [];

    const regaArgs = [regaBin, '-c', '-l', '0', '-f', '/etc/rega.conf'];
    // faketime appends libfaketime to an already set LD_PRELOAD
    const preloadArgs = regaPreload ? ['env', 'LD_PRELOAD=' + regaPreload] : [];
    // ReGaHss waits on CLOCK_MONOTONIC based condition variables, thus only the
    // realtime clock must be faked (required for the time64 ABI of 32-bit builds)
    procs.rega = faketime
        ? cp.spawn('unbuffer', [...preloadArgs, 'faketime', faketime, ...regaArgs], {env: {...process.env, DONT_FAKE_MONOTONIC: '1'}})
        : cp.spawn('unbuffer', [...preloadArgs, ...regaArgs]);

    let regaLog = null;
    if (regaLogDir) {
        regaLogIndex += 1;
        fs.mkdirSync(regaLogDir, {recursive: true});
        regaLog = fs.createWriteStream(path.join(regaLogDir, 'rega-' + String(regaLogIndex).padStart(3, '0') + '.log'));
        regaLog.write('# ' + [path.basename(testFile), regaLabel, faketime ? 'faketime ' + faketime : ''].join(' ') + '\n');
        procs.rega.on('close', function (code, signal) {
            regaLog.end('# exited with code ' + code + ' (signal ' + signal + ')\n');
        });
    }

    function onOutput(data) {
        const line = data.toString();
        if (regaOutput) {
            console.log('ReGaHss', line);
        }

        if (regaLog) {
            regaLog.write(line + '\n');
        }

        matchSubscriptions('rega', line);
    }

    procs.rega.stdout.pipe(streamSplitter('\n')).on('token', onOutput);
    procs.rega.stderr.pipe(streamSplitter('\n')).on('token', onOutput);
}

function initTest(sim = true, time = null, rpc = null, nocopy = false) {
    // libfaketime and preloaded sanitizer runtimes (ASan) deadlock at ReGaHss
    // startup, thus time based tests are skipped (reported as pending) there
    if (time && regaPreload) {
        before(function () {
            this.skip();
        });
        return;
    }

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

        step('should start ReGaHss [' + regaLabel + ']', function () {
            startRega(time, nocopy, this.test.file);
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

function cleanupTest() {
    describe('cleanup', function () {
        if (regaStarted === true) {
            it('should still run ReGaHss [' + regaLabel + ']', function () {
                const result = cp.spawnSync('pgrep', ['-f', regaProcPattern]).status;
                if (result !== 0) {
                    throw new Error('ReGaHss process (' + regaBin + ') is not running anymore (crashed?)');
                }
            });
            regaStarted = false;
            it('should stop ReGaHss [' + regaLabel + ']', function (done) {
                this.slow(60_000);
                this.timeout(60_000);
                // wrapper process already gone (e.g. after a crash)
                if (procs.rega.exitCode !== null || procs.rega.signalCode !== null) {
                    procs.rega = null;
                    return done();
                }

                // stop ReGaHss (with SIGTERM gracefully, e.g. to let it write
                // gcov coverage data) and kill it if it does not terminate in time
                const killTimer = setTimeout(function () {
                    console.log(indent('ReGaHss did not terminate within ' + (regaStopTimeout / 1000) + 's, killing it', 8));
                    cp.spawnSync('pkill', ['-KILL', '-f', regaProcPattern]);
                }, regaStopTimeout);
                procs.rega.on('close', function () {
                    clearTimeout(killTimer);
                    procs.rega = null;
                    done();
                });
                cp.spawnSync('pkill', ['-' + regaStopSignal, '-f', regaProcPattern]);
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
    regaBin,
    regaLabel,
    indent,
    initTest,
    cleanupTest,
    rpcCall,
    rpcWrite
};
