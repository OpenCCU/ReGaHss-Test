/* global describe, it, before */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, max-nested-callbacks, unicorn/no-await-expression-member */

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
    toTimestamp,
    requireRegaVersion,
    regaInstance,
    waitForRega
} = require('../lib/helper.js');
const {timerScript, compareTypes, triggers} = require('../lib/program-builder.js');
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

// sets a variable and waits until its value event has been processed: the
// value events are processed asynchronously and in order by ReGaHss, so that
// a program created or activated right after setting the variable could
// still be triggered by its event (under load), e.g. a program "if the
// variable is true, on update" executed once more than expected. The marker
// variable set after it shows when the event was processed: its program
// counts in "Settle Count" when it is triggered.
async function setAndProcess(name, newValue) {
    if (await exec('object o = dom.GetObject("Settle Prg"); if (o) { Write("ok"); }') !== 'ok') {
        await createSysvars({'Settle Marker': 'bool', 'Settle Count': 'number'});
        await createProgram({
            name: 'Settle Prg',
            rules: [{conditions: [[{sysvar: 'Settle Marker', value: true, trigger: 'update'}]], destinations: [increment('Settle Count')]}]
        });
    }

    const count = Number(await value('Settle Count'));
    await set(name, newValue);
    await set('Settle Marker', true);
    const deadline = Date.now() + 30_000;
    while (Number(await value('Settle Count')) <= count) {
        Date.now().should.be.below(deadline, 'value event of ' + name + ' not processed');
        await sleep(20);
    }
}

// first ReGaHss version in which the first trigger of a condition "on change"
// is not taken as a change of its result any more
// (see https://github.com/OpenCCU/OpenCCU/issues/4800)
const onChangeFixVersion = 'R1.00.0388.0272';

// creates the number variable <name> with the given value and the program
// "<name> Prg": if <name> is less than 10 (on change), then count in
// "<name> Then", else in "<name> Else"
async function createOnChangeProgram(name, initialValue) {
    await createSysvars({[name]: 'number', [name + ' Then']: 'number', [name + ' Else']: 'number'});
    await set(name, initialValue);
    await createProgram({
        name: name + ' Prg',
        rules: [
            {
                conditions: [[{
                    sysvar: name, compare: '<', value: 10, trigger: 'change'
                }]], destinations: [increment(name + ' Then')]
            },
            {destinations: [increment(name + ' Else')]}
        ]
    });
}

