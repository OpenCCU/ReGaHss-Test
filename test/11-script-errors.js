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
    initTest(false);

    describe('verify script error handling...', function () {
        it('should handle unknown script methods', function (done) {
            if (!procs.rega) {
                return this.skip();
            }

            this.timeout(60000);
            subscribe('rega', /SyntaxError. Error 1 at row 2 col 27 near \^\("muh"\);/, function () {
                done();
            });
            rega.exec(`
dom.MethodDoesNotExist("muh");
                `, function (error, stdout, objects) {
                if (error) {
                    console.error(error);
                }
            });
        });

        it('should handle syntax Errors', function (done) {
            if (!procs.rega) {
                return this.skip();
            }

            this.timeout(60000);
            subscribe('rega', /SyntaxError. Error 1 at row 3 col 43 near/, function () {
                done();
            });
            rega.exec(`

WriteLine(bla");
                `, function (error, stdout, objects) {
                if (error) {
                    console.error(error);
                }
            });
        });

        it('should handle illegal method invocation', function (done) {
            if (!procs.rega) {
                return this.skip();
            }

            this.timeout(60000);

            subscribe('rega', /ScriptRuntimeError: /, function () {
                done();
            });
            rega.exec(`
var unknown = dom.GetObject("doesNotExist");
WriteLine(unknown.Name());
                `, function (error, stdout, objects) {
                if (error) {
                    console.error(error);
                }
            });
        });

        it('should handle invalid method use', function (done) {
            if (!procs.rega) {
                return this.skip();
            }

            this.timeout(60000);

            subscribe('rega', /ScriptRuntimeError: /, function () {
                done();
            });

            rega.exec(`
var a = system.ToFloat();
var b = system.ToFloat("1.4");
var c = system.ToFloat("a");
                `, function (error, stdout, objects) {
                if (error) {
                    console.error(error);
                }
            });
        });

        it('should log division by zero', function (done) {
            if (!procs.rega) {
                return this.skip();
            }

            this.timeout(60000);
            subscribe('rega', /(division by (0|zero)|inf)/i, function () {
                done();
            });
            rega.exec(`
var one = 1;
var zero = 0;
var infinite  = one / zero;
WriteLine(infinite);
                `, function (error, stdout, objects) {
                if (error) {
                    console.error(error);
                }
            });
        });
    });

    // cleanup test environment
    cleanupTest();
});
