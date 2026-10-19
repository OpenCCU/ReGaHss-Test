/* global describe, it, step, before, afterEach */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Test environment of the mocha test files: starts/stops ReGaHss (plus the
// rfd simulator and a BIN-RPC client) for each test file via initTest() and
// cleanupTest() and provides access to the running instance.

const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const indentStringModule = require('indent-string');
const binrpc = require('binrpc');

const {
    ReGaInstance, ReGaCrashError, elfInfo, emulatorFor, workerPorts, workerDir, toTimestamp
} = require('./rega-instance.js');
const {RegaClient} = require('./rega-client.js');
const {CcuSimulator, fixtureDevice} = require('./ccu-simulator.js');
const {compareRegaVersions} = require('./version.js');

const indent = indentStringModule.default || indentStringModule;

require('should');
require('mocha-steps');

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

// emulator the binary under test runs with (qemu user mode for other
// architectures, e.g. aarch64/armhf on x86_64 hosts), '' if it runs natively
const regaEmulator = emulatorFor(regaBin);

// architecture of the binary under test (x86_64, i686, aarch64 or arm)
const regaArch = elfInfo(regaBin).arch;

// speed of the faked clock for the (long running) timer tests: 10 lets the
// time pass ten times faster, 1 runs them in real time. Default: 10, but 1 for
// 32-bit ReGaHss binaries, as libfaketime does not accelerate the waits of
// their timer thread (glibc time64 ABI) and the timers would fire too late.
const faketimeRate = Number(process.env.REGA_FAKETIME_RATE || (elfInfo(regaBin).bits === 32 ? 1 : 10));
if (!(faketimeRate > 0)) {
    throw new Error('invalid REGA_FAKETIME_RATE ' + process.env.REGA_FAKETIME_RATE);
}

let regaVersionCache;

/**
 * Version of the ReGaHss binary under test (e.g. "R1.00.0388.0257"), read
 * from its "-h" output once (like scripts/install-regahss.sh does).
 *
 * @returns {?string} the version or null if it could not be determined
 */
function regaVersion() {
    if (regaVersionCache === undefined) {
        // (sanitizer instrumented libraries require the ASan runtime to be
        // preloaded, which is not needed for just printing the version)
        const result = cp.spawnSync(regaEmulator || regaBin, regaEmulator ? [regaBin, '-h'] : ['-h'], {
            encoding: 'latin1',
            timeout: 60_000,
            env: {...process.env, ASAN_OPTIONS: 'verify_asan_link_order=0:detect_leaks=0'}
        });
        const match = /ReGaHss (R\d+(?:\.\d+){3})/.exec(String(result.stdout) + String(result.stderr));
        regaVersionCache = match ? match[1] : null;
    }

    return regaVersionCache;
}

/**
 * Skips a test (called in it()) or all tests of a suite (called in a before()
 * hook, also nested suites) if the ReGaHss under test is older than
 * minVersion, e.g. regression tests of a fix which the release revision of
 * OpenCCU-Base does not contain yet. Skipped tests are listed in the summary
 * (REGA_SKIPPED_FILE).
 *
 * @param {Mocha.Context} context - this of the test or hook
 * @param {string} minVersion - first ReGaHss version containing the tested behaviour
 */
function requireRegaVersion(context, minVersion) {
    const version = regaVersion();
    if (!version) {
        throw new Error('could not determine the version of ' + regaBin + ' (-h)');
    }

    if (compareRegaVersions(version, minVersion) >= 0) {
        return;
    }

    if (process.env.REGA_SKIPPED_FILE) {
        const runnable = context.test;
        const title = runnable.type === 'hook' ? runnable.parent.title : runnable.title;
        const file = path.basename(runnable.file || '');
        fs.appendFileSync(process.env.REGA_SKIPPED_FILE, `- ${file}: ${title} (requires ReGaHss >= ${minVersion}, tested ${version})\n`);
    }

    context.skip();
}

let xmlRpcVersionCache;

/**
 * Version of the libXmlRpc used by the running ReGaHss (e.g. "0.12"), read
 * once from the Server header ("XMLRPC++ 0.12") of an XML-RPC response.
 *
 * @returns {Promise<?string>} the version or null if it could not be determined
 */
async function xmlRpcVersion() {
    if (xmlRpcVersionCache === undefined) {
        const body = '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName><params></params></methodCall>';
        const response = await new Promise((resolve, reject) => {
            const chunks = [];
            const socket = net.createConnection(regaInstance().ports.xmlrpc, '127.0.0.1', () => {
                socket.end('POST / HTTP/1.0\r\nContent-Type: text/xml\r\nContent-Length: ' + body.length + '\r\n\r\n' + body);
            });
            socket.setTimeout(10_000, () => socket.destroy(new Error('timeout reading the XML-RPC response of ReGaHss')));
            socket.on('data', chunk => chunks.push(chunk));
            socket.on('error', reject);
            socket.on('close', () => resolve(Buffer.concat(chunks).toString('latin1')));
        });
        const match = /^Server: *XMLRPC\+\+ *(\d+(?:\.\d+)*)/m.exec(response);
        xmlRpcVersionCache = match ? match[1] : null;
    }

    return xmlRpcVersionCache;
}

/**
 * Skips a test (called in it()) if the libXmlRpc used by the running
 * ReGaHss is older than minVersion, e.g. regression tests of a fix which
 * the libraries of the release revision of OpenCCU-Base do not contain yet.
 * Skipped tests are listed in the summary (REGA_SKIPPED_FILE).
 *
 * @param {Mocha.Context} context - this of the test
 * @param {string} minVersion - first libXmlRpc version (XMLRPC_VERSION) containing the tested behaviour
 */
async function requireXmlRpcVersion(context, minVersion) {
    const version = await xmlRpcVersion();
    if (!version) {
        throw new Error('could not determine the libXmlRpc version (Server header) of ReGaHss');
    }

    if (compareRegaVersions(version, minVersion) >= 0) {
        return;
    }

    if (process.env.REGA_SKIPPED_FILE) {
        const runnable = context.test;
        fs.appendFileSync(process.env.REGA_SKIPPED_FILE, `- ${path.basename(runnable.file || '')}: ${runnable.title} (requires libXmlRpc >= ${minVersion}, tested ${version})\n`);
    }

    context.skip();
}

let current = null;
let currentSim = null;
let rpcClient = null;

// currently running processes (legacy interface, e.g. "if (!procs.rega) ...")
const procs = {rega: null, sim: null};

let regaStarted = false;
let simulatorStarted = false;
let rpcClientStarted = false;

/** @returns {ReGaInstance} the ReGaHss instance of the running test file */
function regaInstance() {
    if (!current) {
        throw new Error('ReGaHss has not been started (initTest() missing?)');
    }

    return current;
}

/** @returns {CcuSimulator} the interface simulator of the running test file */
function simulator() {
    if (!currentSim) {
        throw new Error('simulator has not been started (initTest(true) missing?)');
    }

    return currentSim;
}

/**
 * Waits for a ReGaHss log line matching rx, rejects if ReGaHss crashes.
 *
 * @param {RegExp} rx
 * @param {object} [options] - {timeout, buffered}, see LogWatcher#waitFor()
 * @returns {Promise<string>}
 */
function waitForRega(rx, options) {
    return regaInstance().waitFor(rx, options);
}

/**
 * Waits for a simulator output line matching rx, rejects if ReGaHss crashes.
 *
 * @param {RegExp} rx
 * @param {object} [options] - {timeout, buffered}, see LogWatcher#waitFor()
 * @returns {Promise<string>}
 */
function waitForSim(rx, options) {
    const promise = simulator().waitFor(rx, options);
    // (fail immediately if ReGaHss crashes in the meantime)
    return current ? current.guard(promise) : promise;
}

/**
 * Legacy interface: calls cb with the next (buffered or future) line of
 * ReGaHss ('rega') or the simulator ('sim') matching rx.
 *
 * @param {string} type - rega or sim
 * @param {RegExp} rx
 * @param {function(string)} cb
 */
function subscribe(type, rx, cb) {
    const target = type === 'sim' ? simulator() : regaInstance();
    target.log.on(rx, {resolve: cb});
}

function rpcCall(method, data, cb) {
    rpcClient.methodCall(method, data, cb);
}

/**
 * Sends raw data to the RPC port of ReGaHss on a connection of its own and
 * closes it. (Not on the connection of the BIN-RPC client: a response to an
 * earlier call still pending there turns closing it into a connection reset,
 * and ReGaHss then reports that instead of the data sent.)
 *
 * @param {Buffer} buf
 * @returns {Promise<void>} resolved when the connection is closed
 */
function rpcWrite(buf) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(regaInstance().ports.xmlrpc, '127.0.0.1', () => socket.end(buf));
        socket.on('error', reject);
        socket.on('close', () => resolve());
        socket.resume();
    });
}

