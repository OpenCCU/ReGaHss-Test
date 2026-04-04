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
    cleanupTest,
    rpcCall,
    rpcWrite
} = require('../lib/helper.js');

require('should');

flavors.forEach(function (flavor) {
    describe('Running ' + __filename.split('/').reverse()[0] + ' [' + flavor + ']', function () {
        // initialize test environment
        initTest(flavor, false, null, true);

        describe('running rega rpc server error handling test...', function () {
            it('should respond to unknown Method', function (done) {
                if (!procs.rega) {
                    return this.skip();
                }

                rpcCall('doesNotExist', [], function (error, result) {
                    if (error) {
                        done(error);
                    } else {
                        result.should.deepEqual({faultCode: -1, faultString: 'doesNotExist: unknown method name'});
                        done();
                    }
                });
            });

            it('should log invalid params', function (done) {
                if (!procs.rega) {
                    return this.skip();
                }

                subscribe('rega', /invalid parameter size/, function () {
                    done();
                });
                rpcCall('event', ['BidCoS-RF:1']);
            });

            it('should log incomplete binrpc message', function (done) {
                if (!procs.rega) {
                    return this.skip();
                }

                this.timeout(15000);
                const buf = Buffer.from([0x42, 0x69, 0x6E, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x05, 0x65, 0x76, 0x65, 0x6E, 0x74, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x0B]);
                subscribe('rega', /XmlRpcServerConnection::readRequest: EOF while reading request/, function () {
                    done();
                });
                rpcWrite(buf);
            });
        });

        // cleanup test environment
        cleanupTest(flavor);
    });
});
