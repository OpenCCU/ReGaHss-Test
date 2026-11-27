/* global describe, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests the methods moving the parts of a program within the program:
// rule.RuleMoveCondition(), condition.CndMoveSingle() and
// destination.DestMoveSingle(). Before, the parts could only be moved by
// removing their IDs from the ID array of their parent and adding them to the
// one of another parent, which left their parent (ConditionParent(),
// CndParent(), DestinationParent()) unchanged, so that the WebUI edited the
// wrong condition or destination.
// see https://github.com/OpenCCU/OpenCCU/issues/1081

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

// destination script incrementing a counter (number system variable)
const increment = name => ({script: `object c = dom.GetObject("${name}"); c.State(c.Value() + 1);`});

/**
 * Returns a script writing the structure of a program, e.g.
 * "R0:[A,B,][C,]{Then1,}|R1:{Else,}|": for each rule its conditions with the
 * system variables of their single conditions (without "MV ") and its single
 * destinations with the counters they increment. A "!" marks a part whose
 * parent or program does not match its place in the program.
 *
 * @param {string} program - script expression of the program object
 * @returns {string} the script
 */
function structureScript(program) {
    return `
object prg = ${program};
object r = prg.Rule();
object c;
object sc;
object d;
object sd;
string cid;
string sid;
integer n = 0;
string s = "";
while (r) {
  s = s # "R" # n # ":";
  if (r.RuleProgramID() != prg.ID()) { s = s # "!"; }
  foreach (cid, r.RuleConditions().EnumIDs()) {
    c = dom.GetObject(cid);
    if (c.CndParent() != r.ID()) { s = s # "!"; }
    s = s # "[";
    foreach (sid, c.CndSingleConditions().EnumIDs()) {
      sc = dom.GetObject(sid);
      if (sc.ConditionParent() != c.ID()) { s = s # "!"; }
      s = s # dom.GetObject(sc.LeftVal()).Name().Substr(3) # ",";
    }
    s = s # "]";
  }
  d = r.RuleDestination();
  if (d.DstParent() != r.ID()) { s = s # "!"; }
  s = s # "{";
  foreach (sid, d.DestSingleDestinations().EnumIDs()) {
    sd = dom.GetObject(sid);
    if ((sd.DestinationParent() != d.ID()) || (sd.DestinationProgram() != prg.ID())) { s = s # "!"; }
    s = s # sd.DestinationValue().StringBetween("GetObject(\\"MV ", "\\")") # ",";
  }
  s = s # "}|";
  r = r.RuleSubRule();
  n = n + 1;
}
Write(s);
`;
}