// client for the remote script interface of the current ReGaHss instance
// (interface of the former homematic-rega module: rega.exec(script, callback))
const rega = new RegaClient({
    port: () => (current ? current.ports.http : workerPorts().http),
    onError: error => (current ? current.enrichError(error) : error)
});

/**
 * Registers the mocha steps starting ReGaHss for a test file.
 *
 * Either called with an options object or the legacy positional parameters
 * initTest(sim, faketime, rpc, nocopy).
 *
 * @param {object|boolean} [options]
 * @param {boolean} [options.sim=true] - start the rfd simulator
 * @param {?string} [options.faketime] - date/time to start ReGaHss at
 * @param {number} [options.rate=1] - speed of the faked clock
 * @param {?string} [options.fixedTime] - date/time to freeze the clock of ReGaHss at
 * @param {?string} [options.timeshift] - date/time to start ReGaHss at with a clock
 *     running in real time (src/timeshift.c, also beyond 2038 on 32-bit platforms)
 * @param {boolean} [options.rpc=false] - start a BIN-RPC client
 * @param {boolean} [options.nocopy=false] - keep the regadom of the previous instance
 * @param {?string} [options.firstTimer] - (faked) date/time of the first expected
 *     execution of a timer (timer tests): ReGaHss is restarted if it calculated its
 *     timers too late for it (e.g. a slow cold start of an emulated ReGaHss)
 * @param {?Object<string, string>} [options.config] - further settings of rega.conf
 * @param {?boolean} [options.normalOperation] - wait until ReGaHss entered normal
 *     operation (default: with the simulator or a BIN-RPC client), e.g. to create
 *     and trigger programs without the simulator
 */
