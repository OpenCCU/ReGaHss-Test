// Process of hm-simulator (simulated rfd/hmipserver) for a ReGaInstance.

const cp = require('child_process');
const path = require('path');
const readline = require('readline');

const {LogWatcher} = require('./log-watcher.js');

const launcher = path.join(__dirname, 'sim-launcher.js');

class Simulator {
    /**
     * @param {object} options
     * @param {{rfd: number, hmip: number}} options.ports - ports to listen on
     * @param {boolean} [options.output] - print the output (SIM_OUTPUT=1)
     */
    constructor({ports, output = process.env.SIM_OUTPUT === '1'}) {
        this.ports = ports;
        this.output = output;
        this.proc = null;
        this.exitInfo = null;
        this.log = new LogWatcher({name: 'simulator'});
    }

    get running() {
        return Boolean(this.proc) && this.exitInfo === null;
    }

    start() {
        this.log.reset();
        this.exitInfo = null;
        this.proc = cp.spawn(process.execPath, [launcher], {
            env: {...process.env, SIM_BINRPC_PORT: String(this.ports.rfd), SIM_XMLRPC_PORT: String(this.ports.hmip)},
            stdio: ['ignore', 'pipe', 'pipe']
        });
        Simulator.running.add(this);
        const onLine = line => {
            if (this.output) {
                console.log('sim', line);
            }

            this.log.push(line);
        };

        readline.createInterface({input: this.proc.stdout}).on('line', onLine);
        readline.createInterface({input: this.proc.stderr}).on('line', onLine);
        this.proc.once('close', (code, signal) => {
            this.exitInfo = {code, signal};
            Simulator.running.delete(this);
            this.log.fail(new Error('simulator exited (' + (signal ? 'signal ' + signal : 'exit code ' + code) + '), last lines:\n' + this.log.tail(10)));
        });
        return this;
    }

    waitFor(rx, options) {
        return this.log.waitFor(rx, options);
    }

    async stop() {
        if (!this.running) {
            return;
        }

        const exited = new Promise(resolve => {
            this.proc.once('close', resolve);
        });
        this.proc.kill('SIGTERM');
        await exited;
    }
}

Simulator.running = new Set();

function killAll() {
    for (const sim of Simulator.running) {
        try {
            sim.proc.kill('SIGKILL');
        } catch {
            // Already exited
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

module.exports = {Simulator};
