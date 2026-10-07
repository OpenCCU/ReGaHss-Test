/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    waitForRega
} = require('../lib/helper.js');

require('should');

// executes a script and waits for a log line matching rx caused by it
async function execAndWaitForLog(script, rx) {
    // (only lines output after the script was sent are considered)
    const [result] = await Promise.all([
        rega.exec(script),
        waitForRega(rx, {buffered: false})
    ]);
    return result;
}

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest(false);

    describe('verify script error handling...', function () {
        it('should handle unknown script methods', async function () {
            this.timeout(60000);
            await execAndWaitForLog(`
dom.MethodDoesNotExist("muh");
                `, /SyntaxError. Error 1 at row 2 col 27 near \^\("muh"\);/);
        });

        it('should handle syntax Errors', async function () {
            this.timeout(60000);
            await execAndWaitForLog(`

WriteLine(bla");
                `, /SyntaxError. Error 1 at row 3 col 43 near/);
        });

        it('should handle illegal method invocation', async function () {
            this.timeout(60000);
            await execAndWaitForLog(`
var unknown = dom.GetObject("doesNotExist");
WriteLine(unknown.Name());
                `, /ERROR: ScriptRuntimeError: /);
        });

        it('should handle invalid method use', async function () {
            this.timeout(60000);
            await execAndWaitForLog(`
var a = system.ToFloat();
var b = system.ToFloat("1.4");
var c = system.ToFloat("a");
                `, /ERROR: ScriptRuntimeError: /);
        });

        it('should log division by zero', async function () {
            this.timeout(60000);
            const {output} = await execAndWaitForLog(`
var one = 1;
var zero = 0;
var infinite  = one / zero;
WriteLine(infinite);
                `, /division by (0|zero)/i);
            output.should.equal('0\r\n');
        });
    });

    // cleanup test environment
    cleanupTest();
});
