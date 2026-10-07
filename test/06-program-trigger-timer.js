/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {
    regaLabel,
    initTest,
    cleanupTest,
    waitForSim
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest();

    // run tests
    describe('running timer triggers virtual key test...', function () {
        it('should PRESS_LONG BidCoS-RF:50 every minute (program TimerEveryMinute)', async function () {
            this.timeout(125000);
            await waitForSim(/BidCoS-RF:50/);
        });
    });

    // cleanup test environment
    cleanupTest();
});
