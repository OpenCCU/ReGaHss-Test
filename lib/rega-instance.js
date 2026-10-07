/* eslint-disable capitalized-comments, unicorn/prefer-event-target */

// A ReGaHss process under test with its own working directory (rega.conf,
// homematic.regadom, InterfacesList.xml) and ports, so that several
// instances (e.g. of parallel mocha workers) can run at the same time.

const cp = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const {LogWatcher} = require('./log-watcher.js');
const {RegaClient} = require('./rega-client.js');

const repoDir = path.join(__dirname, '..');

// signals which indicate a crash of ReGaHss (instead of a requested stop)
const crashSignals = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL', 'SIGSYS', 'SIGTRAP']);

function firstExisting(candidates) {
    return candidates.find(file => file && fs.existsSync(file)) || null;
}

// library making stdout of ReGaHss line buffered when writing into a pipe
const linebufLib = process.env.REGA_LINEBUF_LIB || firstExisting([
    '/usr/local/lib/regahss-test/liblinebuf.so',
    '/usr/libexec/coreutils/libstdbuf.so',
    '/usr/lib/coreutils/libstdbuf.so'
]);

// libfaketime to fake the time of ReGaHss with
const faketimeLib = process.env.REGA_FAKETIME_LIB || firstExisting([
    '/usr/local/lib/faketime/libfaketime.so.1',
    '/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1',
    '/usr/lib/i386-linux-gnu/faketime/libfaketime.so.1',
    '/usr/lib/faketime/libfaketime.so.1'
]);

// ELF machine types of the ReGaHss binaries (OpenCCU-Base architectures) and
// the node.js architectures able to run them natively
const elfMachines = {
    3: {arch: 'i686', native: ['ia32', 'x64']},
    62: {arch: 'x86_64', native: ['x64']},
    40: {arch: 'arm', native: ['arm'], qemu: 'qemu-arm'},
    183: {arch: 'aarch64', native: ['arm64'], qemu: 'qemu-aarch64'}
};

/**
 * @param {string} file - ELF executable
 * @returns {{bits: number, machine: number, arch: string}}
 */
function elfInfo(file) {
    const header = Buffer.alloc(20);
    const fd = fs.openSync(file, 'r');
    try {
        fs.readSync(fd, header, 0, header.length, 0);
    } finally {
        fs.closeSync(fd);
    }

    if (header.toString('latin1', 0, 4) !== '\u007FELF') {
        throw new Error(file + ' is not an ELF executable');
    }

    const machine = header.readUInt16LE(18);
    return {bits: header[4] === 1 ? 32 : 64, machine, arch: elfMachines[machine]?.arch || 'unknown'};
}

function findInPath(names) {
    for (const name of names) {
        for (const dir of (process.env.PATH || '').split(':').filter(Boolean)) {
            if (fs.existsSync(path.join(dir, name))) {
                return path.join(dir, name);
            }
        }
    }

    return null;
}

/**
 * Emulator (qemu user mode) to run a ReGaHss binary of another architecture
 * with (REGA_EMULATOR overrides it, "none" disables it).
 *
 * @param {string} bin
 * @returns {string} emulator command or '' if the binary runs natively
 */
function emulatorFor(bin) {
    if (process.env.REGA_EMULATOR !== undefined) {
        return process.env.REGA_EMULATOR === 'none' ? '' : process.env.REGA_EMULATOR;
    }

    const machine = elfMachines[elfInfo(bin).machine];
    if (!machine || machine.native.includes(os.arch())) {
        return '';
    }

    const emulator = machine.qemu && findInPath([machine.qemu + '-static', machine.qemu]);
    if (!emulator) {
        throw new Error('no emulator found to run the ' + machine.arch + ' binary ' + bin + ' (install qemu-user-static or set REGA_EMULATOR)');
    }

    return emulator;
}

