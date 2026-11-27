/* global describe, it, before */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests the access to the entries of value lists (system variables of type
// integer with subtype enum): ValueName() returns the entry of the current
// value (before: empty, only logic values had a name), ValueName(index) the
// entry of an index, ValueIndex(name) the index of an entry, and State()
// sets a value list to the entry of a text (before: not set); an index
// outside of the value list is still set, but logged as warning.
// see https://github.com/OpenCCU/OpenCCU/issues/440

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    waitForRega,
    requireRegaVersion
} = require('../lib/helper.js');

require('should');

/**
 * Returns a ReGa literal for a string or a number.
 *
 * @param {string|number} value - value of the literal
 * @returns {string} the literal
 */
function regaLiteral(value) {
    if (typeof value === 'number') {
        return String(value);
    }

    return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
}

/**
 * Executes a script and returns its output.
 *
 * @param {string} script - script to execute
 * @returns {Promise<string>} the output
 */
async function exec(script) {
    return (await rega.exec(script)).output;
}

/**
 * Creates a system variable (or changes it, if it exists).
 *
 * @param {string} name - name of the system variable
 * @param {string} type - ValueType and ValueSubType, e.g. 'ivtInteger, istEnum'
 * @param {string} properties - script setting further properties of sv
 */
async function createSysvar(name, type, properties) {
    const [valueType, subtype] = type.split(', ');
    await exec(`
object sv = dom.GetObject(ID_SYSTEM_VARIABLES).Get(${regaLiteral(name)});
if (!sv) {
  sv = dom.CreateObject(OT_VARDP, ${regaLiteral(name)});
  dom.GetObject(ID_SYSTEM_VARIABLES).Add(sv.ID());
}
sv.ValueType(${valueType});
sv.ValueSubType(${subtype});
${properties}
dom.RTUpdate(0);
`);
}

/**
 * Returns a script expression for the system variable.
 *
 * @param {string} name - name of the system variable
 * @returns {string} the expression
 */
