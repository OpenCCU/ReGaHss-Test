/* global describe, it, step, before, afterEach */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Test environment of the mocha test files: starts/stops ReGaHss (plus the
// rfd simulator and a BIN-RPC client) for each test file via initTest() and
// cleanupTest() and provides access to the running instance.

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const indentStringModule = require('indent-string');
const binrpc = require('binrpc');

const {ReGaInstance, ReGaCrashError, workerPorts, toTimestamp} = require('./rega-instance.js');
const {RegaClient} = require('./rega-client.js');
const {Simulator} = require('./simulator.js');

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

// whether the binary under test is a 32-bit ELF executable
function is32Bit(file) {
    const header = Buffer.alloc(5);
    const fd = fs.openSync(file, 'r');
    try {
        fs.readSync(fd, header, 0, header.length, 0);
    } finally {
        fs.closeSync(fd);
    }

    return header[4] === 1;
}

// speed of the faked clock for the (long running) timer tests: 10 lets the
// time pass ten times faster, 1 runs them in real time. Default: 10, but 1 for
// 32-bit ReGaHss binaries, as libfaketime does not accelerate the waits of
// their timer thread (glibc time64 ABI) and the timers would fire too late.
const faketimeRate = Number(process.env.REGA_FAKETIME_RATE || (is32Bit(regaBin) ? 1 : 10));
if (!(faketimeRate > 0)) {
    throw new Error('invalid REGA_FAKETIME_RATE ' + process.env.REGA_FAKETIME_RATE);
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

/** @returns {Simulator} the simulator of the running test file */
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

function rpcWrite(buf) {
    rpcClient.socket.write(buf);
    rpcClient.socket.destroy();
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
 * @param {boolean} [options.rpc=false] - start a BIN-RPC client
 * @param {boolean} [options.nocopy=false] - keep the regadom of the previous instance
 */
function initTest(options = true, time = null, rpc = null, nocopy = false) {
    const {sim = true, faketime = null, rate = 1} = typeof options === 'object'
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
    if (faketime && regaPreload) {
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
            step('should start rfd/hmipserver simulator', function () {
                currentSim = new Simulator({ports}).start();
                procs.sim = currentSim;
            });
            simulatorStarted = true;
        }

        if (withRpc) {
            step('should start rpcClient', function () {
                rpcClient = binrpc.createClient({host: '127.0.0.1', port: ports.xmlrpc, reconnectTimeout: 0});
            });
            rpcClientStarted = true;
        }

        step('should start ReGaHss [' + regaLabel + ']', async function () {
            current = new ReGaInstance({
                faketime, rate, copyRegadom: !keepRegadom, ports
            });
            procs.rega = current;
            await current.start({testFile: this.test.file});
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
                this.timeout(30_000);
                const output = await current.waitFor(/reference time =/);
                console.log(indent(output, 8));
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

        if (withRpc) {
            step('wait for ReGa normal operation', async function () {
                this.timeout(60_000);
                await current.waitFor(/ReGa entering normal operation/);
            });
        }
    });
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
                } else if (ReGaInstance.isCrash(result)) {
                    throw new Error('ReGaHss crashed while stopping it with ' + instance.stopSignal + ' (' + (result.signal || 'exit code ' + result.code) + '), last log lines:\n' + instance.tail(20));
                }
            });
        }

        if (simulatorStarted === true) {
            simulatorStarted = false;
            it('should stop rfd/hmipserver simulator', async function () {
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
                    rpcClient.reconnectTimeout = 0;
                    rpcClient.socket.unref();
                    rpcClient.socket.destroy();
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
    faketimeRate,
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
    ReGaInstance,
    ReGaCrashError
};
