/* eslint-disable no-await-in-loop */

// Helpers of the test files creating and checking objects via ReGa scripts
// (system variables, programs) on the ReGaHss instance of the running test.

const {rega} = require('./helper.js');
const {programScript} = require('./program-builder.js');

require('should');

const sleep = ms => new Promise(resolve => {
    setTimeout(resolve, ms);
});

/**
 * @param {string} script
 * @returns {Promise<string>} output of the script
 */
async function exec(script) {
    const {output} = await rega.exec(script);
    return output;
}

/**
 * Creates system variables.
 *
 * @param {Object<string, string>} variables - {name: 'number' | 'bool' | 'string'}
 */
async function createSysvars(variables) {
    const lines = ['object list = dom.GetObject(ID_SYSTEM_VARIABLES);', 'object sv;'];
    for (const [name, type] of Object.entries(variables)) {
        lines.push(`sv = dom.CreateObject(OT_VARDP, ${JSON.stringify(name)});`, 'list.Add(sv.ID());');
        switch (type) {
            case 'number': {
                lines.push('sv.ValueType(ivtFloat);', 'sv.ValueSubType(istGeneric);', 'sv.ValueMin(-1000000);', 'sv.ValueMax(1000000);', 'sv.State(0);');
                break;
            }

            case 'bool': {
                lines.push('sv.ValueType(ivtBinary);', 'sv.ValueSubType(istBool);', 'sv.ValueName0("aus");', 'sv.ValueName1("an");', 'sv.State(false);');
                break;
            }

            default: {
                lines.push('sv.ValueType(ivtString);', 'sv.ValueSubType(istChar8859);', 'sv.State("");');
            }
        }
    }

    lines.push('dom.RTUpdate(0);');
    await exec(lines.join('\n'));
}

/**
 * Creates a program (see lib/program-builder.js).
 *
 * @param {object} program
 * @returns {Promise<number>} ID of the program
 */
async function createProgram(program) {
    const output = await exec(programScript(program));
    Number(output).should.be.above(0, 'program ' + program.name + ' not created: ' + output);
    return Number(output);
}

function set(name, value) {
    return exec(`dom.GetObject(${JSON.stringify(name)}).State(${JSON.stringify(value)});`);
}

function value(name) {
    return exec(`Write(dom.GetObject(${JSON.stringify(name)}).Value());`);
}

/**
 * Waits until fn() returns the expected value.
 *
 * @param {function(): Promise<*>} fn
 * @param {*} expected
 * @param {number} [timeout=10000]
 */
async function until(fn, expected, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    let actual = await fn();
    while (actual !== expected && Date.now() < deadline) {
        await sleep(100);
        actual = await fn();
    }

    actual.should.equal(expected);
}

// Destination script incrementing a counter (number system variable)
const increment = name => ({script: `object c = dom.GetObject("${name}"); c.State(c.Value() + 1);`});

module.exports = {
    sleep, exec, createSysvars, createProgram, set, value, until, increment
};
