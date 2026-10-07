/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, max-nested-callbacks */

// Year 2038 tests: ReGaHss is started shortly before 2038-01-19 03:14:08 UTC
// (2^31 seconds since the epoch, the overflow of a signed 32-bit time_t) with
// a clock running in real time (src/timeshift.c, libfaketime cannot fake
// times beyond 2038 for 32-bit programs). Time modules, programs, timestamps
// of system variables, the communication with the interfaces (XML-RPC) and
// the persistence of timestamps are checked beyond the overflow - which is
// relevant for the 32-bit platforms (i686, armhf), whose ReGaHss is built for
// the 64-bit time_t of the glibc time64 ABI.

const {
    regaLabel,
    initTest,
    cleanupTest,
    simulator,
    waitForSim
} = require('../lib/helper.js');
const {timerScript} = require('../lib/program-builder.js');
const {
    sleep, exec, createSysvars, createProgram, set, value, increment
} = require('../lib/script-helpers.js');

require('should');

// 2038-01-19 04:14:08 CET (first second not representable by a 32-bit time_t)
const overflow = 2 ** 31;

// current time of ReGaHss (seconds since the epoch and formatted)
async function now() {
    const output = await exec('string t = system.Date("%F %T"); Write(t.ToTime().ToInteger() # "|" # t);');
    const [seconds, formatted] = output.split('|');
    return {seconds: Number(seconds), formatted};
}

// waits until fn() returns a truthy value
async function waitFor(fn, timeout, interval = 500) {
    const deadline = Date.now() + timeout;
    let result = await fn();
    while (!result && Date.now() < deadline) {
        await sleep(interval);
        result = await fn();
    }

    return result;
}

async function passedOverflow() {
    const {seconds} = await now();
    return seconds >= overflow;
}

async function hasValue(name) {
    const result = await value(name);
    return result !== '';
}

// timestamp of a system variable (seconds since the epoch and formatted)
async function timestamp(name) {
    const output = await exec(`object sv = dom.GetObject(${JSON.stringify(name)}); Write(sv.Timestamp().ToInteger() # "|" # sv.Timestamp());`);
    const [seconds, formatted] = output.split('|');
    return {seconds: Number(seconds), formatted};
}

// key press on the simulated rfd executing program Key1 of the test regadom
// (event BidCoS-RF:1 PRESS_SHORT → setValue BidCoS-RF:2 PRESS_LONG)
function pressKey1() {
    return Promise.all([
        waitForSim(/setValue rfd BidCoS-RF:2 PRESS_LONG true/, {buffered: false, timeout: 20_000}),
        simulator().interface('BidCos-RF').event('BidCoS-RF:1', 'PRESS_SHORT', true)
    ]);
}

let eventTimestamp = null;

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    describe('clock passing 2038-01-19 03:14:07 UTC', function () {
        initTest({sim: true, timeshift: '2038-01-19 04:13:40'});

        describe('before the overflow', function () {
            it('should start shortly before the overflow of a 32-bit time_t', async function () {
                const {seconds, formatted} = await now();
                formatted.should.startWith('2038-01-19 04:13:');
                seconds.should.be.below(overflow);
                seconds.should.be.above(overflow - 120);
            });

            it('should create time modules and programs', async function () {
                this.timeout(30_000);
                await createSysvars({'Y2038 Periodic': 'number', 'Y2038 Daily': 'string', 'Y2038 Event': 'string'});
                const periodic = await exec(timerScript({name: 'Y2038 Periodic', type: 'periodic', period: 5}));
                await createProgram({
                    name: 'Y2038 Periodic',
                    rules: [{conditions: [[{timer: Number(periodic)}]], destinations: [increment('Y2038 Periodic')]}]
                });
                const daily = await exec(timerScript({name: 'Y2038 Daily', type: 'daily', time: '2007-01-01 04:14:30'}));
                await createProgram({
                    name: 'Y2038 Daily',
                    rules: [{conditions: [[{timer: Number(daily)}]], destinations: [{script: 'dom.GetObject("Y2038 Daily").State(system.Date("%F %T"));'}]}]
                });
                const {seconds} = await now();
                seconds.should.be.below(overflow, 'the test setup took too long');
            });
        });

        describe('beyond the overflow', function () {
            it('should pass 2038-01-19 04:14:07 CET', async function () {
                this.timeout(90_000);
                const passed = await waitFor(passedOverflow, 80_000);
                passed.should.be.true('the clock of ReGaHss did not pass the overflow');
                const {formatted} = await now();
                formatted.should.match(/^2038-01-19 04:1[45]:/);
            });

            it('should keep executing periodic time modules', async function () {
                this.timeout(30_000);
                const before = Number(await value('Y2038 Periodic'));
                await sleep(12_000);
                const after = Number(await value('Y2038 Periodic'));
                (after - before).should.be.within(1, 4);
            });

            it('should execute daily time modules', async function () {
                this.timeout(60_000);
                const fired = await waitFor(() => hasValue('Y2038 Daily'), 45_000);
                fired.should.be.true('the daily time module (04:14:30) did not fire');
                const executed = await value('Y2038 Daily');
                executed.should.match(/^2038-01-19 04:14:3\d$/);
            });

            it('should store timestamps of system variables', async function () {
                await set('Y2038 Event', 'after the overflow');
                eventTimestamp = await timestamp('Y2038 Event');
                eventTimestamp.seconds.should.be.aboveOrEqual(overflow);
                eventTimestamp.formatted.should.startWith('2038-01-19 04:1');
            });

            it('should process events of the interfaces and send values to them (XML-RPC)', async function () {
                this.timeout(30_000);
                await pressKey1();
            });

            it('should save the regadom', async function () {
                this.timeout(30_000);
                const saved = await exec('Write(system.Save());');
                saved.should.equal('true');
            });
        });

        cleanupTest();
    });

    describe('restart beyond the overflow', function () {
        initTest({sim: true, timeshift: '2038-01-19 04:20:00', nocopy: true});

        describe('persisted objects', function () {
            it('should have kept the values (timestamps: time of loading the regadom)', async function () {
                // (records the behaviour: ReGaHss does not save the timestamps of
                // system variables, they are set to the time of loading)
                const variable = await value('Y2038 Event');
                variable.should.equal('after the overflow');
                const {seconds, formatted} = await timestamp('Y2038 Event');
                seconds.should.be.above(eventTimestamp.seconds);
                formatted.should.startWith('2038-01-19 04:2');
            });

            it('should execute the periodic time module', async function () {
                this.timeout(30_000);
                const before = Number(await value('Y2038 Periodic'));
                await sleep(12_000);
                const after = Number(await value('Y2038 Periodic'));
                (after - before).should.be.within(1, 4);
            });

            it('should process events of the interfaces and send values to them (XML-RPC)', async function () {
                this.timeout(30_000);
                await pressKey1();
            });
        });

        cleanupTest();
    });
});
