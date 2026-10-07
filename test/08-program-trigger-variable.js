/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    waitForSim
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest();

    describe('running variable change triggers program test...', function () {
        it('should PRESS_LONG BidCoS-RF:12 when VarBool1 changes to true (program Bool1OnTrue)', async function () {
            this.timeout(7000);
            await Promise.all([
                waitForSim(/setValue rfd BidCoS-RF:12 PRESS_LONG true/, {buffered: false}),
                rega.exec('var b1 = dom.GetObject(1237);\nb1.State(true);')
            ]);
        });
        it('should PRESS_LONG BidCoS-RF:13 when VarBool1 changes to false (program Bool1OnFalse)', async function () {
            this.timeout(7000);
            await Promise.all([
                waitForSim(/setValue rfd BidCoS-RF:13 PRESS_LONG true/, {buffered: false}),
                rega.exec('var b1 = dom.GetObject(1237);\nb1.State(false);')
            ]);
        });
    });

    // cleanup test environment
    cleanupTest();
});