function initTest(options = true, time = null, rpc = null, nocopy = false) {
    const {
        sim = true, faketime = null, rate = 1, fixedTime = null, timeshift = null, firstTimer = null, config = null,
        normalOperation = null
    } = typeof options === 'object'
        ? options
        : {
            sim: options, faketime: time, rpc, nocopy
        };
    const withRpc = Boolean(typeof options === 'object' ? options.rpc : rpc);
    const keepRegadom = Boolean(typeof options === 'object' ? options.nocopy : nocopy);

    // libfaketime and preloaded sanitizer runtimes (ASan) deadlock at ReGaHss
    // startup (the ASan allocator calls clock_gettime() with its lock held,
    // which triggers the lazy initialization of libfaketime, which allocates
    // memory via dlsym()), thus time based tests are skipped (reported as
    // pending) there
    if ((faketime || fixedTime) && regaPreload) {
        before(function () {
            this.skip();
        });
        return;
    }

    const ports = workerPorts();

    // show the state of ReGaHss and its child processes after failed tests
    afterEach(function () {
        if (this.currentTest.state === 'failed' && current && current.running) {
            const diagnostics = current.diagnostics();
            console.log(indent(diagnostics, 8));
            current.note(diagnostics);
        }
    });

    describe('init', function () {
        if (sim) {
            step('should start the interface simulator (BidCos-RF, HmIP-RF, VirtualDevices)', async function () {
                currentSim = new CcuSimulator({ports});
                procs.sim = currentSim;
                await currentSim.start();
            });
            simulatorStarted = true;
        }

        const startRega = async testFile => {
            current = new ReGaInstance({
                faketime, rate, fixedTime, timeshift, copyRegadom: !keepRegadom, ports, config
            });
            procs.rega = current;
            await current.start({testFile});
        };

        step('should start ReGaHss [' + regaLabel + ']', async function () {
            await startRega(this.test.file);
        });
        regaStarted = true;

        step('wait for HTTP server to be ready', async function () {
            this.slow(10_000);
            this.timeout(60_000);
            await current.ready();
        });

        if (faketime) {
            step('should output DST offset', async function () {
                this.slow(10_000);
                this.timeout(30_000);
                current.waitFor(/ISETIMEZONE =/).then(output => console.log(indent(output, 8)), () => undefined);
                const output = await current.waitFor(/DST offset =/);
                console.log(indent(output, 8));
            });

            step('should output reference time', async function () {
                this.slow(10_000);
                this.timeout(firstTimer ? 120_000 : 30_000);
                for (let restarts = 0; ; restarts++) {
                    // eslint-disable-next-line no-await-in-loop
                    const output = await current.waitFor(/reference time =/);
                    console.log(indent(output, 8));

                    // ReGaHss calculates its timers when it starts: if it did
                    // so too late for the first expected execution (a slow
                    // start, e.g. the cold start of an emulated ReGaHss with
                    // an accelerated faked clock), it correctly skips it and
                    // the timer test would fail although ReGaHss works fine.
                    // ReGaHss is restarted at the same faked time then.
                    const lead = firstTimer ? timerLead(output, firstTimer) : null;
                    if (lead === null || lead >= minTimerLead) {
                        return;
                    }

                    const message = 'ReGaHss calculated its timers only ' + lead + 's before the first expected execution (' + firstTimer + ')';
                    if (restarts >= maxTimerRestarts) {
                        console.log(indent('WARNING: ' + message + ', giving up after ' + restarts + ' restarts', 8));
                        reportWarning(path.relative(path.join(__dirname, '..'), this.test.file || '') + ': ' + message + ', giving up after ' + restarts + ' restarts');
                        return;
                    }

                    console.log(indent('WARNING: ' + message + ', restarting ReGaHss', 8));
                    reportWarning(path.relative(path.join(__dirname, '..'), this.test.file || '') + ': ' + message + ', restarted ReGaHss');
                    // eslint-disable-next-line no-await-in-loop
                    await current.stop();
                    // eslint-disable-next-line no-await-in-loop
                    await startRega(this.test.file);
                    // eslint-disable-next-line no-await-in-loop
                    await current.ready();
                }
            });
        }

        if (sim) {
            step('should do init on simulated rfd', async function () {
                this.slow(10_000);
                this.timeout(30_000);
                const init = new RegExp(String.raw`rpc rfd < init \["xmlrpc_bin://127\.0\.0\.1:${ports.xmlrpc}","\d+"]`);
                await waitForSim(init);
            });
        }

        // ReGaHss enters normal operation only once its runtime is fully
        // running (it answers scripts and registers at the interfaces
        // before). Value changes of a test before that (e.g. a slower
        // emulated ReGaHss still starting) may not trigger its programs,
        // and a program created before that may be executed once by the
        // initialization of the programs (also without the simulator).
        // (it takes some seconds, thus only if needed)
        if (normalOperation ?? (sim || withRpc)) {
            step('wait for ReGa normal operation', async function () {
                this.timeout(60_000);
                await current.waitFor(/ReGa entering normal operation/);
            });
        }

        if (sim || withRpc) {
            // (connected only now, as the client does not reconnect after
            // the connection to a not yet listening ReGaHss was refused)
            step('should start rpcClient', function () {
                rpcClient = binrpc.createClient({host: '127.0.0.1', port: ports.xmlrpc, reconnectTimeout: 0});
            });
            rpcClientStarted = true;
        }
    });
}

