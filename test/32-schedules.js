/* global describe, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests the methods for the delayed write jobs of an object (e.g. by
// obj.State(value, ms) or by the delayed destinations of programs):
// Schedules(), ScheduleTimes(), ScheduleStates(), DeleteSchedule() and
// EditSchedule(). Before, a script could neither see nor change them.
// see https://github.com/OpenCCU/OpenCCU/issues/887

const {
    regaLabel,
    ReGaInstance,
    requireRegaVersion
} = require('../lib/helper.js');
const {programScript} = require('../lib/program-builder.js');

require('should');

const sleep = ms => new Promise(resolve => {
    setTimeout(resolve, ms);
});

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    let instance = null;

    const exec = async script => (await instance.exec(script)).output;
    const object = name => `dom.GetObject("${name}")`;
    const value = name => exec(`Write(${object(name)}.Value());`);

    // remaining times of the delayed write jobs of an object (in ms)
    const times = async name => {
        const output = await exec(`Write(${object(name)}.ScheduleTimes());`);
        return output === '' ? [] : output.split('\t').map(Number);
    };

    // waits until the value of a system variable is the expected one
    const until = async (name, expected, timeout = 5000) => {
        const deadline = Date.now() + timeout;
        let actual = await value(name);
        while (actual !== expected && Date.now() < deadline) {
            await sleep(50);
            actual = await value(name);
        }

        actual.should.equal(expected, name);
    };

    // added in ReGaHss R1.00.0388.0273
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0273');
    });

    describe('init', function () {
        step('should start ReGaHss [' + regaLabel + ']', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'schedules'});
            await instance.start({testFile: __filename});
            await instance.ready();
            await instance.waitFor(/ReGa entering normal operation/);
        });

        step('should create the system variables and the program', async function () {
            this.timeout(30_000);
            await exec(`
object list = dom.GetObject(ID_SYSTEM_VARIABLES);
object sv = dom.CreateObject(OT_VARDP, "SC Num");
list.Add(sv.ID());
sv.ValueType(ivtFloat);
sv.ValueSubType(istGeneric);
sv.ValueMin(0);
sv.ValueMax(100);
sv.State(0);
string name;
foreach (name, "SC Bool\\tSC Trigger") {
  sv = dom.CreateObject(OT_VARDP, name);
  list.Add(sv.ID());
  sv.ValueType(ivtBinary);
  sv.ValueSubType(istBool);
  sv.State(false);
}
dom.RTUpdate(0);
`);
            // (the delayed destinations are written to the system variables)
            const id = await exec(programScript({
                name: 'SC Prg',
                rules: [{
                    conditions: [[{sysvar: 'SC Trigger', value: true, trigger: 'update'}]],
                    destinations: [{sysvar: 'SC Num', value: 42, delay: 30}, {sysvar: 'SC Bool', value: true, delay: 20}]
                }]
            }));
            Number(id).should.be.above(0, 'program not created: ' + id);
        });
    });

    describe('object without delayed write jobs', function () {
        step('should have no delayed write jobs', async function () {
            this.timeout(30_000);
            (await exec(`
object sv = ${object('SC Num')};
Write(sv.Schedules() # "|" # sv.ScheduleTimes() # "|" # sv.ScheduleStates() # "|" # sv.ScheduleTimes(0) # "|" # sv.ScheduleStates(0) # "|");
Write(sv.DeleteSchedule() # "|" # sv.DeleteSchedule(0) # "|" # sv.EditSchedule(0, 100));
`)).should.equal('0|||-1||false|false|false');
        });
    });

    describe('State(value, ms)', function () {
        step('should list the delayed write jobs, the next first', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${object('SC Num')}; sv.State(1, 20000); sv.State(2, 10000); sv.State(3, 30000); Write(sv.Schedules() # "|" # sv.ScheduleStates());`)).should.equal('3|2.000000\t1.000000\t3.000000');
            const [first, second, third] = await times('SC Num');
            first.should.be.within(5000, 10_000);
            second.should.be.within(15_000, 20_000);
            third.should.be.within(25_000, 30_000);
            (await exec(`object sv = ${object('SC Num')}; Write(sv.ScheduleStates(1) # "|" # sv.ScheduleStates(2) # "|" # (sv.ScheduleTimes(1) > sv.ScheduleTimes(0)) # "|" # sv.ScheduleTimes(3) # "|" # sv.ScheduleTimes(-1) # "|" # sv.ScheduleStates(3) # "|" # sv.ScheduleStates(-1));`)).should.equal('1.000000|3.000000|true|-1|-1||');
            // (not executed yet)
            (await value('SC Num')).should.equal('0.000000');
        });

        step('should delete a delayed write job without executing it', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${object('SC Num')}; Write(sv.DeleteSchedule(1) # "|" # sv.Schedules() # "|" # sv.ScheduleStates() # "|" # sv.DeleteSchedule(2) # "|" # sv.DeleteSchedule(-1));`)).should.equal('true|2|2.000000\t3.000000|false|false');
            (await value('SC Num')).should.equal('0.000000');
        });

        step('should execute a delayed write job earlier', async function () {
            this.timeout(30_000);
            // (3 becomes the next one)
            (await exec(`object sv = ${object('SC Num')}; Write(sv.EditSchedule(1, 300) # "|" # sv.ScheduleStates());`)).should.equal('true|3.000000\t2.000000');
            await until('SC Num', '3.000000');
            (await exec(`object sv = ${object('SC Num')}; Write(sv.Schedules() # "|" # sv.ScheduleStates());`)).should.equal('1|2.000000');
        });

        step('should execute a delayed write job later', async function () {
            this.timeout(30_000);
            (await exec(`Write(${object('SC Num')}.EditSchedule(0, 60000));`)).should.equal('true');
            const [time] = await times('SC Num');
            time.should.be.within(55_000, 60_000);
        });

        step('should delete all delayed write jobs', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${object('SC Num')}; sv.State(4, 30000); Write(sv.Schedules() # "|" # sv.DeleteSchedule() # "|" # sv.Schedules() # "|" # sv.DeleteSchedule());`)).should.equal('2|true|0|false');
            await sleep(500);
            (await value('SC Num')).should.equal('3.000000');
        });

        step('should execute a delayed write job immediately', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${object('SC Num')}; sv.State(5, 30000); Write(sv.EditSchedule(0, 0));`)).should.equal('true');
            await until('SC Num', '5.000000');
            (await exec(`Write(${object('SC Num')}.Schedules());`)).should.equal('0');
        });

        step('should not change a delayed write job with an invalid index or time', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${object('SC Num')}; sv.State(6, 30000); Write(sv.EditSchedule(-1, 100) # sv.EditSchedule(1, 100) # sv.EditSchedule(0, -5) # "|" # sv.Schedules());`)).should.equal('falsefalsefalse|1');
            const [time] = await times('SC Num');
            time.should.be.within(25_000, 30_000);
            (await exec(`Write(${object('SC Num')}.DeleteSchedule(0));`)).should.equal('true');
        });

        step('should remove an executed write job', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${object('SC Num')}; sv.State(7, 300); Write(sv.Schedules());`)).should.equal('1');
            await until('SC Num', '7.000000');
            (await exec(`Write(${object('SC Num')}.Schedules() # "|" # ${object('SC Num')}.ScheduleTimes());`)).should.equal('0|');
        });

        step('should keep the delayed write jobs of other objects', async function () {
            this.timeout(30_000);
            (await exec(`object n = ${object('SC Num')}; object b = ${object('SC Bool')}; n.State(8, 30000); b.State(true, 30000); Write(n.DeleteSchedule() # "|" # n.Schedules() # "|" # b.Schedules() # "|" # b.ScheduleStates() # "|" # b.DeleteSchedule());`)).should.equal('true|0|1|true|true');
        });
    });

    describe('delayed destinations of programs', function () {
        step('should list, change and delete the delayed destinations of a program at their system variables', async function () {
            this.timeout(30_000);
            await exec(`${object('SC Trigger')}.State(true);`);
            const deadline = Date.now() + 5000;
            while (await exec(`Write(${object('SC Num')}.Schedules() # ${object('SC Bool')}.Schedules());`) !== '11' && Date.now() < deadline) {
                await sleep(50);
            }

            (await exec(`Write(${object('SC Num')}.ScheduleStates() # "|" # ${object('SC Bool')}.ScheduleStates());`)).should.equal('42.000000|true');
            (await times('SC Num'))[0].should.be.within(25_000, 30_000);
            (await times('SC Bool'))[0].should.be.within(15_000, 20_000);
            (await exec(`Write(${object('SC Num')}.DeleteSchedule(0) # "|" # ${object('SC Bool')}.EditSchedule(0, 200));`)).should.equal('true|true');
            await until('SC Bool', 'true');
            await sleep(500);
            (await value('SC Num')).should.equal('7.000000');
            (await exec(`Write(${object('SC Num')}.Schedules() # ${object('SC Bool')}.Schedules());`)).should.equal('00');
        });

        step('should list the delayed execution of a program (State(true, ms))', async function () {
            this.timeout(30_000);
            (await exec(`object prg = ${object('SC Prg')}; prg.State(true, 30000); Write(prg.Schedules() # "|" # prg.ScheduleStates() # "|" # prg.DeleteSchedule() # "|" # prg.Schedules());`)).should.equal('1|true|true|0');
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
