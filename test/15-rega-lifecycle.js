/* global describe, step */
/* eslint-disable prefer-arrow-callback */

// Tests the start/stop behaviour of ReGaHss (graceful shutdown on SIGTERM)
// and the crash detection of the test harness.

const {
    regaLabel,
    indent,
    ReGaInstance,
    ReGaCrashError
} = require('../lib/helper.js');

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