// minimum (faked) time in seconds between the calculation of the timers by
// ReGaHss and the first expected execution of a timer test, and the maximum
// number of restarts of ReGaHss if it is not met (see initTest())
const minTimerLead = 2;
const maxTimerRestarts = 2;

/**
 * Returns the (faked) time in seconds from a ReGaHss log line (e.g. the one
 * with the reference time of the timer calculation) to the given date/time.
 *
 * @param {string} line - log line starting with a time stamp ('[2020-10-25 02:00:00 CET] ...')
 * @param {string} time - date/time (e.g. '2020-10-25 02:00:00 CET')
 * @returns {?number} the time in seconds or null if the line has no time stamp
 */
function timerLead(line, time) {
    const match = /^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [A-Z]+)] /.exec(line);
    return match ? toTimestamp(time) - toTimestamp(match[1]) : null;
}

/**
 * Appends a warning to the warnings file of the test run (REGA_WARNINGS_FILE,
 * shown in the summary of the docker image).
 *
 * @param {string} message
 */
function reportWarning(message) {
    if (process.env.REGA_WARNINGS_FILE) {
        fs.appendFileSync(process.env.REGA_WARNINGS_FILE, '- ' + message + '\n');
    }
}

/**
 * Registers the mocha tests stopping ReGaHss (and the simulator/BIN-RPC
 * client) at the end of a test file.
 */