// library shifting the realtime clock of ReGaHss (src/timeshift.c, used
// for times beyond 2038 on 32-bit platforms, see there)
const timeshiftLib = process.env.REGA_TIMESHIFT_LIB || firstExisting([
    '/usr/local/lib/regahss-test/libtimeshift.so'
]);

// id of the mocha worker process (parallel mode) to derive ports/directories from
const workerId = Number(process.env.MOCHA_WORKER_ID || 0);

let instanceCounter = 0;

/**
 * Ports of the instances of this (worker) process: ReGaHss HTTP server and
 * XML-RPC server, simulated rfd (BidCos-RF) and hmipserver and the (unused)
 * VirtualDevices interface.
 *
 * @returns {{http: number, xmlrpc: number, rfd: number, hmip: number, virtual: number}}
 */
function workerPorts() {
    const base = Number(process.env.REGA_PORT_BASE || 20_000) + ((workerId % 100) * 10);
    return {
        http: base, xmlrpc: base + 1, rfd: base + 2, hmip: base + 3, virtual: base + 4
    };
}

/**
 * @param {string} [suffix] - suffix for additional instances of a worker
 * @returns {string} working directory of the instances of this (worker) process
 */
function workerDir(suffix = '') {
    return path.join(process.env.REGA_WORK_DIR || path.join(os.tmpdir(), 'regahss-test'), 'worker-' + workerId + suffix);
}

/**
 * Converts a date/time string (anything 'date -d' understands, e.g.
 * '2020-10-25 02:59:48 CEST') to a unix timestamp.
 *
 * @param {string} time
 * @returns {number}
 */
function toTimestamp(time) {
    const result = cp.spawnSync('date', ['-d', time, '+%s'], {encoding: 'utf8'});
    const timestamp = Number.parseInt(result.stdout, 10);
    if (result.status !== 0 || Number.isNaN(timestamp)) {
        throw new Error('invalid date/time "' + time + '": ' + (result.stderr || '').trim());
    }

    return timestamp;
}

/**
 * Converts a date/time string to the local time 'YYYY-MM-DD hh:mm:ss'.
 *
 * @param {string} time
 * @returns {string}
 */
function localTime(time) {
    const result = cp.spawnSync('date', ['-d', time, '+%Y-%m-%d %H:%M:%S'], {encoding: 'utf8'});
    if (result.status !== 0) {
        throw new Error('invalid date/time "' + time + '": ' + (result.stderr || '').trim());
    }

    return result.stdout.trim();
}

class ReGaCrashError extends Error {
    constructor(instance) {
        const {code, signal} = instance.exitInfo;
        super('ReGaHss [' + instance.label + '] exited unexpectedly ('
            + (signal ? 'signal ' + signal : 'exit code ' + code) + '), last log lines:\n'
            + instance.tail(20));
        this.name = 'ReGaCrashError';
        this.code = code;
        this.signal = signal;
    }
}

