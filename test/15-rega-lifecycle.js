/* global describe, step, before */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Tests the start/stop behaviour of ReGaHss (graceful shutdown on SIGTERM)
// and the crash detection of the test harness.

const {
    regaLabel,
    indent,
    ReGaInstance,
    ReGaCrashError,
    requireRegaVersion
} = require('../lib/helper.js');
const {programScript, timerScript} = require('../lib/program-builder.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    describe('graceful shutdown', function () {
        let instance = null;

        step('should start ReGaHss [' + regaLabel + ']', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'shutdown'});
            await instance.start({testFile: __filename});
            await instance.ready();
        });

        step('should enter normal operation', async function () {
            this.slow(15_000);
            this.timeout(60_000);
            await instance.waitFor(/ReGa entering normal operation/);
        });

        step('should terminate on SIGTERM within 30s', async function () {
            this.slow(15_000);
            this.timeout(60_000);
            const result = await instance.stop({signal: 'SIGTERM', timeout: 30_000});
            console.log(indent('exit code ' + result.code + ' (signal ' + result.signal + ') after ' + result.duration + 'ms', 8));
            result.killed.should.be.false('ReGaHss did not terminate within 30s');
            ReGaInstance.isCrash(result).should.be.false('ReGaHss crashed on SIGTERM (' + (result.signal || 'exit code ' + result.code) + '), last log lines:\n' + instance.tail(20));
            (result.signal === null).should.be.true('ReGaHss was terminated by signal ' + result.signal);
        });

        step('should not accept requests anymore', async function () {
            await instance.exec('WriteLine("hello");').should.be.rejected();
        });
    });

    describe('immediate restart', function () {
        let instance = null;

        step('should start ReGaHss and answer a request', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'restart'});
            await instance.start({testFile: __filename});
            await instance.ready();
            const {output} = await instance.exec('WriteLine("first");');
            output.should.equal('first\r\n');
        });

        step('should bind its ports again immediately after being killed', async function () {
            this.timeout(60_000);
            await instance.stop({signal: 'SIGKILL'});
            // (ReGaHss <= R1.00.0388.0252 failed here, as the HTTP port of the
            // previous process was still in use (TIME_WAIT without SO_REUSEADDR))
            instance = new ReGaInstance({name: 'restart'});
            await instance.start({testFile: __filename});
            await instance.ready();
            const {output} = await instance.exec('WriteLine("second");');
            output.should.equal('second\r\n');
            await instance.stop();
        });
    });

    // (ReGaHss cancelled its runtime threads on SIGTERM instead of waiting for
    // them and freed e.g. the scheduler list while other threads still used
    // it, so it sporadically crashed, aborted ("terminate called without an
    // active exception") or hung instead of exiting)
    describe('graceful shutdown with pending scheduler entries', function () {
        // fixed in ReGaHss R1.00.0388.0262
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0262');
        });

        for (const [i, delay] of [0, 400, 1200].entries()) {
            step('should terminate on SIGTERM within 30s (run ' + (i + 1) + ')', async function () {
                this.slow(20_000);
                this.timeout(90_000);
                const instance = new ReGaInstance({name: 'shutdown-scheduler'});
                await instance.start({testFile: __filename});
                await instance.ready();
                await instance.waitFor(/ReGa entering normal operation/);
                // (delayed State() calls add elements to the scheduler list)
                const {output} = await instance.exec(`
integer n = 0;
while (n < 20) {
  dom.GetObject(ID_PRESENT).State(n % 2, 1);
  n = n + 1;
}
WriteLine("ok");
                `);
                output.should.equal('ok\r\n');
                await new Promise(resolve => {
                    setTimeout(resolve, delay);
                });
                const result = await instance.stop({signal: 'SIGTERM', timeout: 30_000});
                result.killed.should.be.false('ReGaHss did not terminate within 30s, last log lines:\n' + instance.tail(20));
                ReGaInstance.isCrash(result).should.be.false('ReGaHss crashed on SIGTERM (' + (result.signal || 'exit code ' + result.code) + '), last log lines:\n' + instance.tail(20));
                (result.signal === null).should.be.true('ReGaHss was terminated by signal ' + result.signal);
            });
        }
    });

    // (when the DOM was destroyed at the end of a stop, the condition of a
    // program with a time module deleted its calendar datapoint while the DOM
    // container was already partially destroyed: ReGaHss aborted with "pure
    // virtual method called" if the condition was deleted before the time
    // module, i.e. if it has the higher object ID)
    describe('graceful shutdown with a program with a time module', function () {
        // fixed in ReGaHss R1.00.0388.0263
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0263');
        });

        step('should terminate on SIGTERM without abort', async function () {
            this.slow(20_000);
            this.timeout(90_000);
            const instance = new ReGaInstance({name: 'shutdown-time-module'});
            await instance.start({testFile: __filename});
            await instance.ready();
            await instance.waitFor(/ReGa entering normal operation/);
            // (the time module is created first, so the condition of the
            // program gets the higher object ID)
            const timer = await instance.exec(timerScript({name: 'Shutdown Timer', type: 'periodic', period: 3600}));
            Number(timer.output).should.be.above(0);
            const program = await instance.exec(programScript({
                name: 'Shutdown Program',
                rules: [{conditions: [[{timer: Number(timer.output)}]], destinations: [{script: 'WriteLine("x");'}]}]
            }));
            Number(program.output).should.be.above(Number(timer.output));
            const result = await instance.stop({signal: 'SIGTERM', timeout: 30_000});
            result.killed.should.be.false('ReGaHss did not terminate within 30s, last log lines:\n' + instance.tail(20));
            ReGaInstance.isCrash(result).should.be.false('ReGaHss crashed on SIGTERM (' + (result.signal || 'exit code ' + result.code) + '), last log lines:\n' + instance.tail(20));
            (result.signal === null).should.be.true('ReGaHss was terminated by signal ' + result.signal);
        });
    });

    // (the alarm states are not saved in the DOM file, so all alarms are
    // inactive after a restart, but ReGaHss kept the number of active alarms
    // and service messages (ID_GW_SYSALARM/ID_GW_SYSSERVICE) saved with the
    // DOM file until the next alarm changed, i.e. the WebUI showed alarms or
    // service messages which did not exist (anymore))
    describe('alarm counters after a restart', function () {
        // fixed in ReGaHss R1.00.0388.0266
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0266');
        });

        const counters = 'Write(dom.GetObject(ID_GW_SYSALARM).Value() # " " # dom.GetObject(ID_GW_SYSSERVICE).Value());';
        let instance = null;

        step('should count an active alarm and service message', async function () {
            this.slow(10_000);
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'alarm-counters'});
            await instance.start({testFile: __filename});
            await instance.ready();
            await instance.exec(`
object sv = dom.CreateObject(OT_ALARMDP, "Restart Alarm");
dom.GetObject(ID_SYSTEM_VARIABLES).Add(sv.ID());
sv.ValueType(ivtBinary);
sv.ValueSubType(istAlarm);
sv.AlType(atSystem);
sv.AlArm(true);
sv.State(true);
object svc = dom.CreateObject(OT_ALARMDP, "Restart Service");
dom.GetObject(ID_SERVICES).Add(svc.ID());
svc.ValueType(ivtBinary);
svc.ValueSubType(istAlarm);
svc.AlType(atService);
svc.AlArm(true);
svc.State(true);
            `);
            // (the states are set asynchronously)
            let output = '';
            for (let i = 0; i < 50 && output !== '1 1'; i++) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => {
                    setTimeout(resolve, 100);
                });
                // eslint-disable-next-line no-await-in-loop
                ({output} = await instance.exec(counters));
            }

            output.should.equal('1 1');
            await instance.exec('system.Save();');
            await instance.stop();
        });

        step('should reset the counters on startup', async function () {
            this.slow(10_000);
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'alarm-counters', copyRegadom: false});
            await instance.start({testFile: __filename});
            await instance.ready();
            const {output} = await instance.exec(counters);
            output.should.equal('0 0');
            await instance.stop();
        });
    });

    describe('crash detection of the test harness', function () {
        let instance = null;

        step('should start ReGaHss [' + regaLabel + ']', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'crash'});
            await instance.start({testFile: __filename});
            await instance.ready();
            const {output} = await instance.exec('WriteLine("hello");');
            output.should.equal('hello\r\n');
        });

        step('should reject pending log waits when ReGaHss exits unexpectedly', async function () {
            const pending = instance.waitFor(/this line is never output/);
            // (SIGKILL as a crash signal would be reported by the sanitizers or
            // leave a core dump)
            instance.kill('SIGKILL');
            const error = await pending.should.be.rejectedWith(ReGaCrashError);
            error.signal.should.equal('SIGKILL');
            error.message.should.containEql('exited unexpectedly');
            error.message.should.containEql('last log lines');
            instance.crashed.should.be.true();
        });

        step('should add the crash information to failing requests', async function () {
            const error = await instance.exec('WriteLine("hello");').should.be.rejected();
            error.message.should.containEql('exited unexpectedly (signal SIGKILL)');
        });

        step('should reject log waits after the crash immediately', async function () {
            await instance.waitFor(/this line is never output/).should.be.rejectedWith(ReGaCrashError);
        });
    });
});