// executions of the "then" and "else" activities of the program, e.g. '1 0'
async function onChangeCounts(name) {
    return Number(await value(name + ' Then')) + ' ' + Number(await value(name + ' Else'));
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
                                sysvar: 'PC Trig ' + trigger, compare: '>=', value: 1, trigger
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
                // true, not on every change of the value; the condition is not met
                // by the initial value 0, as up to ReGaHss R1.00.0388.0271 the first
                // trigger of a new program was taken as a change of the result, see
                // 'conditions "on change" at the first trigger' below)
                counts.should.deepEqual({change: '1.000000', update: '3.000000', check: '0.000000'});
            });

            // see https://github.com/OpenCCU/OpenCCU/issues/1734 and
            // https://github.com/OpenCCU/OpenCCU/issues/1278: the conditions
            // are evaluated asynchronously, they used the current value of the
            // triggering variable instead of the value of the update, so that
            // a program did not react if the variable was updated again
            // meanwhile (e.g. set twice by a script)
            it('should evaluate the conditions with the value of the triggering update', async function () {
                // fixed in ReGaHss R1.00.0388.0265
                requireRegaVersion(this, 'R1.00.0388.0265');
                this.timeout(60_000);
                const triggers = ['update', 'change'];
                const variables = {};
                for (const trigger of triggers) {
                    variables['PC Twice ' + trigger] = 'number';
                    variables['PC Twice Count ' + trigger] = 'number';
                }

                await createSysvars(variables);
                for (const trigger of triggers) {
                    await set('PC Twice ' + trigger, 60);
                    await createProgram({
                        name: 'PC Twice ' + trigger,
                        rules: [{
                            conditions: [[{
                                sysvar: 'PC Twice ' + trigger, compare: '<=', value: 0, trigger
                            }]], destinations: [increment('PC Twice Count ' + trigger)]
                        }]
                    });
                }

                await sleep(500);
                const rounds = 10;
                for (let round = 0; round < rounds; round++) {
                    await exec(triggers.map(trigger => `dom.GetObject("PC Twice ${trigger}").State(0); dom.GetObject("PC Twice ${trigger}").State(60);`).join('\n'));
                    await sleep(100);
                }

                for (const trigger of triggers) {
                    await until(() => value('PC Twice Count ' + trigger), rounds.toFixed(6));
                }
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
                await until(() => value('PC Or'), '2.000000');
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

            // https://github.com/OpenCCU/OpenCCU/issues/4775: a condition of a
            // key kept the trigger ("on change") and comparison of a data point
            // selected before in the WebUI, so that the program was only
            // executed at the first key press (or never)
            it('should trigger on each key press whatever the trigger and comparison of the condition are', async function () {
                // fixed in ReGaHss R1.00.0388.0270
                requireRegaVersion(this, 'R1.00.0388.0270');
                this.timeout(60_000);
                await createSysvars({'PC Key Change': 'number', 'PC Key Range': 'number'});
                await createProgram({
                    name: 'PC Key Change',
                    rules: [{conditions: [[{datapoint: 'BidCos-RF.BidCoS-RF:41.PRESS_SHORT', value: true, trigger: 'change'}]], destinations: [increment('PC Key Change')]}]
                });
                await createProgram({
                    name: 'PC Key Range',
                    rules: [{conditions: [[{datapoint: 'BidCos-RF.BidCoS-RF:42.PRESS_SHORT', value: true, trigger: 'change'}]], destinations: [increment('PC Key Range')]}]
                });
                // (a comparison of a number data point, "in the range of")
                await exec('dom.GetObject("PC Key Range").Rule().RuleCondition(0).CndSingleCondition(0).ConditionType(6);');
                for (const count of [1, 2, 3]) {
                    await simulator().interface('BidCos-RF').event('BidCoS-RF:41', 'PRESS_SHORT', true);
                    await simulator().interface('BidCos-RF').event('BidCoS-RF:42', 'PRESS_SHORT', true);
                    await until(() => value('PC Key Change'), count.toFixed(6));
                    await until(() => value('PC Key Range'), count.toFixed(6));
                }
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
                // (ReGaHss activates new programs asynchronously, thus the
                // variable is set again until the program reacted)
                let pressed = false;
                for (let attempt = 1; attempt <= 5 && !pressed; attempt++) {
                    const press = waitForSim(/setValue rfd BidCoS-RF:30 PRESS_SHORT true/, {buffered: false, timeout: 3000});
                    await set('PC Press', true);
                    pressed = await press.then(() => true, () => false);
                    if (!pressed) {
                        await set('PC Press', false);
                    }
                }

                pressed.should.be.true('PRESS_SHORT of BidCoS-RF:30 not sent');
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
                // fixed in ReGaHss R1.00.0388.0257
                requireRegaVersion(this, 'R1.00.0388.0257');
                this.timeout(60_000);
                await createSysvars({'PC Trigger Var': 'number', 'PC Trigger Count': 'number', 'PC Trigger Exec': 'number'});
                // ("Wenn": never true, executed by ProgramExecute() only; "Sonst wenn":
                // true for the values set below, but not for the initial value 0,
                // as the update event of its State(0) in createSysvars() can
                // arrive after the program was created and execute it)
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
                                sysvar: 'PC Trigger Var', compare: '>', value: 0, trigger: 'update'
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

        // https://github.com/OpenCCU/OpenCCU/issues/4775 and #4776: changing
        // the data point or system variable of a condition or destination
        // (like the WebUI does) kept the fields depending on it, e.g. the
        // trigger "on change" for a key, the comparison "greater than" for a
        // logic value or the index of an entry of another value list
        describe('editing conditions and destinations', function () {
            // added in ReGaHss R1.00.0388.0270
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0270');
            });

            const condition = name => `object sc = dom.GetObject(${JSON.stringify(name)}).Rule().RuleCondition(0).CndSingleCondition(0);`;
            const destination = name => `object sd = dom.GetObject(${JSON.stringify(name)}).Rule().RuleDestination().DestSingleDestination(0);`;
            const fields = 'Write(sc.ConditionType() # " " # sc.ConditionType2() # " " # sc.RightVal1());';
            const id = name => `dom.GetObject(${JSON.stringify(name)}).ID()`;

            it('should create the system variables', async function () {
                this.timeout(30_000);
                await createSysvars({
                    'ED Num': 'number', 'ED Num 10': 'number', 'ED Bool': 'bool', 'ED Enum 5': 'number', 'ED Enum 3': 'number', 'ED Count': 'number'
                });
                await exec(`
dom.GetObject("ED Num 10").ValueMin(0);
dom.GetObject("ED Num 10").ValueMax(10);
object sv = dom.GetObject("ED Enum 5");
sv.ValueType(ivtInteger); sv.ValueSubType(istEnum); sv.ValueList("a;b;c;d;e"); sv.State(0);
sv = dom.GetObject("ED Enum 3");
sv.ValueType(ivtInteger); sv.ValueSubType(istEnum); sv.ValueList("x;y;z"); sv.State(0);
                `);
            });

            it('should reset the trigger and comparison of a condition when a key is selected', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'ED Key',
                    rules: [{conditions: [[{datapoint: 'BidCos-RF.BidCoS-RF:1.LEVEL', value: 0, trigger: 'change'}]], destinations: [increment('ED Count')]}]
                });
                const key = 'BidCos-RF.BidCoS-RF:43.PRESS_SHORT';
                const output = await exec(`${condition('ED Key')}
sc.ConditionType(6);
sc.LeftVal(${id(key)});
Write(sc.ConditionType() # " " # sc.ConditionType2() # " " # (sc.ConditionChannel() == dom.GetObject(${JSON.stringify(key)}).Channel()));
                `);
                output.should.equal('1 1 true');
            });

            it('should correct the comparison of a condition when a logic value is selected', async function () {
                this.timeout(30_000);
                await set('ED Count', 0);
                await createProgram({
                    name: 'ED Logic',
                    rules: [{
                        conditions: [[{
                            sysvar: 'ED Num', compare: '>', value: 5, trigger: 'update'
                        }]], destinations: [increment('ED Count')]
                    }]
                });
                // ("greater than" is invalid for a logic value, "on update" is kept)
                const output = await exec(`${condition('ED Logic')}
sc.LeftVal(${id('ED Bool')});
dom.GetObject("ED Logic").ProgramUpdate();
${fields}
                `);
                output.should.equal('1 13 false');
                // (the condition "false" is met by false only)
                await set('ED Bool', false);
                await until(() => value('ED Count'), '1.000000');
                await set('ED Bool', true);
                await sleep(1000);
                (await value('ED Count')).should.equal('1.000000');
            });

            it('should correct an index outside of the value list of a condition', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'ED Enum',
                    rules: [{conditions: [[{sysvar: 'ED Enum 5', value: 4, trigger: 'change'}]], destinations: [increment('ED Count')]}]
                });
                let output = await exec(`${condition('ED Enum')}
sc.LeftVal(${id('ED Enum 3')});
${fields}
                `);
                output.should.equal('5 4 0');
                // (a valid index is kept)
                output = await exec(`${condition('ED Enum')}
sc.LeftVal(${id('ED Enum 5')});
sc.RightVal1(2);
sc.LeftVal(${id('ED Enum 3')});
${fields}
                `);
                output.should.equal('5 4 2');
            });

            it('should reset the comparison and trigger of a condition when its kind is changed', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'ED Kind',
                    rules: [{
                        conditions: [[{
                            sysvar: 'ED Num', compare: '>=', value: 5, trigger: 'update'
                        }]], destinations: [increment('ED Count')]
                    }]
                });
                // (system variable -> key -> number system variable)
                const output = await exec(`${condition('ED Kind')}
sc.LeftValType(ivtObjectId);
sc.LeftVal(${id('BidCos-RF.BidCoS-RF:44.PRESS_SHORT')});
Write(sc.ConditionType() # " " # sc.ConditionType2() # "|");
sc.LeftValType(ivtSystemId);
sc.LeftVal(${id('ED Num')});
Write(sc.ConditionType() # " " # sc.ConditionType2());
                `);
                output.should.equal('1 1|6 4');
            });

            it('should keep the valid fields of a condition', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'ED Valid',
                    rules: [{
                        conditions: [[{
                            sysvar: 'ED Num', compare: '>', value: 5, trigger: 'change'
                        }]], destinations: [increment('ED Count')]
                    }]
                });
                // (another number, the same system variable again, and a trigger set
                // before the system variable after changing the kind)
                const output = await exec(`${condition('ED Valid')}
sc.ConditionType(9);
sc.ConditionType2(15);
sc.LeftVal(${id('ED Num 10')});
Write(sc.ConditionType() # " " # sc.ConditionType2() # "|");
sc.LeftVal(${id('ED Num 10')});
Write(sc.ConditionType() # " " # sc.ConditionType2() # "|");
sc.LeftValType(ivtObjectId);
sc.LeftValType(ivtSystemId);
sc.ConditionType2(13);
sc.LeftVal(${id('ED Num')});
Write(sc.ConditionType() # " " # sc.ConditionType2());
                `);
                output.should.equal('9 15|9 15|6 13');
            });

            it('should correct a value of a destination which is invalid for the new system variable', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'ED Dest',
                    rules: [{
                        conditions: [[{
                            sysvar: 'ED Num', compare: '>', value: 5, trigger: 'change'
                        }]], destinations: [{sysvar: 'ED Enum 5', value: 4}]
                    }]
                });
                const output = await exec(`${destination('ED Dest')}
sd.DestinationDP(${id('ED Enum 3')});
Write(sd.DestinationValue() # "|");
sd.DestinationDP(${id('ED Enum 5')});
sd.DestinationValue(1);
sd.DestinationDP(${id('ED Enum 3')});
Write(sd.DestinationValue() # "|");
sd.DestinationDP(${id('ED Num')});
sd.DestinationValue(20);
sd.DestinationDP(${id('ED Num 10')});
Write(sd.DestinationValue() # "|");
sd.DestinationDP(${id('ED Num')});
sd.DestinationValue(5);
sd.DestinationDP(${id('ED Num 10')});
Write(sd.DestinationValue());
                `);
                output.should.equal('0|1|0.000000|5.000000');
            });

            // (data points of devices have special values outside of their range)
            it('should keep the value of a destination setting a data point of a device', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'ED Dest Device',
                    rules: [{
                        conditions: [[{
                            sysvar: 'ED Num', compare: '>', value: 5, trigger: 'change'
                        }]], destinations: [{datapoint: 'BidCos-RF.BidCoS-RF:1.LEVEL', value: 1.005}]
                    }]
                });
                const output = await exec(`${destination('ED Dest Device')}
sd.DestinationDP(${id('BidCos-RF.BidCoS-RF:2.LEVEL')});
Write(sd.DestinationValue());
                `);
                output.should.equal('1.005000');
            });
        });

        describe('variables of other scripts', function () {
            // (warning added in ReGaHss R1.00.0388.0266)
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0266');
            });

            // (the scripts of all programs share the variables, so that a script
            // can use a variable declared by another one, see
            // https://github.com/OpenCCU/OpenCCU/issues/84; as they are going to
            // be local to each script, such a use is logged)
            it('should warn once about a variable declared by another script', async function () {
                this.timeout(30_000);
                await createSysvars({'SV Define Trigger': 'bool', 'SV Use Trigger': 'bool', 'SV Out': 'string'});
                await createProgram({
                    name: 'SV Define',
                    rules: [{conditions: [[{sysvar: 'SV Define Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'string svShared = "defined"; dom.GetObject("SV Out").State(svShared);'}]}]
                });
                await createProgram({
                    name: 'SV Use',
                    rules: [{conditions: [[{sysvar: 'SV Use Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'string svOwn = "used"; dom.GetObject("SV Out").State(svShared # " " # svOwn);'}]}]
                });
                const warnings = [];
                const untap = regaInstance().log.tap(line => {
                    if (/ uses variable\(s\) /.test(line)) {
                        warnings.push(line);
                    }
                });
                try {
                    for (let run = 0; run < 2; run++) {
                        await set('SV Out', '');
                        await set('SV Define Trigger', true);
                        await until(() => value('SV Out'), 'defined');
                        // (the variable is still shared)
                        await set('SV Use Trigger', true);
                        await until(() => value('SV Out'), 'defined used');
                    }
                } finally {
                    untap();
                }

                warnings.length.should.equal(1, warnings.join('\n'));
                warnings[0].should.match(/script of program 'SV Use' \(ID \d+\) uses variable\(s\) 'svShared' without declaring them before/);
            });
        });

        describe('scripts setting an alarm with an expression', function () {
            // fixed in ReGaHss R1.00.0388.0266
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0266');
            });

            // (the expression of an alarm is evaluated while State() is called;
            // it was parsed by the same parser as the running script of the
            // program, which overwrote the code of the script, so that the
            // script ended with a script runtime error after State())
            it('should continue the script of a program after setting the alarm', async function () {
                this.timeout(30_000);
                await createSysvars({'NE Alarm Trigger': 'bool', 'NE Alarm Out': 'string', 'NE Alarm In': 'string'});
                const output = await exec(`
object a = dom.CreateObject(OT_ALARMDP, "NE Alarm");
dom.GetObject(ID_SYSTEM_VARIABLES).Add(a.ID());
a.ValueType(ivtBinary);
a.ValueSubType(istAlarm);
a.AlType(atSystem);
a.AlSetBinaryCondition();
a.AlExpression('string neInner = "inner"; dom.GetObject("NE Alarm In").State(neInner);');
a.AlArm(true);
Write("ok");
                `);
                output.should.equal('ok');
                await createProgram({
                    name: 'NE Program',
                    rules: [{conditions: [[{sysvar: 'NE Alarm Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'string neOuter = "outer"; dom.GetObject("NE Alarm").State(true); dom.GetObject("NE Alarm Out").State(neOuter);'}]}]
                });
                await set('NE Alarm Trigger', true);
                await until(() => value('NE Alarm Out'), 'outer');
                const inner = await value('NE Alarm In');
                inner.should.equal('inner');
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
                // (the program is executed in the second of the timer, its
                // destination script may however only run in the next one on
                // a slow system, e.g. the 32-bit platforms in real time with
                // parallel test files)
                await until(async () => ((await value('PC Daily')) === '' ? '' : 'executed'), 'executed', 15_000);
                const executed = await value('PC Daily');
                const seconds = hms => hms.split(':').reduce((sum, part) => (sum * 60) + Number(part), 0);
                const delay = (seconds(executed) - seconds(time.slice(11)) + 86_400) % 86_400;
                delay.should.be.within(0, 2, 'executed at ' + executed + ' instead of ' + time.slice(11));
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
            initTest({
                sim: false, faketime: location.start, rate: faketimeRate, normalOperation: true
            });

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

    describe('programs created via script with variables local to them', function () {
        // (ScriptVariableScope=local is ignored before ReGaHss R1.00.0388.0267)
        initTest({sim: false, config: {ScriptVariableScope: 'local'}, normalOperation: true});

        describe('variables of the scripts', function () {
            // (added in ReGaHss R1.00.0388.0267)
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0267');
            });

            // (by default the scripts of all programs share their variables, so
            // that a script can use a variable declared by another one, see
            // https://github.com/OpenCCU/OpenCCU/issues/84; with
            // ScriptVariableScope=local the variables of a script are local to it)
            it('should not let a script use a variable declared by another script', async function () {
                this.timeout(30_000);
                await createSysvars({'SL Define Trigger': 'bool', 'SL Use Trigger': 'bool', 'SL Out': 'string'});
                await createProgram({
                    name: 'SL Define',
                    rules: [{conditions: [[{sysvar: 'SL Define Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'string slShared = "defined"; dom.GetObject("SL Out").State(slShared);'}]}]
                });
                await createProgram({
                    name: 'SL Use',
                    rules: [{conditions: [[{sysvar: 'SL Use Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'dom.GetObject("SL Out").State(slShared # " used");'}]}]
                });
                const warnings = [];
                const untap = regaInstance().log.tap(line => {
                    if (/ uses variable\(s\) /.test(line)) {
                        warnings.push(line);
                    }
                });
                try {
                    await set('SL Define Trigger', true);
                    await until(() => value('SL Out'), 'defined');
                    const logged = regaInstance().waitFor(/script of program 'SL Use' \(ID \d+\) not executed due to a syntax error/, {buffered: false, timeout: 20_000});
                    await set('SL Use Trigger', true);
                    await logged;
                } finally {
                    untap();
                }

                const out = await value('SL Out');
                out.should.equal('defined');
                warnings.should.be.empty();
            });

            it('should share session variables between scripts', async function () {
                this.timeout(30_000);
                await createSysvars({'SL Set Trigger': 'bool', 'SL Get Trigger': 'bool', 'SL Session': 'string'});
                await createProgram({
                    name: 'SL Set',
                    rules: [{conditions: [[{sysvar: 'SL Set Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'system.SetSessionVar("slSession", "set"); dom.GetObject("SL Session").State("done");'}]}]
                });
                await createProgram({
                    name: 'SL Get',
                    rules: [{conditions: [[{sysvar: 'SL Get Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'dom.GetObject("SL Session").State(system.GetSessionVar("slSession") # " " # system.IsSessionVar("slSession") # " " # system.GetVar("slSession") # " " # system.IsVar("slSession"));'}]}]
                });
                await set('SL Set Trigger', true);
                await until(() => value('SL Session'), 'done');
                await set('SL Get Trigger', true);
                await until(() => value('SL Session'), 'set true set true');
            });

            // (the syntax check of the WebUI's script editor declared the
            // variables of the checked script for the scripts of all programs)
            it('should not declare the variables of a syntax check for other scripts', async function () {
                this.timeout(30_000);
                await createSysvars({'SL Check Trigger': 'bool', 'SL Check Out': 'string'});
                await createProgram({
                    name: 'SL Check',
                    rules: [{conditions: [[{sysvar: 'SL Check Trigger', value: true, trigger: 'update'}]], destinations: [{script: 'dom.GetObject("SL Check Out").State("checked " # slChecked);'}]}]
                });
                const check = await exec('Write(system.SyntaxCheck("string slChecked = \'value\';", "", "", ""));');
                check.should.equal('');
                const logged = regaInstance().waitFor(/script of program 'SL Check' \(ID \d+\) not executed due to a syntax error/, {buffered: false, timeout: 20_000});
                await set('SL Check Trigger', true);
                await logged;
                const out = await value('SL Check Out');
                out.should.equal('');
            });
        });

        cleanupTest();
    });

    // see https://github.com/OpenCCU/OpenCCU/issues/886
    describe('monthly time modules repeated every n months', function () {
        // fixed in ReGaHss R1.00.0388.0266
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0266');
        });

        initTest({sim: false, fixedTime: '2020-08-08 12:00:00 CEST', normalOperation: true});

        // (the day of the month of the reference time was compared with the
        // day of a later month of the repetition, so that a repetition was
        // skipped or the wrong day computed, e.g. 07.07.2021 instead of
        // 06.01.2021 for the 1st Wednesday of every 6th month from 01.07.2020)
        const cases = [
            // [begin, weekdays (0: day of the month), period (n-th weekday or day), repetition, expected Next()]
            ['2020-10-01', 4, 1, 6, '2020-10-07'],
            ['2020-08-01', 4, 1, 6, '2021-02-03'],
            ['2020-07-01', 4, 1, 6, '2021-01-06'],
            ['2020-06-01', 4, 1, 6, '2020-12-02'],
            ['2020-05-01', 4, 1, 6, '2020-11-04'],
            ['2020-04-01', 4, 1, 6, '2020-10-07'],
            ['2020-03-01', 4, 1, 6, '2020-09-02'],
            ['2020-02-01', 4, 1, 6, '2021-02-03'],
            ['2020-01-01', 4, 1, 6, '2021-01-06'],
            ['2019-09-01', 4, 1, 6, '2020-09-02'],
            ['2020-01-01', 1, 3, 2, '2020-09-21'],
            ['2020-07-15', 0, 15, 6, '2021-01-15'],
            ['2020-07-05', 0, 5, 6, '2021-01-05'],
            ['2020-03-20', 0, 20, 6, '2020-09-20'],
            ['2020-02-15', 0, 15, 6, '2020-08-15'],
            ['2020-02-05', 0, 5, 6, '2021-02-05'],
            ['2020-01-10', 0, 10, 3, '2020-10-10']
        ];

        describe('Next() of the time modules', function () {
            it('should return the next time of the repetition', async function () {
                this.timeout(30_000);
                let script = '';
                for (const [begin, weekdays, period, repetition] of cases) {
                    script += `
object tm = dom.CreateObject(OT_CALENDARDP, "Monthly ${begin} ${weekdays} ${period}");
tm.Enabled(false);
tm.TimerType(ttCalMonthly);
tm.Time("${begin} 08:00:00");
tm.Begin("${begin} 08:00:00");
tm.Weekdays(${weekdays});
tm.Period(${period});
tm.CalRepetitionValue(${repetition});
dom.GetObject(ID_CALENDARDPS).Add(tm);
WriteLine(tm.Next());
dom.GetObject(ID_CALENDARDPS).Remove(tm.ID());
dom.DeleteObject(tm.ID());
`;
                }

                const output = await exec(script);
                const lines = output.split('\r\n').slice(0, -1);
                lines.should.deepEqual(cases.map(testcase => testcase.at(-1) + ' 08:00:00'));
            });
        });

        cleanupTest();
    });

    // (a delay was converted to the time of day of today, which shifted a time
    // skipped by the change to daylight saving time by an hour: on that day a
    // delay of 2 hours was output (e.g. by the WebUI) as 1 hour and also saved
    // this way, see https://github.com/OpenCCU/OpenCCU/issues/584)
    const dstDelays = {7200: '02:00:00', 7260: '02:01:00', 10_740: '02:59:00'};
    const readDelays = () => exec(Object.keys(dstDelays).map(delay => `Write(dom.GetObject("PC DST ${delay}").Rule().RuleDestination().DestSingleDestination(0).DestinationValueParam().ToString().Substr(11, 8) # " ");`).join('\n'));

    describe('delays of programs on the day of the change to daylight saving time', function () {
        // fixed in ReGaHss R1.00.0388.0266
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0266');
        });

        initTest({sim: false, fixedTime: '2026-03-29 12:00:00 CEST', normalOperation: true});

        describe('delays of 2 hours', function () {
            it('should keep the delays', async function () {
                this.timeout(30_000);
                await createSysvars({'PC DST Trigger': 'bool', 'PC DST Out': 'string'});
                for (const delay of Object.keys(dstDelays)) {
                    await createProgram({
                        name: 'PC DST ' + delay,
                        rules: [{conditions: [[{sysvar: 'PC DST Trigger', value: true}]], destinations: [{sysvar: 'PC DST Out', value: 'done', delay: Number(delay)}]}]
                    });
                }

                const delays = await readDelays();
                // (saved before the check, so that the next test checks the saved delays anyway)
                await exec('system.Save();');
                delays.should.equal(Object.values(dstDelays).join(' ') + ' ');
            });
        });

        cleanupTest();
    });

    describe('delays of programs saved on the day of the change to daylight saving time', function () {
        // fixed in ReGaHss R1.00.0388.0266
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0266');
        });

        // (the homematic.regadom saved by the previous ReGaHss is kept)
        initTest({
            sim: false, fixedTime: '2026-03-30 12:00:00 CEST', nocopy: true, normalOperation: true
        });

        describe('delays of 2 hours after a restart on the next day', function () {
            it('should keep the delays', async function () {
                this.timeout(30_000);
                const delays = await readDelays();
                delays.should.equal(Object.values(dstDelays).join(' ') + ' ');
            });
        });

        cleanupTest();
    });

    // see https://github.com/OpenCCU/OpenCCU/issues/223
    // (all active programs were executed at the start of ReGaHss if their
    // conditions were met; with ExecuteOnStartup() this can be switched off
    // per program, which is the default for a new program)
    describe('programs executed at the start of ReGaHss', function () {
        // added in ReGaHss R1.00.0388.0267
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0267');
        });

        initTest({sim: false, normalOperation: true});

        // see https://github.com/OpenCCU/OpenCCU/issues/228
        // (an active program was also executed when it was activated, e.g.
        // a new program at its first save in the WebUI)
        describe('programs executed when they are activated', function () {
            it('should not execute a new program when it is activated', async function () {
                this.timeout(30_000);
                await createSysvars({'EA Flag': 'bool', 'EA Count New': 'number', 'EA Count On': 'number'});
                await setAndProcess('EA Flag', true);
                await createProgram({
                    name: 'EA New',
                    active: false,
                    rules: [{conditions: [[{sysvar: 'EA Flag', value: true, trigger: 'update'}]], destinations: [increment('EA Count New')]}]
                });
                await exec('dom.GetObject("EA New").Active(true);');
                await sleep(1000);
                const count = await value('EA Count New');
                count.should.equal('0.000000');
            });

            it('should not execute a program to be executed at the start when it is activated', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'EA On',
                    active: false,
                    rules: [{conditions: [[{sysvar: 'EA Flag', value: true, trigger: 'update'}]], destinations: [increment('EA Count On')]}]
                });
                await exec('object p = dom.GetObject("EA On"); p.ExecuteOnStartup(true); p.Active(true);');
                await sleep(1000);
                const count = await value('EA Count On');
                count.should.equal('0.000000');
            });

            it('should not execute an active program again when it is activated', async function () {
                this.timeout(30_000);
                await exec('dom.GetObject("EA On").Active(true);');
                await sleep(1000);
                const count = await value('EA Count On');
                count.should.equal('0.000000');
            });
        });

        describe('ExecuteOnStartup()', function () {
            it('should not execute a new program at the start by default', async function () {
                const output = await exec(`
object p = dom.CreateObject(OT_PROGRAM);
Write(p.ExecuteOnStartup());
p.ExecuteOnStartup(true);
Write(" " # p.ExecuteOnStartup());
dom.DeleteObject(p.ID());
                `);
                output.should.equal('false true');
            });

            // (programs saved by an earlier version are executed at the start as before)
            it('should execute a program of an earlier version at the start', async function () {
                const output = await exec('Write(dom.GetObject("Bool1OnFalse").ExecuteOnStartup());');
                output.should.equal('true');
            });

            it('should create the programs to be checked after a restart', async function () {
                this.timeout(30_000);
                await createSysvars({
                    'ES Trigger': 'bool', 'ES Count On': 'number', 'ES Count Off': 'number'
                });
                for (const name of ['On', 'Off']) {
                    await createProgram({
                        name: 'ES ' + name,
                        rules: [{conditions: [[{sysvar: 'ES Trigger', value: true, trigger: 'update'}]], destinations: [increment('ES Count ' + name)]}]
                    });
                }

                const output = await exec(`
dom.GetObject("ES On").ExecuteOnStartup(true);
dom.GetObject("ES Trigger").State(true);
Write(dom.GetObject("ES On").ExecuteOnStartup() # " " # dom.GetObject("ES Off").ExecuteOnStartup());
                `);
                output.should.equal('true false');
                // (the programs may have been executed by the change of the trigger)
                await sleep(1000);
                await set('ES Count On', 0);
                await set('ES Count Off', 0);
                await exec('system.Save();');
            });
        });

        // (State(true) of a program called by a script did not evaluate the
        // program: without a trigger data point "true" was not taken as a
        // boolean, see https://github.com/OpenCCU/OpenCCU/issues/228)
        describe('State() of a program', function () {
            it('should evaluate a program and execute it with State(true)', async function () {
                this.timeout(30_000);
                await createSysvars({'ST Flag': 'bool', 'ST Count': 'number'});
                await setAndProcess('ST Flag', true);
                await createProgram({
                    name: 'ST Prg',
                    rules: [{conditions: [[{sysvar: 'ST Flag', value: true, trigger: 'update'}]], destinations: [increment('ST Count')]}]
                });
                const output = await exec('Write(dom.GetObject("ST Prg").State(true));');
                output.should.equal('true');
                await until(() => value('ST Count'), '1.000000');
            });

            it('should evaluate a program and execute it with State(false)', async function () {
                this.timeout(30_000);
                const output = await exec('Write(dom.GetObject("ST Prg").State(false));');
                output.should.equal('true');
                await until(() => value('ST Count'), '2.000000');
            });

            it('should not execute a program with conditions not met with State(true)', async function () {
                this.timeout(30_000);
                await set('ST Flag', false);
                const output = await exec('Write(dom.GetObject("ST Prg").State(true));');
                output.should.equal('false');
                await sleep(1000);
                const count = await value('ST Count');
                count.should.equal('2.000000');
            });
        });

        // https://github.com/OpenCCU/OpenCCU/issues/4791: an inactive program
        // with a time module triggered by a system variable of its conditions
        // set the modified flag of the DOM at each trigger, so that the DOM was
        // saved again and again; the activation of a program without a time
        // module did not set it
        describe('modified flag of the DOM', function () {
            // fixed in ReGaHss R1.00.0388.0270
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0270');
            });

            const modified = () => exec('Write(dom.IsDOMModified());');
            const saved = async () => {
                await exec('system.Save();');
                const output = await modified();
                output.should.equal('false');
            };

            it('should not set the modified flag when an inactive program with a time module is triggered', async function () {
                this.timeout(30_000);
                await createSysvars({'MF Flag': 'bool', 'MF Count': 'number'});
                const timer = await exec(timerScript({name: 'MF Timer Inactive', type: 'daily', time: '2007-01-01 07:30:00'}));
                await createProgram({
                    name: 'MF Inactive',
                    active: false,
                    rules: [{conditions: [[{timer: Number(timer), trigger: 'check'}, {sysvar: 'MF Flag', value: true, trigger: 'change'}]], destinations: [increment('MF Count')]}]
                });
                // (the time module created for the inactive program is enabled
                // until the program is triggered the first time, which disables
                // it: a modification of the time module)
                await setAndSettle('MF Flag', true);
                await setAndSettle('MF Flag', false);
                await saved();
                for (const flag of [true, false, true]) {
                    await set('MF Flag', flag);
                }

                await sleep(1000);
                const output = await modified();
                output.should.equal('false');
                const count = await value('MF Count');
                count.should.equal('0.000000');
            });

            it('should set the modified flag when a program with a time module is deactivated', async function () {
                this.timeout(30_000);
                const timer = await exec(timerScript({name: 'MF Timer Active', type: 'daily', time: '2007-01-01 07:30:00'}));
                await createProgram({
                    name: 'MF Active',
                    rules: [{conditions: [[{timer: Number(timer), trigger: 'check'}, {sysvar: 'MF Flag', value: true, trigger: 'change'}]], destinations: [increment('MF Count')]}]
                });
                await saved();
                await exec('dom.GetObject("MF Active").Active(false);');
                const output = await modified();
                output.should.equal('true');
            });

            it('should set the modified flag when a program without a time module is activated or deactivated', async function () {
                this.timeout(30_000);
                await createProgram({
                    name: 'MF Plain',
                    rules: [{conditions: [[{sysvar: 'MF Flag', value: true, trigger: 'change'}]], destinations: [increment('MF Count')]}]
                });
                const results = [];
                for (const active of [false, false, true, true]) {
                    await saved();
                    await exec(`dom.GetObject("MF Plain").Active(${active});`);
                    results.push(await modified());
                }

                // (only a change of the active state is a modification)
                results.should.deepEqual(['true', 'false', 'true', 'false']);
            });
        });

        // https://github.com/OpenCCU/OpenCCU/issues/4800: a condition "on
        // change" only triggers the program if its result changes. As a
        // program is not executed any more when it is activated or (without
        // ExecuteOnStartup()) at the start of ReGaHss, its conditions did not
        // know their result before the first trigger, which was taken as a
        // change: e.g. a program "less than 10" was executed when its
        // variable was changed from 8 to 9
        describe('conditions "on change" at the first trigger', function () {
            // fixed in ReGaHss R1.00.0388.0272
            before(function () {
                requireRegaVersion(this, onChangeFixVersion);
            });

            it('should not execute a new program if the result of its condition does not change', async function () {
                this.timeout(30_000);
                await createOnChangeProgram('FT New', 8);
                await setAndSettle('FT New', 9);
                await sleep(1000);
                (await onChangeCounts('FT New')).should.equal('0 0');
            });

            it('should execute the new program when the result of its condition changes', async function () {
                this.timeout(30_000);
                await set('FT New', 12);
                await until(() => onChangeCounts('FT New'), '0 1');
                await set('FT New', 7);
                await until(() => onChangeCounts('FT New'), '1 1');
                await setAndSettle('FT New', 8);
                await sleep(1000);
                (await onChangeCounts('FT New')).should.equal('1 1');
            });

            it('should not execute the "else" activity of a new program if the result does not change', async function () {
                this.timeout(30_000);
                await createOnChangeProgram('FT Else', 12);
                await setAndSettle('FT Else', 13);
                await sleep(1000);
                (await onChangeCounts('FT Else')).should.equal('0 0');
                await set('FT Else', 7);
                await until(() => onChangeCounts('FT Else'), '1 0');
            });

            // (the result of the condition before the program was deactivated
            // is not compared with the one after its activation)
            it('should not execute an activated program if the result of its condition does not change', async function () {
                this.timeout(30_000);
                await createOnChangeProgram('FT Act', 12);
                await exec('dom.GetObject("FT Act Prg").Active(false);');
                await setAndSettle('FT Act', 7);
                await exec('dom.GetObject("FT Act Prg").Active(true);');
                await setAndSettle('FT Act', 8);
                await sleep(1000);
                (await onChangeCounts('FT Act')).should.equal('0 0');
                await set('FT Act', 12);
                await until(() => onChangeCounts('FT Act'), '0 1');
            });

            // (a program is edited in the WebUI as a copy, which is copied back
            // when it is saved, see RestoreProgram() in /www/rega/esp/programs.fn)
            it('should not execute a program with a condition added to it if the result does not change', async function () {
                this.timeout(30_000);
                await createOnChangeProgram('FT Edit', 8);
                const output = await exec(`
object oOrig = dom.GetObject("FT Edit Prg");
object oCopy = oOrig.ProgramCopyTo();
oCopy.ProgramCopyID(oOrig.ID());
object sc = oCopy.Rule().RuleCondition(0).CndAddSingle();
sc.OperatorType(2);
sc.LeftValType(ivtSystemId);
sc.LeftVal(dom.GetObject("FT Edit").ID());
sc.ConditionType(${compareTypes['<']});
sc.RightVal1ValType(ivtFloat);
sc.RightVal1(5);
sc.ConditionType2(${triggers.change});
boolean isActive = oOrig.Active();
oCopy.ProgramCopyTo(oOrig.ID());
dom.DeleteObject(oCopy.ID());
oOrig.ProgramCopyID(ID_ERROR);
oOrig.ProgramUpdate();
oOrig.Active(isActive);
Write(oOrig.Rule().RuleCondition(0).CndSingleCount());
                `);
                output.should.equal('2');
                await setAndSettle('FT Edit', 9);
                await sleep(1000);
                (await onChangeCounts('FT Edit')).should.equal('0 0');
                await set('FT Edit', 12);
                await until(() => onChangeCounts('FT Edit'), '0 1');
            });

            it('should create the programs to be checked after a restart', async function () {
                this.timeout(30_000);
                await createOnChangeProgram('FR Low', 8);
                await createOnChangeProgram('FR High', 12);
                const output = await exec(`
Write(dom.GetObject("FR Low Prg").ExecuteOnStartup() # " " # dom.GetObject("FR High Prg").ExecuteOnStartup());
system.Save();
                `);
                output.should.equal('false false');
            });
        });

        // https://github.com/OpenCCU/OpenCCU/issues/4775: fields which are
        // invalid for the data point or system variable of a condition or
        // destination (e.g. left by editing a program in an earlier version)
        // are reported at the start of ReGaHss (not corrected)
        describe('programs with invalid fields', function () {
            it('should create the programs to be checked after a restart', async function () {
                // added in ReGaHss R1.00.0388.0270
                requireRegaVersion(this, 'R1.00.0388.0270');
                this.timeout(30_000);
                await createSysvars({'IW Bool': 'bool', 'IW Enum': 'number'});
                await exec(`
object sv = dom.GetObject("IW Enum");
sv.ValueType(ivtInteger); sv.ValueSubType(istEnum); sv.ValueList("x;y;z"); sv.State(0);
                `);
                for (const name of ['IW Invalid', 'IW Valid']) {
                    await createProgram({
                        name,
                        rules: [{conditions: [[{sysvar: 'IW Bool', value: true, trigger: 'change'}]], destinations: [{sysvar: 'IW Enum', value: 1}]}]
                    });
                }

                // ("greater than" for a logic value, the index 4 of a value list
                // with 3 entries; the setters of these fields do not correct them)
                await exec(`
object r = dom.GetObject("IW Invalid").Rule();
r.RuleCondition(0).CndSingleCondition(0).ConditionType(8);
r.RuleDestination().DestSingleDestination(0).DestinationValue(4);
system.Save();
                `);
            });
        });

        cleanupTest();
    });

    describe('programs executed at a restart of ReGaHss', function () {
        // added in ReGaHss R1.00.0388.0267
        before(function () {
            requireRegaVersion(this, 'R1.00.0388.0267');
        });

        // (the homematic.regadom saved by the previous ReGaHss is kept)
        initTest({sim: false, nocopy: true, normalOperation: true});

        describe('programs with invalid fields after a restart', function () {
            it('should warn about the invalid fields of a program', async function () {
                // added in ReGaHss R1.00.0388.0270
                requireRegaVersion(this, 'R1.00.0388.0270');
                await waitForRega(/program \d+ 'IW Invalid', if, condition 1\.1: invalid ConditionType=8 /, {timeout: 5000});
                await waitForRega(/program \d+ 'IW Invalid', if, activity 1: invalid DestinationValue=4 /, {timeout: 5000});
            });

            it('should not warn about a program with valid fields', async function () {
                // added in ReGaHss R1.00.0388.0270
                requireRegaVersion(this, 'R1.00.0388.0270');
                let warned = true;
                await waitForRega(/'IW Valid'.*: invalid/, {timeout: 1000}).catch(() => {
                    warned = false;
                });
                warned.should.be.false();
            });
        });

        describe('ExecuteOnStartup() after a restart', function () {
            it('should keep the setting', async function () {
                const output = await exec('Write(dom.GetObject("ES On").ExecuteOnStartup() # " " # dom.GetObject("ES Off").ExecuteOnStartup());');
                output.should.equal('true false');
            });

            it('should execute only the program to be executed at the start', async function () {
                this.timeout(30_000);
                await until(() => value('ES Count On'), '1.000000');
                // (the programs are executed at the start before the normal operation)
                const off = await value('ES Count Off');
                off.should.equal('0.000000');
            });

            it('should execute the program not executed at the start at its next trigger', async function () {
                this.timeout(30_000);
                await set('ES Trigger', true);
                await until(() => value('ES Count Off'), '1.000000');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/4800
        describe('conditions "on change" at the first trigger after a restart', function () {
            // fixed in ReGaHss R1.00.0388.0272
            before(function () {
                requireRegaVersion(this, onChangeFixVersion);
            });

            it('should not execute a program if its variable is updated with the same value', async function () {
                this.timeout(30_000);
                await setAndSettle('FR Low', 8);
                await sleep(1000);
                (await onChangeCounts('FR Low')).should.equal('0 0');
            });

            it('should not execute the program if the result of its condition does not change', async function () {
                this.timeout(30_000);
                await setAndSettle('FR Low', 9);
                await sleep(1000);
                (await onChangeCounts('FR Low')).should.equal('0 0');
            });

            it('should execute the program when the result of its condition changes', async function () {
                this.timeout(30_000);
                await set('FR Low', 12);
                await until(() => onChangeCounts('FR Low'), '0 1');
                await set('FR Low', 7);
                await until(() => onChangeCounts('FR Low'), '1 1');
            });

            it('should not execute the "else" activity of a program if the result does not change', async function () {
                this.timeout(30_000);
                await setAndSettle('FR High', 12);
                await setAndSettle('FR High', 13);
                await sleep(1000);
                (await onChangeCounts('FR High')).should.equal('0 0');
                await set('FR High', 7);
                await until(() => onChangeCounts('FR High'), '1 0');
            });
        });

        cleanupTest();
    });
});