class ReGaInstance extends EventEmitter {
    /**
     * @param {object} [options]
     * @param {string} [options.bin] - ReGaHss binary (REGA_BIN, default /bin/ReGaHss)
     * @param {string} [options.label] - label used in messages (REGA_LABEL)
     * @param {string} [options.name=rega] - name of the instance (used for the log file name)
     * @param {string} [options.workDir] - working directory for the configuration (default: REGA_WORK_DIR/worker-<id>)
     * @param {string} [options.libDir] - directory with the libraries to run ReGaHss with (LD_LIBRARY_PATH)
     * @param {string} [options.logDir] - directory to write the log output to (REGA_LOG_DIR)
     * @param {string} [options.regadom] - homematic.regadom to start with
     * @param {boolean} [options.copyRegadom=true] - false: keep the regadom of a previous instance
     * @param {string} [options.preload] - libraries to preload (REGA_PRELOAD, e.g. ASan runtime)
     * @param {?string} [options.faketime] - date/time to start ReGaHss at (via libfaketime)
     * @param {number} [options.rate=1] - speed of the faked clock (e.g. 10: ten times faster)
     * @param {?string} [options.fixedTime] - date/time to freeze the clock of ReGaHss at (via libfaketime)
     * @param {?string} [options.timeshift] - date/time to start ReGaHss at, the clock runs in
     *     real time (via src/timeshift.c, also beyond 2038 on 32-bit platforms)
     * @param {string} [options.stopSignal] - signal to stop ReGaHss with (REGA_STOP_SIGNAL, default KILL)
     * @param {number} [options.stopTimeout=20000] - time to wait for ReGaHss to terminate before it is killed
     * @param {object} [options.ports] - ports to use (default: ports of the worker process)
     * @param {boolean} [options.output] - print the output (REGA_OUTPUT=1)
     * @param {string} [options.emulator] - emulator to run ReGaHss with (default: qemu user mode
     *     for binaries of another architecture, REGA_EMULATOR)
     */
    // eslint-disable-next-line complexity
    constructor(options = {}) {
        super();
        this.bin = options.bin || process.env.REGA_BIN || '/bin/ReGaHss';
        this.label = options.label || process.env.REGA_LABEL || path.basename(this.bin);
        this.name = options.name || 'rega';
        this.workDir = options.workDir || workerDir();
        this.libDir = options.libDir || '';
        this.logDir = options.logDir ?? process.env.REGA_LOG_DIR ?? '';
        this.regadom = options.regadom || path.join(repoDir, 'homematic.regadom');
        this.copyRegadom = options.copyRegadom ?? true;
        this.preload = options.preload ?? process.env.REGA_PRELOAD ?? '';
        this.faketime = options.faketime || null;
        this.fixedTime = options.fixedTime || null;
        this.timeshift = options.timeshift || null;
        this.rate = options.rate || 1;
        this.stopSignal = 'SIG' + (options.stopSignal || process.env.REGA_STOP_SIGNAL || 'KILL').replace(/^SIG/, '');
        this.stopTimeout = options.stopTimeout ?? 20_000;
        this.ports = {...workerPorts(), ...options.ports};
        this.output = options.output ?? process.env.REGA_OUTPUT === '1';
        this.emulator = options.emulator ?? emulatorFor(this.bin);

        this.configDir = path.join(this.workDir, 'config');
        this.confFile = path.join(this.workDir, 'rega.conf');
        this.domFile = path.join(this.configDir, 'homematic.regadom');

        this.proc = null;
        this.exitInfo = null;
        this.crashed = false;
        this.stopping = false;
        this.logFile = null;
        this._logStream = null;
        this.log = new LogWatcher({name: 'ReGaHss'});
        this.client = new RegaClient({port: this.ports.http, onError: error => this.enrichError(error)});
    }

    /** @returns {boolean} whether the ReGaHss process is running */
    get running() {
        return Boolean(this.proc) && this.exitInfo === null;
    }

    /** @returns {?number} */
    get pid() {
        return this.proc ? this.proc.pid : null;
    }

    _writeConfig() {
        fs.mkdirSync(this.configDir, {recursive: true});
        const settings = {
            UserConfigFileName: path.join(this.configDir, 'rega.conf'),
            DomFileName: this.domFile,
            TimeConfigFileName: path.join(this.configDir, 'time.conf'),
            XmlRpcFileName: path.join(this.configDir, 'InterfacesList.xml'),
            HttpListenerPort: this.ports.http,
            XmlRpcServerPort: this.ports.xmlrpc
        };
        let conf = fs.readFileSync(path.join(repoDir, 'rega.conf'), 'latin1');
        for (const [key, value] of Object.entries(settings)) {
            const rx = new RegExp('^' + key + '=.*$', 'm');
            if (!rx.test(conf)) {
                throw new Error('setting ' + key + ' missing in rega.conf');
            }

            conf = conf.replace(rx, key + '=' + value);
        }

        fs.writeFileSync(this.confFile, conf, 'latin1');

        const interfaces = fs.readFileSync(path.join(repoDir, 'InterfacesList.xml'), 'utf8')
            .replace('127.0.0.1:2001', '127.0.0.1:' + this.ports.rfd)
            .replace('127.0.0.1:2010', '127.0.0.1:' + this.ports.hmip)
            .replace('127.0.0.1:9292', '127.0.0.1:' + this.ports.virtual);
        fs.writeFileSync(settings.XmlRpcFileName, interfaces);

        if (this.copyRegadom || !fs.existsSync(this.domFile)) {
            fs.copyFileSync(this.regadom, this.domFile);
        }
    }