const sysvar = name => `dom.GetObject(ID_SYSTEM_VARIABLES).Get(${regaLiteral(name)})`;

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest(false);

    // added in ReGaHss R1.00.0388.0273
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0273');
    });

    describe('init', function () {
        it('should create the system variables', async function () {
            this.timeout(30_000);
            await createSysvar('VL Mode', 'ivtInteger, istEnum', 'sv.ValueList("Aus;An;Urlaub"); sv.State(0);');
            await createSysvar('VL Gaps', 'ivtInteger, istEnum', 'sv.ValueList("a;;c;"); sv.State(0);');
            await createSysvar('VL Numbers', 'ivtInteger, istEnum', 'sv.ValueList("5;10;20;x y;Ä°C"); sv.State(0);');
            await createSysvar('VL Empty', 'ivtInteger, istEnum', 'sv.ValueList(""); sv.State(0);');
            await createSysvar('VL Bool', 'ivtBinary, istBool', 'sv.ValueName0("zu"); sv.ValueName1("offen"); sv.State(false);');
            await createSysvar('VL Number', 'ivtFloat, istGeneric', 'sv.ValueMin(0); sv.ValueMax(100); sv.State(2);');
            await createSysvar('VL String', 'ivtString, istChar8859', 'sv.State("Urlaub");');
            (await exec(`Write(${sysvar('VL Mode')}.ValueList() # "|" # ${sysvar('VL Gaps')}.ValueList());`)).should.equal('Aus;An;Urlaub|a;;c;');
        });
    });

    describe('ValueName()', function () {
        it('should return the entry of the current value of a value list', async function () {
            this.timeout(30_000);
            const names = [];
            for (let index = 0; index < 3; index++) {
                names.push(await exec(`object sv = ${sysvar('VL Mode')}; sv.State(${index}); Write(sv.Value() # "=" # sv.ValueName());`));
            }

            names.should.eql(['0=Aus', '1=An', '2=Urlaub']);
            (await exec(`object sv = ${sysvar('VL Mode')}; Write(sv.ValueName() == sv.ValueList().StrValueByIndex(";", sv.Value()));`)).should.equal('true');
        });

        it('should return an empty entry of a value list', async function () {
            this.timeout(30_000);
            const names = [];
            for (let index = 0; index < 4; index++) {
                names.push(await exec(`object sv = ${sysvar('VL Gaps')}; sv.State(${index}); Write("[" # sv.ValueName() # "]");`));
            }

            names.should.eql(['[a]', '[]', '[c]', '[]']);
        });

        it('should return an empty string for a value outside of the value list', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Mode')}; sv.State(3); Write("[" # sv.ValueName() # "]"); sv.State(-1); Write("[" # sv.ValueName() # "]"); sv.State(0);`)).should.equal('[][]');
            (await exec(`Write("[" # ${sysvar('VL Empty')}.ValueName() # "]");`)).should.equal('[]');
        });

        it('should return the name of a logic value as before', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Bool')}; sv.State(false); Write(sv.ValueName() # "|"); sv.State(true); Write(sv.ValueName() # "|" # sv.ValueName0() # "|" # sv.ValueName1());`)).should.equal('zu|offen|zu|offen');
        });

        it('should return an empty string for other system variables as before', async function () {
            this.timeout(30_000);
            (await exec(`Write("[" # ${sysvar('VL Number')}.ValueName() # "|" # ${sysvar('VL String')}.ValueName() # "]");`)).should.equal('[|]');
        });
    });

    describe('ValueName(index)', function () {
        const cases = [
            ['VL Mode', 0, 'Aus'],
            ['VL Mode', 1, 'An'],
            ['VL Mode', 2, 'Urlaub'],
            ['VL Mode', 3, ''],
            ['VL Mode', 100, ''],
            ['VL Mode', -1, ''],
            ['VL Gaps', 0, 'a'],
            ['VL Gaps', 1, ''],
            ['VL Gaps', 2, 'c'],
            ['VL Gaps', 3, ''],
            ['VL Gaps', 4, ''],
            ['VL Numbers', 3, 'x y'],
            ['VL Numbers', 4, 'Ä°C'],
            ['VL Empty', 0, ''],
            ['VL Bool', 0, ''],
            ['VL String', 0, '']
        ];
        for (const [name, index, expected] of cases) {
            it(`should return ${JSON.stringify(expected)} for the index ${index} of ${name}`, async function () {
                this.timeout(30_000);
                (await exec(`Write("[" # ${sysvar(name)}.ValueName(${index}) # "]");`)).should.equal(`[${expected}]`);
            });
        }

        it('should not change the value', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Mode')}; sv.State(1); Write(sv.ValueName(2) # "|" # sv.Value() # "|" # sv.ValueName());`)).should.equal('Urlaub|1|An');
        });

        it('should take the index from an expression', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Mode')}; integer i = 1; Write(sv.ValueName(i + 1) # "|" # sv.ValueName("1") # "|" # sv.ValueName(sv.Value()));`)).should.equal('Urlaub|An|An');
        });
    });

    describe('ValueIndex()', function () {
        const cases = [
            ['VL Mode', 'Aus', 0],
            ['VL Mode', 'An', 1],
            ['VL Mode', 'Urlaub', 2],
            ['VL Mode', 'urlaub', -1],
            ['VL Mode', 'Urlaub ', -1],
            ['VL Mode', 'Url', -1],
            ['VL Mode', '', -1],
            ['VL Gaps', 'c', 2],
            ['VL Gaps', '', 1],
            ['VL Numbers', '10', 1],
            ['VL Numbers', 'x y', 3],
            ['VL Numbers', 'Ä°C', 4],
            ['VL Empty', '', -1],
            ['VL Bool', 'zu', -1],
            ['VL String', 'Urlaub', -1]
        ];
        for (const [name, entry, expected] of cases) {
            it(`should return ${expected} for ${JSON.stringify(entry)} of ${name}`, async function () {
                this.timeout(30_000);
                (await exec(`Write(${sysvar(name)}.ValueIndex(${regaLiteral(entry)}));`)).should.equal(String(expected));
            });
        }

        it('should return an integer and be the inverse of ValueName(index)', async function () {
            this.timeout(30_000);
            (await exec(`
object sv = ${sysvar('VL Mode')};
var i = sv.ValueIndex("An");
Write(i.VarType() # "|" # (i + 1) # "|");
integer n;
foreach (n, "0\\t1\\t2") { Write((sv.ValueIndex(sv.ValueName(n)) == n) # ";"); }
`)).should.equal('2|2|true;true;true;');
        });
    });

    describe('State() of a value list', function () {
        it('should set the entry of a text', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Mode')}; sv.State(0); Write(sv.State("Urlaub") # "|" # sv.Value() # "|" # sv.ValueName() # "|"); Write(sv.State("An") # "|" # sv.Value() # "|" # sv.ValueName());`)).should.equal('true|2|Urlaub|true|1|An');
        });

        it('should set the entry of a text from an expression and for the object of its ID', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Mode')}; string s = "Url" # "aub"; sv.State(0); sv.State(s); Write(sv.ValueName() # "|"); dom.GetObject(sv.ID()).State("Aus"); Write(sv.ValueName());`)).should.equal('Urlaub|Aus');
        });

        it('should set the entry of a text with a delay', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Mode')}; sv.State(0); Write(sv.State("An", 500));`)).should.equal('true');
            const deadline = Date.now() + 10_000;
            let value = '';
            while (value !== '1' && Date.now() < deadline) {
                value = await exec(`Write(${sysvar('VL Mode')}.Value());`);
            }

            value.should.equal('1');
        });

        it('should take a number as index as before', async function () {
            this.timeout(30_000);
            // (also a text of a number, even if it is an entry of the value list)
            (await exec(`object sv = ${sysvar('VL Numbers')}; sv.State(0); Write(sv.State("2") # "|" # sv.Value() # "|"); Write(sv.State(1) # "|" # sv.Value() # "|"); Write(sv.State(" 3 ") # "|" # sv.Value() # "|" # sv.ValueName());`)).should.equal('true|2|true|1|true|3|x y');
        });

        it('should set the entry of a text with blank or special characters', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL Numbers')}; sv.State(0); Write(sv.State("Ä°C") # "|" # sv.Value() # "|"); sv.State(0); Write(sv.State("x y") # "|" # sv.Value());`)).should.equal('true|4|true|3');
        });

        it('should not set an unknown text and log a warning', async function () {
            this.timeout(30_000);
            const logged = waitForRega(/WARNING: State\(\): 'Ferien' is no entry of the value list of 'VL Mode'/, {buffered: false, timeout: 10_000});
            (await exec(`object sv = ${sysvar('VL Mode')}; sv.State(1); Write(sv.State("Ferien") # "|" # sv.Value());`)).should.equal('false|1');
            await logged;
        });

        it('should set an index outside of the value list and log a warning', async function () {
            this.timeout(30_000);
            const logged = waitForRega(/WARNING: State\(\): 3 is outside of the value list of 'VL Mode' \(\d+, 0\.\.2\)/, {buffered: false, timeout: 10_000});
            (await exec(`object sv = ${sysvar('VL Mode')}; Write(sv.State(3) # "|" # sv.Value()); sv.State(0);`)).should.equal('true|3');
            await logged;
            const loggedNegative = waitForRega(/WARNING: State\(\): -1 is outside of the value list of 'VL Mode'/, {buffered: false, timeout: 10_000});
            (await exec(`object sv = ${sysvar('VL Mode')}; Write(sv.State(-1) # "|" # sv.Value()); sv.State(0);`)).should.equal('true|-1');
            await loggedNegative;
        });

        it('should not log a warning for a valid index or entry', async function () {
            this.timeout(30_000);
            const logged = waitForRega(/WARNING: State\(\):/, {buffered: false, timeout: 2000}).then(() => true, () => false);
            await exec(`object sv = ${sysvar('VL Mode')}; sv.State(2); sv.State("An"); sv.State("0"); ${sysvar('VL Empty')}.State(5);`);
            (await logged).should.be.false();
        });
    });

    describe('State() of other system variables', function () {
        it('should set a text and logic values as before', async function () {
            this.timeout(30_000);
            (await exec(`object sv = ${sysvar('VL String')}; Write(sv.State("An") # "|" # sv.Value() # "|");`)).should.equal('true|An|');
            (await exec(`object sv = ${sysvar('VL Bool')}; sv.State(false); Write(sv.State("offen") # "|" # sv.Value() # "|" # sv.State(true) # "|" # sv.Value());`)).should.equal('false|false|true|true');
            (await exec(`object sv = ${sysvar('VL Number')}; Write(sv.State("An") # "|" # sv.Value() # "|" # sv.State(5) # "|" # sv.Value());`)).should.equal('false|2.000000|true|5.000000');
        });
    });

    cleanupTest();
});
