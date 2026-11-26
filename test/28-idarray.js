/* global describe, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests variables declared as idarray in the scripts: before, such a variable
// referred to no ID array, so that its methods (e.g. Add()) ended the script
// with an error; now it refers to an empty ID array of the script engine,
// freed with its variables.
// see https://github.com/OpenCCU/OpenCCU/issues/536

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
    // fixed in ReGaHss R1.00.0388.0272
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0272');
    });

    for (const scope of ['global', 'local']) {
        describe('ScriptVariableScope=' + scope, function () {
            let instance = null;

            const exec = async script => (await instance.exec(script)).output;

            // executes the program "IA Program" (counts its ID array) and
            // returns the count written to "IA Out"
            const runProgram = async () => {
                await exec('dom.GetObject("IA Out").State("");');
                await exec('dom.GetObject("IA Trigger").State(true);');
                const deadline = Date.now() + 10_000;
                let output = '';
                while (output === '' && Date.now() < deadline) {
                    await sleep(100);
                    output = await exec('Write(dom.GetObject("IA Out").Value());');
                }

                return output;
            };

            describe('init', function () {
                step('should start ReGaHss [' + regaLabel + ']', async function () {
                    this.timeout(60_000);
                    instance = new ReGaInstance({name: 'idarray-' + scope, config: {ScriptVariableScope: scope}});
                    await instance.start({testFile: __filename});
                    await instance.ready();
                    await instance.waitFor(/ReGa entering normal operation/);
                });

                step('should create the program', async function () {
                    this.timeout(30_000);
                    await exec(`
object list = dom.GetObject(ID_SYSTEM_VARIABLES);
object sv = dom.CreateObject(OT_VARDP, "IA Trigger");
list.Add(sv.ID());
sv.ValueType(ivtBinary);
sv.ValueSubType(istBool);
sv.State(false);
sv = dom.CreateObject(OT_VARDP, "IA Out");
list.Add(sv.ID());
sv.ValueType(ivtString);
sv.ValueSubType(istChar8859);
sv.State("");
dom.RTUpdate(0);
`);
                    // (the script declares an ID array at each execution, adds
                    // an object, writes the count and sets it as session variable)
                    const id = await exec(programScript({
                        name: 'IA Program',
                        rules: [{
                            conditions: [[{sysvar: 'IA Trigger', value: true, trigger: 'update'}]],
                            destinations: [{script: 'idarray prgArray; prgArray.Add(dom.GetObject(ID_ROOMS)); prgArray.Add(dom.GetObject(ID_FUNCTIONS)); system.SetSessionVar("prgArray", prgArray); dom.GetObject("IA Out").State(prgArray.Count() # "");'}]
                        }]
                    }));
                    Number(id).should.be.above(0, 'program not created: ' + id);
                });
            });

            describe('idarray variables', function () {
                step('should have an empty ID array for a declared variable', async function () {
                    this.timeout(30_000);
                    (await exec('idarray a; Write(a.Count() # "|" # a.EnumIDs() # "|" # a.Type());')).should.equal('0||idarray');
                });

                step('should add, get and remove objects', async function () {
                    this.timeout(30_000);
                    (await exec(`
idarray a;
object r = dom.GetObject(ID_ROOMS);
object f = dom.GetObject(ID_FUNCTIONS);
Write(a.Add(r) # a.Add(f) # a.Add(r) # "|" # a.Count() # "|" # a.EnumIDs() # "|" # a.GetAt(0).Name() # "|");
string s;
foreach (s, a.EnumIDs()) { Write(dom.GetObject(s).Name() # ";"); }
Write("|" # a.Remove(r) # "|" # a.Count() # "|");
a.RemoveAll();
Write(a.Count());
`)).should.equal('truetruetrue|2|101\t151|Rooms|Rooms;Functions;|true|1|0');
                });

                step('should share the ID array with an assigned variable and clear it by a new declaration', async function () {
                    this.timeout(30_000);
                    (await exec(`
idarray a;
a.Add(dom.GetObject(ID_ROOMS));
idarray b = a;
b.Add(dom.GetObject(ID_FUNCTIONS));
Write(a.Count() # "|");
idarray a;
Write(a.Count() # "|" # b.Count());
`)).should.equal('2|0|0');
                });

                step('should give each request its own ID array', async function () {
                    this.timeout(30_000);
                    for (let i = 0; i < 3; i++) {
                        (await exec('idarray x; x.Add(dom.GetObject(ID_ROOMS)); Write(x.Count());')).should.equal('1');
                    }
                });

                step('should keep the IDs of an ID array set as session variable by a request', async function () {
                    this.timeout(30_000);
                    (await exec('idarray y; y.Add(dom.GetObject(ID_ROOMS)); y.Add(dom.GetObject(ID_FUNCTIONS)); Write(system.SetSessionVar("reqArray", y));')).should.equal('true');
                    (await exec('Write(system.GetSessionVar("reqArray"));')).should.equal('101\t151');
                });
            });

            describe('idarray variables in the scripts of programs', function () {
                step('should declare an empty ID array at each execution', async function () {
                    this.timeout(30_000);
                    for (let i = 0; i < 3; i++) {
                        (await runProgram()).should.equal('2');
                    }
                });

                step('should keep the IDs of an ID array set as session variable by a program', async function () {
                    this.timeout(30_000);
                    (await exec('Write(system.GetSessionVar("prgArray"));')).should.equal('101\t151');
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
    }
});
