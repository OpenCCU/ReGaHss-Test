/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, prefer-arrow-callback, capitalized-comments, max-nested-callbacks */

const {
    cp,
    rega,
    subscribe,
    procs,
    simSubscriptions,
    simBuffer,
    regaSubscriptions,
    regaBuffer,
    flavors,
    indent,
    initTest,
    cleanupTest
} = require('../lib/helper.js');

require('should');

flavors.forEach(function (flavor) {
    describe('Running ' + __filename.split('/').reverse()[0] + ' [' + flavor + ']', function () {
        // initialize test environment
        initTest(flavor);

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
        cleanupTest(flavor);
    });
});
