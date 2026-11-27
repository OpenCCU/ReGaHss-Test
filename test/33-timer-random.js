/* global describe, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests the random offset of time modules (tm.CalRandomOffset(seconds)):
// each trigger time of a time module without duration is moved by a random
// offset between -seconds and +seconds. The offset of a trigger time is the
// same for each computation (also after a restart), computed from the time
// module and its regular trigger time, so that Next() shows the actual next
// trigger time and the programs are executed once at it.
// see https://github.com/OpenCCU/OpenCCU/issues/1283

const {
    regaLabel,
    ReGaInstance,
    requireRegaVersion
} = require('../lib/helper.js');
const {programScript, timerScript} = require('../lib/program-builder.js');

require('should');

const sleep = ms => new Promise(resolve => {
    setTimeout(resolve, ms);
});

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    let instance = null;
    let dailyTime = null;
    const ids = {};

    const exec = async script => (await instance.exec(script)).output;
    const object = id => `dom.GetObject(${id})`;
    // Next() of a time module in seconds
    const next = async id => Number(await exec(`Write(${object(id)}.Next().ToInteger());`));
    // creates a time module and returns its ID
    const createTimer = async (name, timer, randomOffset) => {
        const id = Number(await exec(timerScript({name, ...timer})));
        id.should.be.above(0, 'time module ' + name + ' not created');
        if (randomOffset !== undefined) {
            (await exec(`Write(${object(id)}.CalRandomOffset(${randomOffset}));`)).should.equal('true');
        }

        return id;
    };

    // time of the day (as time of a daily time module) the given seconds from now
    const timeFromNow = seconds => exec(`time t = (system.Date("%F %T").ToTime().ToInteger() + ${seconds}).ToTime(); Write("2007-01-01 " # t.Format("%H:%M:%S"));`);

    const start = async () => {
        await instance.start({testFile: __filename});
        await instance.ready();
        await instance.waitFor(/ReGa entering normal operation/);
    };

    // added in ReGaHss R1.00.0388.0273
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0273');
    });

    describe('init', function () {
        step('should start ReGaHss [' + regaLabel + ']', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'timer-random'});
            await start();
        });
    });

    describe('CalRandomOffset()', function () {
        step('should set and get the random offset (0 to 86400 seconds)', async function () {
            this.timeout(30_000);
            const id = await createTimer('TR Property', {type: 'daily', time: '2007-01-01 07:30:00'});
            ids.property = id;
            const tm = object(id);
            (await exec(`Write(${tm}.CalRandomOffset());`)).should.equal('0');
            (await exec(`Write(${tm}.CalRandomOffset(600) # "|" # ${tm}.CalRandomOffset());`)).should.equal('true|600');
            const logged = instance.waitFor(/WARNING: CalRandomOffset\(\): -1 is not between 0 and 86400 seconds/, {buffered: false, timeout: 10_000});
            (await exec(`Write(${tm}.CalRandomOffset(-1) # "|" # ${tm}.CalRandomOffset(86401) # "|" # ${tm}.CalRandomOffset());`)).should.equal('false|false|600');
            await logged;
            (await exec(`Write(${tm}.CalRandomOffset(86400) # "|" # ${tm}.CalRandomOffset());`)).should.equal('true|86400');
        });
    });

    describe('Next()', function () {
        step('should move the next trigger time by at most the random offset, the same for each call', async function () {
            this.timeout(60_000);
            // (a time of the day 6 hours from now: the next trigger time is
            // the one of this regular time, also with the offset)
            dailyTime = await timeFromNow(6 * 3600);
            ids.regular = await createTimer('TR Regular', {type: 'daily', time: dailyTime});
            ids.random = [];
            for (let i = 0; i < 20; i++) {
                ids.random.push(await createTimer('TR Random ' + i, {type: 'daily', time: dailyTime}, 1800));
            }

            await exec('dom.RTUpdate(0);');
            const regular = await next(ids.regular);
            const offsets = [];
            for (const id of ids.random) {
                const offset = (await next(id)) - regular;
                offset.should.be.within(-1800, 1800);
                (await next(id)).should.equal(regular + offset, 'Next() changed');
                offsets.push(offset);
            }

            // (different offsets of the time modules, earlier and later)
            new Set(offsets).size.should.be.above(1, 'offsets: ' + offsets);
            offsets.some(offset => offset < 0).should.be.true('offsets: ' + offsets);
            offsets.some(offset => offset > 0).should.be.true('offsets: ' + offsets);
            ids.offset = offsets[0];
        });

        step('should not move the trigger times without random offset', async function () {
            this.timeout(30_000);
            (await exec(`Write(${object(ids.regular)}.Next().Format("%H:%M:%S"));`)).should.equal(dailyTime.slice(11));
            (await exec(`object tm = ${object(ids.random[1])}; tm.CalRandomOffset(0); Write(tm.Next().Format("%H:%M:%S")); tm.CalRandomOffset(1800);`)).should.equal(dailyTime.slice(11));
        });

        step('should not move the trigger times of a time range', async function () {
            this.timeout(30_000);
            const range = await createTimer('TR Range', {type: 'daily', time: dailyTime, properties: {CalDuration: 3600}}, 1800);
            await exec('dom.RTUpdate(0);');
            (await exec(`Write(${object(range)}.Next().Format("%H:%M:%S"));`)).should.equal(dailyTime.slice(11));
        });

        step('should move the trigger times of a periodic time module', async function () {
            this.timeout(30_000);
            const regular = await createTimer('TR Periodic Regular', {type: 'periodic', period: 300});
            const random = await createTimer('TR Periodic Random', {type: 'periodic', period: 300}, 60);
            await exec('dom.RTUpdate(0);');
            const now = Number(await exec('Write(system.Date("%F %T").ToTime().ToInteger());'));
            const nextRegular = await next(regular);
            const nextRandom = await next(random);
            nextRandom.should.be.within(now, now + 300 + 60);
            // (the next regular time or one 300 seconds before or after it)
            [-300, 0, 300].some(period => Math.abs(nextRandom - (nextRegular + period)) <= 60).should.be.true(`${nextRandom} ${nextRegular}`);
            (await next(random)).should.equal(nextRandom, 'Next() changed');
        });
    });

    describe('saved DOM', function () {
        step('should keep the random offset and the trigger times after a restart', async function () {
            this.timeout(90_000);
            // (time modules are saved with the programs using them)
            const id = await exec(programScript({
                name: 'TR Saved',
                rules: [{conditions: [[{timer: ids.random[0]}], [{timer: ids.property}]], destinations: [{script: 'WriteLine("saved");'}]}]
            }));
            Number(id).should.be.above(0, 'program not created: ' + id);
            await exec('dom.RTUpdate(0);');
            const before = await next(ids.random[0]);
            await exec('system.Save();');
            await instance.stop();
            instance.copyRegadom = false;
            await start();
            (await exec(`Write(${object(ids.random[0])}.CalRandomOffset() # "|" # ${object(ids.property)}.CalRandomOffset());`)).should.equal('1800|86400');
            (await next(ids.random[0])).should.equal(before);
        });
    });

    describe('execution of programs', function () {
        step('should execute a program once at the trigger time with the random offset', async function () {
            this.timeout(120_000);
            await exec(`
object list = dom.GetObject(ID_SYSTEM_VARIABLES);
object sv = dom.CreateObject(OT_VARDP, "TR Executed");
list.Add(sv.ID());
sv.ValueType(ivtString);
sv.ValueSubType(istChar8859);
sv.State("");
sv = dom.CreateObject(OT_VARDP, "TR Count");
list.Add(sv.ID());
sv.ValueType(ivtFloat);
sv.ValueSubType(istGeneric);
sv.ValueMin(0);
sv.ValueMax(1000);
sv.State(0);
dom.RTUpdate(0);
`);
            // (a daily time module 30 seconds from now, moved by -10 to +10 seconds)
            const timer = await createTimer('TR Daily', {type: 'daily', time: await timeFromNow(30)}, 10);
            const id = await exec(programScript({
                name: 'TR Program',
                rules: [{
                    conditions: [[{timer}]],
                    destinations: [{script: 'dom.GetObject("TR Executed").State(system.Date("%F %T").ToTime().ToInteger() # ""); object c = dom.GetObject("TR Count"); c.State(c.Value() + 1);'}]
                }]
            }));
            Number(id).should.be.above(0, 'program not created: ' + id);
            await exec('dom.RTUpdate(0);');
            const expected = await next(timer);
            const now = Number(await exec('Write(system.Date("%F %T").ToTime().ToInteger());'));
            (expected - now).should.be.within(15, 45);
            const deadline = Date.now() + ((expected - now + 20) * 1000);
            let executed = '';
            while (executed === '' && Date.now() < deadline) {
                await sleep(200);
                executed = await exec('Write(dom.GetObject("TR Executed").Value());');
            }

            executed.should.not.equal('', 'program not executed');
            // (its destination script may only run in the next second on a slow system)
            (Number(executed) - expected).should.be.within(0, 2, `executed at ${executed} instead of ${expected}`);
            await sleep(3000);
            (await exec('Write(dom.GetObject("TR Count").Value());')).should.equal('1.000000');
        });
    });

    describe('cleanup', function () {
        step('should still run ReGaHss [' + regaLabel + ']', function () {
            instance.running.should.be.true('ReGaHss is not running anymore, last log lines:\n' + instance.tail(20));
        });
    });

    after(async function () {
        this.timeout(30_000);
        if (instance) {
            await instance.stop();
        }
    });
});
