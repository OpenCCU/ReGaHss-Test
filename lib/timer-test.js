/* global describe, it */
/* eslint-disable prefer-arrow-callback, max-params, capitalized-comments */

// Timer tests: ReGaHss is started at a faked date/time (libfaketime, with an
// accelerated clock by default, see REGA_FAKETIME_RATE) and the execution
// times of time triggered programs are compared with the expected ones.

const {
    faketimeRate,
    indent,
    initTest,
    cleanupTest,
    regaInstance,
    toTimestamp
} = require('./helper.js');

// time stamp of a ReGaHss log line, e.g. '[2020-10-25 02:00:00 CET] ...'
const logTimeRx = /^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [A-Z]+)] /;

// with an accelerated clock (REGA_FAKETIME_RATE) the executions may deviate
// more from the expected (faked) time as ReGaHss waits in real time steps
const tolerance = 2000 * Math.max(1, faketimeRate / 4);

/**
 * Registers the mocha tests starting ReGaHss at a (faked) date/time and
 * checking that a program is executed at the expected (faked) times.
 *
 * @param {string} time - date/time to start ReGaHss at (e.g. '2020-03-29 01:59:48 CET')
 * @param {string} program - name of the program
 * @param {string} [desc] - description of the test
 * @param {string[]} [targetTimeArray] - expected execution times ('' : any time)
 * @param {number} [waittime=20000] - maximum time to wait for an execution in ms (real time)
 */
function timerTest(time, program, desc = '', targetTimeArray = [ '' ], waittime = 20000) {
    const repetition = targetTimeArray.length;
    describe('Testing ' + repetition + ' executions of \'' + program + '\' @ ' + time + ' \'' + desc + '\'', function () {
        // initialize test environment
        initTest({sim: false, faketime: time, rate: faketimeRate});

        // perform the timer test
        describe('running timer test...', function () {
            let stopProcessing = false;
            for (let i = 0; i < repetition; i++) {
                const targetTime = targetTimeArray[i];
                it('[' + (i + 1) + '/' + repetition + '] should call program \'' + program + '\' @ ' + targetTime, async function () {
                    if (stopProcessing === true) {
                        return this.skip();
                    }

                    // (the waiting time scales with the speed of the faked clock)
                    const timeout = Math.max(5000, Math.ceil(waittime / faketimeRate) + 2000);
                    this.slow(timeout);
                    this.timeout(timeout + 1000);
                    const output = await regaInstance().waitFor(new RegExp('ExecuteDestination succeeded from Program ID = .*\'' + program + '\''), {timeout});
                    console.log(indent(output, 8));
                    if (targetTime === '') {
                        return;
                    }

                    // compare the (faked) time of the execution incl. the
                    // timezone (CET/CEST) with the expected one
                    const match = logTimeRx.exec(output);
                    if (!match) {
                        stopProcessing = true;
                        throw new Error('no time stamp found in "' + output + '"');
                    }

                    const deviation = (toTimestamp(match[1]) - toTimestamp(targetTime)) * 1000;
                    if (Math.abs(deviation) > tolerance) {
                        stopProcessing = true;
                        throw new Error('executed time (' + match[1] + ') does not match expected one (' + targetTime + ')');
                    }
                });
            }
        });

        // cleanup test environment
        cleanupTest();
    });
}

module.exports = {timerTest};