function cleanupTest() {
    describe('cleanup', function () {
        if (regaStarted === true) {
            regaStarted = false;
            it('should still run ReGaHss [' + regaLabel + ']', function () {
                if (!current) {
                    throw new Error('ReGaHss has not been started');
                }

                if (current.crashed) {
                    throw new ReGaCrashError(current);
                }

                if (!current.running) {
                    throw new Error('ReGaHss (' + regaBin + ') is not running anymore');
                }
            });

            it('should stop ReGaHss [' + regaLabel + ']', async function () {
                this.slow(60_000);
                this.timeout(60_000);
                const instance = current;
                procs.rega = null;
                if (!instance || !instance.running) {
                    return;
                }

                // stop ReGaHss (with SIGTERM gracefully, e.g. to let it write
                // gcov coverage data) and kill it if it does not terminate in time
                const result = await instance.stop();
                if (result.killed) {
                    console.log(indent('ReGaHss did not terminate within ' + (instance.stopTimeout / 1000) + 's, killed it', 8));
                } else if (instance.isKnownShutdownAbort(result)) {
                    // (known shutdown race of ReGaHss, reported as warning here
                    // and checked strictly by test/15-rega-lifecycle.js)
                    const cores = instance.markCoreDumps('shutdown-abort.');
                    const message = 'ReGaHss aborted on ' + instance.stopSignal + ' (known shutdown race: "terminate called without an active exception")' + (cores.length > 0 ? ', core dump: ' + cores.join(', ') : '');
                    console.log(indent('WARNING: ' + message, 8));
                    reportWarning(path.relative(path.join(__dirname, '..'), this.test.file || '') + ': ' + message);
                } else if (ReGaInstance.isCrash(result)) {
                    throw new Error('ReGaHss crashed while stopping it with ' + instance.stopSignal + ' (' + (result.signal || 'exit code ' + result.code) + '), last log lines:\n' + instance.tail(20));
                }
            });
        }

        if (simulatorStarted === true) {
            simulatorStarted = false;
            it('should stop the interface simulator', async function () {
                const sim = currentSim;
                currentSim = null;
                procs.sim = null;
                if (sim) {
                    await sim.stop();
                }
            });
        }

        if (rpcClientStarted === true) {
            rpcClientStarted = false;
            it('should disconnect rpc client', function () {
                if (rpcClient) {
                    rpcClient.close();
                    rpcClient = null;
                }
            });
        }
    });
}

module.exports = {
    cp,
    rega,
    subscribe,
    procs,
    regaBin,
    regaLabel,
    regaPreload,
    regaEmulator,
    regaArch,
    faketimeRate,
    regaVersion,
    compareRegaVersions,
    requireRegaVersion,
    xmlRpcVersion,
    requireXmlRpcVersion,
    indent,
    initTest,
    cleanupTest,
    rpcCall,
    rpcWrite,
    regaInstance,
    simulator,
    waitForRega,
    waitForSim,
    toTimestamp,
    workerPorts,
    workerDir,
    fixtureDevice,
    ReGaInstance,
    ReGaCrashError
};
