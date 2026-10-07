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
    describe('running virtual key triggers program test...', function () {
        it('should PRESS_LONG BidCoS-RF:2 when PRESS_SHORT BidCoS-RF:1 (program Key1)', async function () {
            // BidCoS-RF:1 PRESS_SHORT is pressed by the simulator every 5 seconds
            this.timeout(90000);
            await waitForSim(/setValue rfd BidCoS-RF:2 PRESS_LONG true/);
        });
    });

    // cleanup test environment
    cleanupTest();
});