// parts of the program "MV Struct" (as script expressions)
const struct = 'dom.GetObject("MV Struct")';
const rule = index => `${struct}.Rule()${'.RuleSubRule()'.repeat(index)}`;
const condition = (ruleIndex, index) => `${rule(ruleIndex)}.RuleCondition(${index})`;
const single = (ruleIndex, cndIndex, index) => `${condition(ruleIndex, cndIndex)}.CndSingleCondition(${index})`;
const destination = ruleIndex => `${rule(ruleIndex)}.RuleDestination()`;
const singleDestination = (ruleIndex, index) => `${destination(ruleIndex)}.DestSingleDestination(${index})`;

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    let instance = null;

    const exec = async script => (await instance.exec(script)).output;
    const structure = (program = struct) => exec(structureScript(program));
    const value = async name => exec(`Write(dom.GetObject("${name}").Value());`);
    const set = (name, newValue) => exec(`dom.GetObject("${name}").State(${newValue});`);

    // waits until a counter has the expected value
    const until = async (name, expected) => {
        const deadline = Date.now() + 10_000;
        let actual = await value(name);
        while (actual !== expected && Date.now() < deadline) {
            await sleep(100);
            actual = await value(name);
        }

        actual.should.equal(expected, name);
    };

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
            instance = new ReGaInstance({name: 'program-move'});
            await start();
        });

        step('should create the programs', async function () {
            this.timeout(30_000);
            await exec(`
object list = dom.GetObject(ID_SYSTEM_VARIABLES);
object sv;
string name;
foreach (name, "MV A\\tMV B\\tMV C\\tMV D\\tMV X") {
  sv = dom.CreateObject(OT_VARDP, name);
  list.Add(sv.ID());
  sv.ValueType(ivtBinary);
  sv.ValueSubType(istBool);
  sv.State(false);
}
foreach (name, "MV Then1\\tMV Then2\\tMV ElseIf\\tMV Else\\tMV Other") {
  sv = dom.CreateObject(OT_VARDP, name);
  list.Add(sv.ID());
  sv.ValueType(ivtFloat);
  sv.ValueSubType(istGeneric);
  sv.ValueMin(0);
  sv.ValueMax(1000);
  sv.State(0);
}
dom.RTUpdate(0);
`);
            // (inactive: only its structure is tested)
            const ids = [await exec(programScript({
                name: 'MV Struct',
                active: false,
                rules: [
                    {
                        conditions: [
                            [{sysvar: 'MV A', value: true, trigger: 'update'}, {sysvar: 'MV B', value: true, trigger: 'update'}],
                            [{sysvar: 'MV C', value: true, trigger: 'update'}]
                        ],
                        destinations: [increment('MV Then1'), increment('MV Then2')]
                    },
                    {conditions: [[{sysvar: 'MV D', value: true, trigger: 'update'}]], destinations: [increment('MV ElseIf')]},
                    {destinations: [increment('MV Else')]}
                ]
            })), await exec(programScript({
                name: 'MV Second',
                active: false,
                rules: [{conditions: [[{sysvar: 'MV X', value: true, trigger: 'update'}]], destinations: [increment('MV Other')]}]
            }))];
            for (const id of ids) {
                Number(id).should.be.above(0, 'program not created: ' + id);
            }

            (await structure()).should.equal('R0:[A,B,][C,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });
    });

    describe('CndMoveSingle()', function () {
        step('should move a single condition to another condition of the rule', async function () {
            this.timeout(30_000);
            (await exec(`Write(${condition(0, 1)}.CndMoveSingle(${single(0, 0, 1)}));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][C,B,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });

        step('should move a single condition to a condition of another rule (by its ID)', async function () {
            this.timeout(30_000);
            (await exec(`Write(${condition(0, 0)}.CndMoveSingle(${single(1, 0, 0)}.ID()));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,D,][C,B,]{Then1,Then2,}|R1:[]{ElseIf,}|R2:{Else,}|');
        });

        step('should move a single condition back (by its ID as string)', async function () {
            this.timeout(30_000);
            (await exec(`Write(${condition(1, 0)}.CndMoveSingle(${single(0, 0, 1)}.ID().ToString()));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][C,B,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });

        step('should move a single condition to the end of its own condition', async function () {
            this.timeout(30_000);
            (await exec(`Write(${condition(0, 1)}.CndMoveSingle(${single(0, 1, 0)}));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][B,C,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });

        step('should keep the ID and the settings of the single condition', async function () {
            this.timeout(30_000);
            const before = await exec(`object sc = ${single(0, 1, 0)}; Write(sc.ID() # "|" # sc.LeftVal() # "|" # sc.ConditionType() # "|" # sc.ConditionType2() # "|" # sc.RightVal1());`);
            (await exec(`Write(${condition(0, 0)}.CndMoveSingle(${single(0, 1, 0)}));`)).should.equal('true');
            (await exec(`object sc = ${single(0, 0, 1)}; Write(sc.ID() # "|" # sc.LeftVal() # "|" # sc.ConditionType() # "|" # sc.ConditionType2() # "|" # sc.RightVal1());`)).should.equal(before);
            (await exec(`Write(${condition(0, 1)}.CndMoveSingle(${single(0, 0, 1)}));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][C,B,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });
    });

    describe('RuleMoveCondition()', function () {
        step('should move a condition to another rule', async function () {
            this.timeout(30_000);
            (await exec(`Write(${rule(1)}.RuleMoveCondition(${condition(0, 1)}));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,]{Then1,Then2,}|R1:[D,][C,B,]{ElseIf,}|R2:{Else,}|');
        });

        step('should move a condition to the end of its own rule (by its ID)', async function () {
            this.timeout(30_000);
            (await exec(`Write(${rule(1)}.RuleMoveCondition(${condition(1, 0)}.ID()));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,]{Then1,Then2,}|R1:[C,B,][D,]{ElseIf,}|R2:{Else,}|');
        });

        step('should move a condition back', async function () {
            this.timeout(30_000);
            (await exec(`Write(${rule(0)}.RuleMoveCondition(${condition(1, 0)}));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][C,B,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });
    });

    describe('DestMoveSingle()', function () {
        step('should move a single destination to the destination of another rule', async function () {
            this.timeout(30_000);
            (await exec(`Write(${destination(2)}.DestMoveSingle(${singleDestination(0, 0)}));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][C,B,]{Then2,}|R1:[D,]{ElseIf,}|R2:{Else,Then1,}|');
        });

        step('should move a single destination to the end of its own destination', async function () {
            this.timeout(30_000);
            (await exec(`Write(${destination(2)}.DestMoveSingle(${singleDestination(2, 0)}.ID()));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][C,B,]{Then2,}|R1:[D,]{ElseIf,}|R2:{Then1,Else,}|');
        });

        step('should move a single destination back', async function () {
            this.timeout(30_000);
            (await exec(`Write(${destination(0)}.DestMoveSingle(${singleDestination(2, 0)}));`)).should.equal('true');
            (await structure()).should.equal('R0:[A,][C,B,]{Then2,Then1,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });
    });

    describe('errors', function () {
        step('should not move a part of another program and log a warning', async function () {
            this.timeout(30_000);
            const other = 'dom.GetObject("MV Second").Rule()';
            for (const [script, method] of [
                [`${condition(0, 0)}.CndMoveSingle(${other}.RuleCondition(0).CndSingleCondition(0))`, 'CndMoveSingle'],
                [`${rule(0)}.RuleMoveCondition(${other}.RuleCondition(0))`, 'RuleMoveCondition'],
                [`${destination(0)}.DestMoveSingle(${other}.RuleDestination().DestSingleDestination(0))`, 'DestMoveSingle']
            ]) {
                const logged = instance.waitFor(new RegExp(`WARNING: ${method}\\(\\): .* is in another program`), {buffered: false, timeout: 10_000});
                (await exec(`Write(${script});`)).should.equal('false', method);
                await logged;
            }

            (await structure()).should.equal('R0:[A,][C,B,]{Then2,Then1,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
            (await structure('dom.GetObject("MV Second")')).should.equal('R0:[X,]{Other,}|');
        });

        step('should not move an object of another type or an unknown object', async function () {
            this.timeout(30_000);
            for (const [script, method, message] of [
                [`${condition(0, 0)}.CndMoveSingle(${condition(0, 1)})`, 'CndMoveSingle', 'is no single condition'],
                [`${condition(0, 0)}.CndMoveSingle(999999)`, 'CndMoveSingle', 'is no single condition'],
                [`${condition(0, 0)}.CndMoveSingle("x")`, 'CndMoveSingle', 'is no single condition'],
                [`${rule(0)}.RuleMoveCondition(${single(0, 0, 0)})`, 'RuleMoveCondition', 'is no condition'],
                [`${rule(0)}.RuleMoveCondition(dom.GetObject("MV A"))`, 'RuleMoveCondition', 'is no condition'],
                [`${destination(0)}.DestMoveSingle(${destination(1)})`, 'DestMoveSingle', 'is no single destination']
            ]) {
                const logged = instance.waitFor(new RegExp(`WARNING: ${method}\\(\\): .* ${message}`), {buffered: false, timeout: 10_000});
                (await exec(`Write(${script});`)).should.equal('false', script);
                await logged;
            }

            (await structure()).should.equal('R0:[A,][C,B,]{Then2,Then1,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });

        step('should not move a part which is in no parent', async function () {
            this.timeout(30_000);
            // (a single condition removed from the ID array of its condition)
            const logged = instance.waitFor(/WARNING: CndMoveSingle\(\): single condition \d+ is in no condition/, {buffered: false, timeout: 10_000});
            (await exec(`object c = ${condition(0, 1)}; object sc = c.CndSingleCondition(1); c.CndSingleConditions().Remove(sc); Write(${condition(0, 0)}.CndMoveSingle(sc) # "|" # c.CndSingleConditions().Add(sc));`)).should.equal('false|true');
            await logged;
            (await structure()).should.equal('R0:[A,][C,B,]{Then2,Then1,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });
    });

    describe('the copy of the WebUI', function () {
        step('should move the parts in the copy of a program and copy them back', async function () {
            this.timeout(30_000);
            // (like the WebUI: the program is edited in a copy, which is copied
            // back to the program when it is saved)
            const copyId = await exec(`object copy = ${struct}.ProgramCopyTo(); Write(copy.ID());`);
            Number(copyId).should.be.above(0);
            const copy = `dom.GetObject(${copyId})`;
            (await structure(copy)).should.equal('R0:[A,][C,B,]{Then2,Then1,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
            // (the parts of the copy are not moved to the program and vice versa)
            (await exec(`Write(${copy}.Rule().RuleCondition(0).CndMoveSingle(${single(0, 1, 0)}) # "|" # ${condition(0, 0)}.CndMoveSingle(${copy}.Rule().RuleCondition(1).CndSingleCondition(0)));`)).should.equal('false|false');
            (await exec(`
object r = ${copy}.Rule();
Write(r.RuleCondition(0).CndMoveSingle(r.RuleCondition(1).CndSingleCondition(1)));
Write(r.RuleDestination().DestMoveSingle(r.RuleDestination().DestSingleDestination(0)));
`)).should.equal('truetrue');
            (await structure(copy)).should.equal('R0:[A,B,][C,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
            (await structure()).should.equal('R0:[A,][C,B,]{Then2,Then1,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
            await exec(`object copy = ${copy}; object orig = ${struct}; copy.ProgramCopyTo(orig.ID()); dom.DeleteObject(copy.ID()); orig.ProgramCopyID(ID_ERROR); orig.ProgramUpdate();`);
            (await structure()).should.equal('R0:[A,B,][C,]{Then1,Then2,}|R1:[D,]{ElseIf,}|R2:{Else,}|');
        });
    });

    describe('saved DOM', function () {
        step('should keep the moved parts after a restart', async function () {
            this.timeout(60_000);
            (await exec(`Write(${condition(0, 1)}.CndMoveSingle(${single(0, 0, 0)}) # ${destination(1)}.DestMoveSingle(${singleDestination(0, 1)}));`)).should.equal('truetrue');
            const moved = 'R0:[B,][C,A,]{Then1,}|R1:[D,]{ElseIf,Then2,}|R2:{Else,}|';
            (await structure()).should.equal(moved);
            await exec('system.Save();');
            await instance.stop();
            instance.copyRegadom = false;
            await start();
            (await structure()).should.equal(moved);
        });
    });

    describe('execution of the program', function () {
        step('should execute the program with its moved parts', async function () {
            this.timeout(60_000);
            // "if B or (C and A), then Then1; else if D, then ElseIf and Then2;
            // else Else", with the triggers of the moved parts
            await exec(`object prg = ${struct}; prg.Active(true); prg.ProgramUpdate();`);
            await sleep(500);
            const counters = ['MV Then1', 'MV Then2', 'MV ElseIf', 'MV Else'];
            const reset = async () => {
                for (const name of counters) {
                    await set(name, 0);
                }
            };

            const counts = async () => {
                const result = [];
                for (const name of counters) {
                    result.push(Number(await value(name)));
                }

                return result.join(' ');
            };

            // (each update of a trigger executes the program: "else" while
            // its conditions are not met)
            await reset();
            await set('MV C', true);
            await until('MV Else', '1.000000');
            // (moved: A is a trigger of the second condition)
            await set('MV A', true);
            await until('MV Then1', '1.000000');
            await sleep(500);
            (await counts()).should.equal('1 0 0 1');

            await set('MV A', false);
            await until('MV Else', '2.000000');
            await reset();
            await set('MV D', true);
            await until('MV ElseIf', '1.000000');
            await sleep(500);
            // (moved: Then2 is executed with ElseIf)
            (await counts()).should.equal('0 1 1 0');
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