    _env() {
        const env = {...process.env};
        const preload = [this.preload, linebufLib].filter(Boolean);
        // (coreutils' libstdbuf is configured via environment variables)
        env._STDBUF_O = 'L';
        env._STDBUF_E = '0';
        if (this.timeshift) {
            if (!timeshiftLib) {
                throw new Error('timeshift library not found (build src/timeshift.c and set REGA_TIMESHIFT_LIB)');
            }

            preload.push(timeshiftLib);
            env.TIMESHIFT_OFFSET = String(toTimestamp(this.timeshift) - Math.floor(Date.now() / 1000));
        } else if (this.faketime || this.fixedTime) {
            if (!faketimeLib) {
                throw new Error('libfaketime not found (set REGA_FAKETIME_LIB)');
            }

            preload.push(faketimeLib);
            if (this.fixedTime) {
                // (absolute time in the local timezone: the clock stands still)
                env.FAKETIME = localTime(this.fixedTime);
            } else {
                const offset = toTimestamp(this.faketime) - Math.floor(Date.now() / 1000);
                env.FAKETIME = (offset >= 0 ? '+' : '') + offset + (this.rate === 1 ? '' : ' x' + this.rate);
            }

            // ReGaHss waits on CLOCK_MONOTONIC based condition variables, thus only
            // the realtime clock must be faked (required for the time64 ABI of
            // 32-bit builds and for accelerated clocks)
            env.DONT_FAKE_MONOTONIC = '1';
        }

        if (preload.length > 0) {
            env.LD_PRELOAD = preload.join(':');
        }

        if (this.libDir) {
            env.LD_LIBRARY_PATH = [this.libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
        }

        if (this.emulator) {
            // (the loader variables only apply to the emulated ReGaHss, not to
            // a dynamically linked emulator)
            const guestEnv = ['LD_PRELOAD', 'LD_LIBRARY_PATH'].filter(name => env[name]).map(name => name + '=' + env[name]);
            if (guestEnv.length > 0) {
                env.QEMU_SET_ENV = guestEnv.join(',');
            }

            delete env.LD_PRELOAD;
            delete env.LD_LIBRARY_PATH;
        }

        return env;
    }

    _openLog(testFile) {
        if (!this.logDir) {
            return null;
        }

        instanceCounter += 1;
        fs.mkdirSync(this.logDir, {recursive: true});
        const prefix = testFile ? path.basename(testFile, '.js') : this.name;
        this.logFile = path.join(this.logDir, prefix + '-' + String(instanceCounter).padStart(3, '0') + '.log');
        const stream = fs.createWriteStream(this.logFile);
        const faketime = this.faketime ? 'faketime ' + this.faketime + (this.rate === 1 ? '' : ' x' + this.rate) : '';
        const fixedTime = this.fixedTime ? 'fixed time ' + this.fixedTime : '';
        const timeshift = this.timeshift ? 'timeshift ' + this.timeshift : '';
        stream.write('# ' + [this.label, faketime, fixedTime, timeshift, 'ports ' + JSON.stringify(this.ports)].filter(Boolean).join(' ') + '\n');
        return stream;
    }

    /**
     * Starts ReGaHss (resolves as soon as the process is spawned, use ready()
     * to wait for the HTTP server).
     *
     * @param {object} [options]
     * @param {string} [options.testFile] - test file starting the instance (for the log file name)
     */
    async start({testFile = ''} = {}) {
        if (this.running) {
            throw new Error('ReGaHss [' + this.label + '] is already running');
        }

        if (!linebufLib) {
            throw new Error('no line buffering library found (build src/linebuf.c and set REGA_LINEBUF_LIB)');
        }

        this._writeConfig();
        const env = this._env();
        this.log.reset();
        this.exitInfo = null;
        this.crashed = false;
        this.stopping = false;

        const logStream = this._openLog(testFile);
        this._logStream = logStream;
        // (the emulator passes the environment incl. LD_PRELOAD to ReGaHss, the
        // preload libraries are built for the architecture of ReGaHss)
        const args = ['-c', '-l', '0', '-f', this.confFile];
        const proc = cp.spawn(this.emulator || this.bin, this.emulator ? [this.bin, ...args] : args, {
            cwd: this.workDir,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        this.proc = proc;
        ReGaInstance.running.add(this);

        const onLine = line => {
            if (this.output) {
                console.log('ReGaHss', line);
            }

            if (logStream) {
                logStream.write(line + '\n');
            }

            this.log.push(line);
        };

        readline.createInterface({input: proc.stdout, crlfDelay: Number.POSITIVE_INFINITY}).on('line', onLine);
        readline.createInterface({input: proc.stderr, crlfDelay: Number.POSITIVE_INFINITY}).on('line', onLine);

        const onExit = (code, signal) => {
            if (this.exitInfo) {
                // spawning failed
                return;
            }

            this.exitInfo = {code, signal};
            ReGaInstance.running.delete(this);
            if (logStream) {
                logStream.end('# exited with ' + (signal ? 'signal ' + signal : 'code ' + code) + (this.stopping ? ' (stopped)' : ' (unexpectedly)') + '\n');
            }

            if (this.stopping) {
                this.log.fail(new Error('ReGaHss [' + this.label + '] was stopped'));
            } else {
                this.crashed = true;
                const error = new ReGaCrashError(this);
                this.log.fail(error);
                this.emit('crash', error);
            }

            this.emit('exit', this.exitInfo);
        };

        // wait for the remaining output (close) before reporting the exit, but
        // not forever, as forked children of ReGaHss may keep the pipes open
        proc.once('exit', (code, signal) => {
            const timer = setTimeout(() => onExit(code, signal), 2000);
            proc.once('close', () => {
                clearTimeout(timer);
                onExit(code, signal);
            });
        });

        await new Promise((resolve, reject) => {
            proc.once('spawn', resolve);
            proc.once('error', error => {
                this.exitInfo = {code: null, signal: null, error};
                ReGaInstance.running.delete(this);
                logStream?.end('# could not be started: ' + error.message + '\n');
                reject(new Error('could not start ' + this.bin + ': ' + error.message));
            });
        });

        return this;
    }

    /**
     * Waits until the HTTP server of ReGaHss accepts requests (rejects at once
     * if it could not bind its port).
     *
     * @param {number} [timeout=60000]
     */
    async ready(timeout = 60_000) {
        let cancel;
        const bindFailed = new Promise((resolve, reject) => {
            cancel = this.log.on(/Binding listener to port \d+ failed/, {
                resolve: line => reject(new Error('ReGaHss [' + this.label + '] could not bind its HTTP port: ' + line)),
                reject: () => undefined
            });
        });
        try {
            return await Promise.race([this.waitFor(/HTTP server started successfully/, {timeout}), bindFailed]);
        } finally {
            cancel();
        }
    }

    /**
     * Waits for a log line matching rx (rejects if ReGaHss exits).
     *
     * @param {RegExp} rx
     * @param {object} [options] - see LogWatcher#waitFor()
     * @returns {Promise<string>}
     */
    waitFor(rx, options) {
        return this.log.waitFor(rx, options);
    }

    /**
     * Resolves/rejects like the given promise, but rejects as soon as
     * ReGaHss exits (e.g. crashes) before.
     *
     * @param {Promise} promise
     * @returns {Promise}
     */
    async guard(promise) {
        let cancel;
        const exited = new Promise((resolve, reject) => {
            cancel = this.log.on(/(?!)/, {resolve, reject}, false);
        });
        try {
            return await Promise.race([promise, exited]);
        } finally {
            cancel();
        }
    }

    /**
     * @param {number} [count]
     * @returns {string} the last log lines
     */
    tail(count) {
        return this.log.tail(count);
    }

    /**
     * Executes a script via the remote script interface.
     *
     * @param {string} script
     * @returns {Promise<{output: string, objects: Object<string, string>}>}
     */
    exec(script) {
        return this.client.exec(script);
    }

    /**
     * Writes a note (e.g. diagnostics) into the log file of the instance.
     *
     * @param {string} text
     */
    note(text) {
        if (this._logStream && this.running) {
            this._logStream.write(text.split('\n').map(line => '# ' + line).join('\n') + '\n');
        }
    }

    /**
     * Describes the state of the ReGaHss process and its child processes
     * (e.g. hook scripts like /bin/hm_startup) to diagnose hanging tests.
     *
     * @returns {string}
     */
    diagnostics() {
        if (!this.running) {
            return 'ReGaHss [' + this.label + '] is not running (' + JSON.stringify(this.exitInfo) + ')';
        }

        const read = file => {
            try {
                return fs.readFileSync(file, 'utf8');
            } catch {
                return '';
            }
        };

        // (pid, ppid and state from /proc/<pid>/stat, the command name may contain spaces)
        const processes = fs.readdirSync('/proc').filter(entry => /^\d+$/.test(entry)).map(pid => {
            const stat = read('/proc/' + pid + '/stat');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            return {pid: Number(pid), state: fields[0], ppid: Number(fields[1])};
        });
        const tree = [];
        const addChildren = (pid, depth) => {
            const info = processes.find(proc => proc.pid === pid) || {state: '?'};
            const cmdline = read('/proc/' + pid + '/cmdline').replaceAll('\0', ' ').trim();
            const wchan = read('/proc/' + pid + '/wchan');
            const threads = read('/proc/' + pid + '/status').match(/^Threads:\s+(\d+)/m);
            tree.push('  '.repeat(depth) + pid + ' [' + info.state + (wchan && wchan !== '0' ? ', wchan ' + wchan : '') + (threads ? ', ' + threads[1] + ' threads' : '') + '] ' + cmdline);
            for (const child of processes.filter(proc => proc.ppid === pid)) {
                addChildren(child.pid, depth + 1);
            }
        };

        addChildren(this.pid, 0);
        return 'ReGaHss [' + this.label + '] processes:\n' + tree.join('\n') + '\nlast log lines:\n' + this.tail(15);
    }

    /**
     * Adds the crash information to errors of requests to a crashed ReGaHss.
     *
     * @param {Error} error
     * @returns {Error}
     */
    enrichError(error) {
        if (this.crashed && !error.message.includes('exited unexpectedly')) {
            error.message += '\n' + new ReGaCrashError(this).message;
        }

        return error;
    }

    /**
     * Sends a signal to the ReGaHss process (without waiting for it to exit).
     *
     * @param {string} signal
     */
    kill(signal) {
        if (this.running) {
            this.proc.kill(signal);
        }
    }

    /**
     * Waits for the ReGaHss process to exit.
     *
     * @param {number} [timeout=0] - timeout in ms (0: none)
     * @returns {Promise<{code: ?number, signal: ?string}>}
     */
    waitForExit(timeout = 0) {
        if (!this.proc || this.exitInfo) {
            return Promise.resolve(this.exitInfo);
        }

        return new Promise((resolve, reject) => {
            let timer = null;
            if (timeout > 0) {
                timer = setTimeout(() => reject(new Error('ReGaHss [' + this.label + '] did not exit within ' + timeout + 'ms')), timeout);
            }

            this.once('exit', exitInfo => {
                clearTimeout(timer);
                resolve(exitInfo);
            });
        });
    }

    /**
     * Stops ReGaHss with the given signal and kills it if it does not exit
     * within stopTimeout.
     *
     * @param {object} [options]
     * @param {string} [options.signal] - default: stopSignal
     * @param {number} [options.timeout] - default: stopTimeout
     * @returns {Promise<{code: ?number, signal: ?string, killed: boolean, duration: number}>}
     */
    async stop({signal = this.stopSignal, timeout = this.stopTimeout} = {}) {
        if (!this.running) {
            return {...this.exitInfo, killed: false, duration: 0};
        }

        const start = Date.now();
        this.stopping = true;
        this.stoppedWith = signal;
        let killed = false;
        const timer = setTimeout(() => {
            killed = true;
            this.kill('SIGKILL');
        }, timeout);
        this.kill(signal);
        const exitInfo = await this.waitForExit();
        clearTimeout(timer);
        return {...exitInfo, killed, duration: Date.now() - start};
    }

    /**
     * Whether ReGaHss aborted because of its known shutdown race: when its
     * threads are cancelled after it was stopped with SIGTERM, the forced
     * unwind of a cancelled thread sporadically ends in std::terminate()
     * ("terminate called without an active exception").
     *
     * @param {{code: ?number, signal: ?string}} exitInfo - result of stop()
     * @returns {boolean}
     */
    isKnownShutdownAbort({code, signal} = {}) {
        if (this.stoppedWith !== 'SIGTERM' || (signal !== 'SIGABRT' && code !== 134)) {
            return false;
        }

        // (the message is the last output of ReGaHss before it aborts)
        return this.tail(10).includes('terminate called without an active exception');
    }

    /**
     * Renames the core dump of the (exited) process, e.g. to tell core dumps
     * of known aborts apart from the ones of real crashes.
     *
     * @param {string} prefix
     * @returns {string[]} new names of the core dumps
     */
    markCoreDumps(prefix) {
        const pid = this.proc ? this.proc.pid : null;
        let files = [];
        try {
            files = fs.readdirSync(this.workDir);
        } catch {
            return [];
        }

        // (core dumps are named "core" or e.g. "core.ReGaHss.<pid>", the ones of
        // ReGaHss emulated by qemu "qemu_ReGaHss_<time>_<pid>.core")
        const isCore = file => file === 'core' || (pid !== null && ((file.startsWith('core') && file.endsWith('.' + pid))
            || (file.startsWith('qemu_') && file.endsWith('_' + pid + '.core'))));
        return files.filter(file => isCore(file)).map(file => {
            const name = prefix + file;
            fs.renameSync(path.join(this.workDir, file), path.join(this.workDir, name));
            return name;
        });
    }

    /**
     * @param {{code: ?number, signal: ?string}} exitInfo
     * @returns {boolean} whether the exit status indicates a crash
     */
    static isCrash({code, signal} = {}) {
        return crashSignals.has(signal) || code === 134 || code === 139;
    }
}

// instances still running (killed when the process exits)
ReGaInstance.running = new Set();

function killAll() {
    for (const instance of ReGaInstance.running) {
        try {
            instance.proc.kill('SIGKILL');
        } catch {
            // already exited
        }
    }
}

// (also when the test run is terminated)
process.on('exit', killAll);
for (const signal of ['SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
        killAll();
        process.kill(process.pid, signal);
    });
}

module.exports = {
    ReGaInstance,
    ReGaCrashError,
    elfInfo,
    emulatorFor,
    workerPorts,
    workerDir,
    toTimestamp
};
