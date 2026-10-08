/* global describe, it, before */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Program scenarios: programs and time modules are created via script (like
// the WebUI does) with system variable and device conditions, comparison
// operators, triggers, AND/OR combinations, "else if"/"else" rules, script,
// system variable and device destinations, delays, periodic/daily timers and
// astro timers at different locations.

const {
    regaLabel,
    faketimeRate,
    initTest,
    cleanupTest,
    simulator,
    waitForSim,
    toTimestamp
} = require('../lib/helper.js');
const {timerScript} = require('../lib/program-builder.js');
const {
    sleep, exec, createSysvars, createProgram, set, value, until, increment
} = require('../lib/script-helpers.js');

require('should');

// sets a variable and waits until the programs have been executed (they run
// asynchronously, a marker program executed after them shows that they ran)
async function setAndSettle(name, newValue) {
    await set(name, newValue);
    await sleep(300);
}

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    describe('programs created via script', function () {
        initTest({sim: true});

        describe('conditions', function () {
            const operators = ['==', '>', '>=', '<', '<='];

            it('should evaluate the comparison operators of number conditions', async function () {
                this.timeout(60_000);
                const variables = {};
                for (const [index] of operators.entries()) {
                    variables['PC Num ' + index] = 'number';
                    variables['PC Res ' + index] = 'string';
                }

                await createSysvars(variables);
                for (const [index, compare] of operators.entries()) {
                    await createProgram({
                        name: 'PC Compare ' + index,
                        rules: [
                            {
                                conditions: [[{
                                    sysvar: 'PC Num ' + index, compare, value: 10, trigger: 'update'
                                }]], destinations: [{sysvar: 'PC Res ' + index, value: 'true'}]
                            },
                            {destinations: [{sysvar: 'PC Res ' + index, value: 'false'}]}
                        ]
                    });
                }

                const compare = {
                    '==': (a, b) => a === b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b
                };
                for (const testValue of [5, 10, 15]) {
                    for (const [index, operator] of operators.entries()) {
                        await set('PC Num ' + index, testValue);
                        await until(() => value('PC Res ' + index), String(compare[operator](testValue, 10)));
                    }
                }
            });

            it('should evaluate range conditions (lower limit included, upper limit excluded)', async function () {
                this.timeout(60_000);
                await createSysvars({'PC Range': 'number', 'PC Range Res': 'string'});
                await createProgram({
                    name: 'PC Range',
                    rules: [
                        {
                            conditions: [[{
                                sysvar: 'PC Range', compare: 'range', value: 10, value2: 20, trigger: 'update'
                            }]], destinations: [{sysvar: 'PC Range Res', value: 'in'}]
                        },
                        {destinations: [{sysvar: 'PC Range Res', value: 'out'}]}
                    ]
                });
                const results = [];
                for (const testValue of [5, 10, 15, 20, 25]) {
                    await set('PC Range Res', '');
                    await set('PC Range', testValue);
                    await until(async () => (await value('PC Range Res')) === '' ? '' : 'done', 'done');
                    results.push(await value('PC Range Res'));
                }

                results.should.deepEqual(['out', 'in', 'in', 'out', 'out']);
            });

            it('should trigger when the condition becomes true, on updates or not at all (check only)', async function () {
                this.timeout(60_000);
                const triggers = ['change', 'update', 'check'];
                const variables = {};
                for (const trigger of triggers) {
                    variables['PC Trig ' + trigger] = 'number';
                    variables['PC Count ' + trigger] = 'number';
                }

                await createSysvars(variables);
                for (const trigger of triggers) {
                    await createProgram({
                        name: 'PC Trigger ' + trigger,
                        rules: [{
                            conditions: [[{
                                sysvar: 'PC Trig ' + trigger, compare: '>=', value: 0, trigger
                            }]], destinations: [increment('PC Count ' + trigger)]
                        }]
                    });
                }

                for (const newValue of [1, 1, 2]) {
                    for (const trigger of triggers) {
                        await setAndSettle('PC Trig ' + trigger, newValue);
                    }
                }

                await sleep(1000);
                const counts = {};
                for (const trigger of triggers) {
                    counts[trigger] = await value('PC Count ' + trigger);
                }

                // ("on change" triggers when the result of the condition changes to
                // true, not on every change of the value)
                counts.should.deepEqual({change: '1.000000', update: '3.000000', check: '0.000000'});
            });

            it('should combine conditions with AND', async function () {
                this.timeout(60_000);
                await createSysvars({'PC A': 'bool', 'PC B': 'bool', 'PC And': 'number'});
                await createProgram({
                    name: 'PC And',
                    rules: [{
                        conditions: [[{sysvar: 'PC A', value: true, trigger: 'change'}, {sysvar: 'PC B', value: true, trigger: 'check'}]],
                        destinations: [increment('PC And')]
                    }]
                });
                await setAndSettle('PC A', true);
                await setAndSettle('PC A', false);
                await setAndSettle('PC B', true);
                await setAndSettle('PC A', true);
                await sleep(1000);
                (await value('PC And')).should.equal('1.000000');
            });

            it('should combine conditions with OR', async function () {
                this.timeout(60_000);
                await createSysvars({'PC C': 'bool', 'PC D': 'bool', 'PC Or': 'number'});
                await createProgram({
                    name: 'PC Or',
                    rules: [{
                        conditions: [[{sysvar: 'PC C', value: true, trigger: 'change'}], [{sysvar: 'PC D', value: true, trigger: 'change'}]],
                        destinations: [increment('PC Or')]
                    }]
                });
                await setAndSettle('PC C', true);
                await setAndSettle('PC D', true);
                await sleep(1000);
                (await value('PC Or')).should.equal('2.000000');
            });

            it('should execute the first matching rule of "if", "else if" and "else"', async function () {
                this.timeout(60_000);
                await createSysvars({'PC Size': 'number', 'PC Size Res': 'string'});
                await createProgram({
                    name: 'PC Size',
                    rules: [
                        {
                            conditions: [[{
                                sysvar: 'PC Size', compare: '<', value: 10, trigger: 'update'
                            }]], destinations: [{sysvar: 'PC Size Res', value: 'small'}]
                        },
                        {
                            conditions: [[{
                                sysvar: 'PC Size', compare: '<', value: 20, trigger: 'update'
                            }]], destinations: [{sysvar: 'PC Size Res', value: 'medium'}]
                        },
                        {destinations: [{sysvar: 'PC Size Res', value: 'large'}]}
                    ]
                });
                for (const [testValue, expected] of [[5, 'small'], [15, 'medium'], [25, 'large'], [5, 'small']]) {
                    await set('PC Size', testValue);
                    await until(() => value('PC Size Res'), expected);
                }
            });

            it('should trigger on device events', async function () {
                this.timeout(30_000);
                await createSysvars({'PC Key': 'number'});
                await createProgram({
                    name: 'PC Key',
                    rules: [{conditions: [[{datapoint: 'BidCos-RF.BidCoS-RF:40.PRESS_SHORT', value: true, trigger: 'update'}]], destinations: [increment('PC Key')]}]
                });
                await simulator().interface('BidCos-RF').event('BidCoS-RF:40', 'PRESS_SHORT', true);
                await until(() => value('PC Key'), '1.000000');
            });
        });

        describe('destinations', function () {
            it('should delay destinations', async function () {
                this.timeout(30_000);
                await createSysvars({'PC Delay': 'bool', 'PC Delayed': 'string'});
                await createProgram({
                    name: 'PC Delay',
                    rules: [{conditions: [[{sysvar: 'PC Delay', value: true, trigger: 'change'}]], destinations: [{sysvar: 'PC Delayed', value: 'done', delay: 3}]}]
                });
                const start = Date.now();
                await set('PC Delay', true);
                await sleep(1000);
                (await value('PC Delayed')).should.equal('');
                await until(() => value('PC Delayed'), 'done', 10_000);
                (Date.now() - start).should.be.within(2500, 6000);
            });

            it('should restart delays of a retriggered program (break on restart)', async function () {
                this.timeout(30_000);
                await createSysvars({
                    'PC Retrigger': 'number', 'PC Retrigger Count': 'number', 'PC Keep': 'number', 'PC Keep Count': 'number'
                });
                await createProgram({
                    name: 'PC Retrigger',
                    rules: [{
                        conditions: [[{
                            sysvar: 'PC Retrigger', compare: '>', value: 0, trigger: 'update'
                        }]], destinations: [{...increment('PC Retrigger Count'), delay: 2}]
                    }]
                });
                await createProgram({
                    name: 'PC Keep',
                    rules: [{
                        conditions: [[{
                            sysvar: 'PC Keep', compare: '>', value: 0, trigger: 'update'
                        }]], breakOnRestart: false, destinations: [{...increment('PC Keep Count'), delay: 2}]
                    }]
                });
                await set('PC Retrigger', 1);
                await set('PC Keep', 1);
                await sleep(1000);
                await set('PC Retrigger', 2);
                await set('PC Keep', 2);
                await sleep(4000);
                const counts = [await value('PC Retrigger Count'), await value('PC Keep Count')];
                counts.should.deepEqual(['1.000000', '2.000000']);
            });

            it('should press a key of a device', async function () {
                this.timeout(30_000);
                await createSysvars({'PC Press': 'bool'});
                await createProgram({
                    name: 'PC Press',
                    rules: [{conditions: [[{sysvar: 'PC Press', value: true, trigger: 'change'}]], destinations: [{datapoint: 'BidCos-RF.BidCoS-RF:30.PRESS_SHORT', value: true}]}]
                });
                await Promise.all([
                    waitForSim(/setValue rfd BidCoS-RF:30 PRESS_SHORT true/, {buffered: false}),
                    set('PC Press', true)
                ]);
            });

            it('should not execute inactive programs', async function () {
                this.timeout(30_000);
                await createSysvars({'PC Inactive': 'bool', 'PC Inactive Count': 'number'});
                await createProgram({
                    name: 'PC Inactive',
                    active: false,
                    rules: [{conditions: [[{sysvar: 'PC Inactive', value: true, trigger: 'change'}]], destinations: [increment('PC Inactive Count')]}]
                });
                await setAndSettle('PC Inactive', true);
                await sleep(1000);
                (await value('PC Inactive Count')).should.equal('0.000000');
            });

            it('should execute programs on request (ProgramExecute)', async function () {
                this.timeout(30_000);
                await createSysvars({'PC Manual Count': 'number'});
                await createProgram({
                    name: 'PC Manual',
                    rules: [{
                        conditions: [[{
                            sysvar: 'PC Manual Count', compare: '<', value: -1, trigger: 'check'
                        }]], destinations: [increment('PC Manual Count')]
                    }]
                });
                const before = await exec('Write(dom.GetObject("PC Manual").ProgramLastExecuteTime().ToInteger());');
                await exec('dom.GetObject("PC Manual").ProgramExecute();');
                await until(() => value('PC Manual Count'), '1.000000');
                const after = await exec('Write(dom.GetObject("PC Manual").ProgramLastExecuteTime().ToInteger());');
                Number(after).should.be.aboveOrEqual(Number(before));
            });

            // see https://github.com/OpenCCU/OpenCCU/issues/2978
            it('should set the trigger information of the conditions like State() on ProgramExecute', async function () {
                this.timeout(60_000);
                await createSysvars({'PC Trigger Var': 'number', 'PC Trigger Count': 'number', 'PC Trigger Exec': 'number'});
                // ("Wenn": never true, executed by ProgramExecute() only; "Sonst wenn": always true)
                await createProgram({
                    name: 'PC Trigger Info',
                    rules: [
                        {
                            conditions: [[{
                                sysvar: 'PC Trigger Var', compare: '>', value: 1000, trigger: 'update'
                            }]], destinations: [increment('PC Trigger Exec')]
                        },
                        {
                            conditions: [[{
                                sysvar: 'PC Trigger Var', compare: '>=', value: 0, trigger: 'update'
                            }]], destinations: [increment('PC Trigger Count')]
                        }
                    ]
                });
                const varId = await exec('Write(dom.GetObject("PC Trigger Var").ID());');
                // trigger object of the conditions of the rule and its sub rule
                const triggers = () => exec(`
object r = dom.GetObject("PC Trigger Info").Rule();
Write(r.RuleCondition(0).DestinationObject() # " " # r.RuleSubRule().RuleCondition(0).DestinationObject());
                `);

                await set('PC Trigger Var', 1);
                await until(() => value('PC Trigger Count'), '1.000000');
                (await triggers()).should.equal(varId + ' ' + varId);

                await exec('dom.GetObject("PC Trigger Info").State(1);');
                await until(() => value('PC Trigger Count'), '2.000000');
                (await triggers()).should.equal('65535 65535');

                await set('PC Trigger Var', 2);
                await until(() => value('PC Trigger Count'), '3.000000');
                (await triggers()).should.equal(varId + ' ' + varId);

                // (the trigger information is set when the program is executed after the delay)
                await exec('dom.GetObject("PC Trigger Info").State(1, 300);');
                await until(() => value('PC Trigger Count'), '4.000000');
                (await triggers()).should.equal('65535 65535');

                await set('PC Trigger Var', 3);
                await until(() => value('PC Trigger Count'), '5.000000');
                (await triggers()).should.equal(varId + ' ' + varId);

                await exec('dom.GetObject("PC Trigger Info").ProgramExecute();');
                await until(() => value('PC Trigger Exec'), '1.000000');
                (await triggers()).should.equal('65535 65535');
            });
        });

        describe('time modules', function () {
            it('should execute programs with periodic timers', async function () {
                this.timeout(30_000);
                await createSysvars({'PC Periodic Count': 'number'});
                const timer = await exec(timerScript({name: 'PC Periodic', type: 'periodic', period: 2}));
                await createProgram({
                    name: 'PC Periodic',
                    rules: [{conditions: [[{timer: Number(timer)}]], destinations: [increment('PC Periodic Count')]}]
                });
                await sleep(7000);
                Number(await value('PC Periodic Count')).should.be.within(2, 5);
            });

            it('should execute programs with daily timers', async function () {
                this.timeout(30_000);
                await createSysvars({'PC Daily': 'string'});
                // (time of the day 5 seconds from now)
                const time = await exec('time t = (system.Date("%F %T").ToTime().ToInteger() + 5).ToTime(); Write("2007-01-01 " # t.Format("%H:%M:%S"));');
                const timer = await exec(timerScript({name: 'PC Daily', type: 'daily', time}));
                await createProgram({
                    name: 'PC Daily',
                    rules: [{conditions: [[{timer: Number(timer)}]], destinations: [{script: 'dom.GetObject("PC Daily").State(system.Date("%H:%M:%S"));'}]}]
                });
                await until(() => value('PC Daily'), time.slice(11), 15_000);
            });
        });

        cleanupTest();
    });

    // astro timers with a faked (accelerated) clock
    for (const location of [
        // (sunrise 04:44 / 11:23 CEST, ReGaHss starts two minutes before)
        {
            name: 'Berlin', latitude: 52.5, longitude: 13.4, start: '2024-06-15 04:42:00 CEST'
        },
        {
            name: 'New York', latitude: 40.71, longitude: -74.01, start: '2024-06-15 11:21:00 CEST'
        }
    ]) {
        describe('astro timer at ' + location.name, function () {
            initTest({sim: false, faketime: location.start, rate: faketimeRate});

            describe('sunrise timer with an offset of one minute', function () {
                let expected = null;

                before(async function () {
                    this.timeout(30_000);
                    // (the location is changed like the WebUI does)
                    await exec(`system.Latitude(${location.latitude}); system.Longitude(${location.longitude}); var x = dom.ChangedTimeManually();`);
                    const sunrise = await exec('Write(system.SunriseTime("%H:%M:%S"));');
                    expected = toTimestamp(location.start.slice(0, 11) + sunrise + ' ' + location.start.slice(-4)) + 60;
                    await createSysvars({'PC Astro': 'string'});
                    const timer = await exec(timerScript({
                        name: 'PC Astro', type: 'daily', sunOffset: 'afterSunrise', time: '1970-01-01 01:01:00'
                    }));
                    await createProgram({
                        name: 'PC Astro',
                        rules: [{conditions: [[{timer: Number(timer)}]], destinations: [{script: 'dom.GetObject("PC Astro").State(system.Date("%F %T %Z"));'}]}]
                    });
                });

                it('should execute the program one minute after sunrise', async function () {
                    const timeout = Math.ceil(((expected - toTimestamp(location.start) + 120) * 1000) / faketimeRate) + 10_000;
                    this.timeout(timeout + 10_000);
                    await until(async () => ((await value('PC Astro')) === '' ? '' : 'executed'), 'executed', timeout);
                    const executed = toTimestamp(await value('PC Astro'));
                    // (ReGaHss computes sunrise/sunset with minute precision)
                    Math.abs(executed - expected).should.be.below(Math.max(61, 6 * faketimeRate), 'executed at ' + await value('PC Astro'));
                });
            });

            cleanupTest();
        });
    }
});
