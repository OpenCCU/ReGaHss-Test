/* global describe, it */
/* eslint-disable no-unused-vars, prefer-arrow-callback, capitalized-comments */

const {
    cp,
    rega,
    subscribe,
    procs,
    simSubscriptions,
    simBuffer,
    regaSubscriptions,
    regaBuffer,
    regaLabel,
    indent,
    initTest,
    cleanupTest
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest();

    // run tests
    describe('running timer triggers virtual key test...', function () {
        it('should PRESS_LONG BidCoS-RF:50 every minute (program TimerEveryMinute)', function (done) {
            this.timeout(125000);
            subscribe('sim', /BidCoS-RF:50/, function () {
                done();
            });
        });
    });

    // cleanup test environment
    cleanupTest();
});
