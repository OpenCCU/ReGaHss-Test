/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, max-nested-callbacks, prefer-arrow-callback, capitalized-comments */

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

        describe('running variable change triggers program test...', function () {
            it('should PRESS_LONG BidCoS-RF:12 when VarBool1 changes to true (program Bool1OnTrue)', function (done) {
                this.timeout(7000);
                subscribe('sim', /setValue rfd BidCoS-RF:12 PRESS_LONG true/, function () {
                    done();
                });
                rega.exec('var b1 = dom.GetObject(1237);\nb1.State(true);');
            });
            it('should PRESS_LONG BidCoS-RF:13 when VarBool1 changes to false (program Bool1OnTrue)', function (done) {
                this.timeout(7000);
                subscribe('sim', /setValue rfd BidCoS-RF:13 PRESS_LONG true/, function () {
                    done();
                });
                rega.exec('var b1 = dom.GetObject(1237);\nb1.State(false);');
            });
        });

        // cleanup test environment
        cleanupTest(flavor);
    });
});
