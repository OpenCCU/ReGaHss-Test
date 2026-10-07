/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {promisify} = require('util');

const {
    regaLabel,
    initTest,
    cleanupTest,
    rpcCall,
    rpcWrite,
    waitForRega
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest({sim: false, rpc: true});

    describe('running rega rpc server error handling test...', function () {
        it('should respond to unknown Method', async function () {
            const result = await promisify(rpcCall)('doesNotExist', []);
            result.should.deepEqual({faultCode: -1, faultString: 'doesNotExist: unknown method name'});
        });

        it('should log invalid params', async function () {
            const logged = waitForRega(/invalid parameter size/, {buffered: false});
            rpcCall('event', ['BidCoS-RF:1']);
            await logged;
        });

        it('should log incomplete binrpc message', async function () {
            this.timeout(15000);
            const buf = Buffer.from([0x42, 0x69, 0x6E, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x05, 0x65, 0x76, 0x65, 0x6E, 0x74, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x0B]);
            // (depending on the timing of the connection close the server reads
            // EOF or the connection is reset, e.g. with the emulated ReGaHss)
            const logged = waitForRega(/XmlRpcServerConnection::readRequest: (EOF while reading request|read error \(error 104\))/, {buffered: false});
            rpcWrite(buf);
            await logged;
        });
    });

    // cleanup test environment
    cleanupTest();
});
