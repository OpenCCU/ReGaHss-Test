/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, prefer-arrow-callback, max-nested-callbacks, capitalized-comments */

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
        describe('running virtual key triggers program test...', function () {
            it('should PRESS_LONG BidCoS-RF:2 when PRESS_SHORT BidCoS-RF:1 (program Key1)', function (done) {
                // BidCoS-RF:1 PRESS_SHORT is pressed by the simulator every 5 seconds
                this.timeout(90000);
                subscribe('sim', /setValue rfd BidCoS-RF:2 PRESS_LONG true/, function () {
                    done();
                });
            });
        });

        // cleanup test environment
        cleanupTest(flavor);
    });
});
