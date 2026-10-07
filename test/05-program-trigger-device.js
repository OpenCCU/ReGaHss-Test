/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {
    regaLabel,
    initTest,
    cleanupTest,
    simulator,
    waitForSim
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest();

    // run tests
    describe('running virtual key triggers program test...', function () {
        it('should PRESS_LONG BidCoS-RF:2 when PRESS_SHORT BidCoS-RF:1 (program Key1)', async function () {
            this.timeout(30000);
            // the simulated rfd reports a short key press of BidCoS-RF:1
            await Promise.all([
                waitForSim(/setValue rfd BidCoS-RF:2 PRESS_LONG true/, {buffered: false}),
                simulator().interface('BidCos-RF').event('BidCoS-RF:1', 'PRESS_SHORT', true)
            ]);
        });

        it('should PRESS_LONG BidCoS-RF:17 when PRESS_LONG BidCoS-RF:16 (program Key16Key17)', async function () {
            this.timeout(30000);
            await Promise.all([
                waitForSim(/setValue rfd BidCoS-RF:17 PRESS_LONG true/, {buffered: false}),
                simulator().interface('BidCos-RF').event('BidCoS-RF:16', 'PRESS_LONG', true)
            ]);
        });
    });

    // cleanup test environment
    cleanupTest();
});
