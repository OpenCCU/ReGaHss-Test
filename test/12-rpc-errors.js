/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {promisify} = require('util');

const {
    regaLabel,
    initTest,
    cleanupTest,
    rpcCall,
    rpcWrite,
    regaInstance,
    requireXmlRpcVersion,
    waitForRega
} = require('../lib/helper.js');
const {sendRaw} = require('../lib/fuzzer.js');

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
            const logged = waitForRega(/XmlRpcServerConnection::readRequest: EOF while reading request/, {buffered: false});
            await rpcWrite(buf);
            await logged;
        });
    });

    describe('running rega rpc server nesting test...', function () {
        // raw XML-RPC request with a parameter nested depth arrays deep
        function xmlRpcNested(depth) {
            const body = '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName><params><param><value>'
                + '<array><data><value>'.repeat(depth) + '<i4>1</i4>' + '</value></data></array>'.repeat(depth)
                + '</value></param></params></methodCall>';
            return 'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/xml\r\nContent-Length: ' + body.length + '\r\n\r\n' + body;
        }

        // raw BIN-RPC request with a parameter nested depth arrays deep
        // (the parameter list itself is an array as well)
        function binRpcNested(depth) {
            const int32 = n => {
                const buf = Buffer.alloc(4);
                buf.writeInt32BE(n);
                return buf;
            };

            const method = Buffer.from('system.listMethods', 'latin1');
            const array = Buffer.concat([int32(0x1_00), int32(1)]);
            const body = Buffer.concat([int32(method.length), method, int32(1), Buffer.alloc(array.length * depth, array), int32(0x1), int32(1)]);
            return Buffer.concat([Buffer.from('Bin\u0000', 'latin1'), int32(body.length), body]);
        }

        // sends a raw request to the RPC port and returns the response
        async function sendRequest(request, timeout) {
            const response = await sendRaw(regaInstance().ports.xmlrpc, request, timeout);
            return response.toString('latin1');
        }

        // ReGaHss still running and answering RPC calls
        async function shouldStillRespond() {
            regaInstance().running.should.be.true();
            const result = await promisify(rpcCall)('system.listMethods', []);
            result.should.containEql('system.multicall');
        }

        it('should reject a nested system.multicall', async function () {
            await requireXmlRpcVersion(this, '0.11');
            const result = await promisify(rpcCall)('system.multicall', [[{methodName: 'system.multicall', params: [[]]}]]);
            JSON.stringify(result).should.containEql('recursive calls are not allowed');
            await shouldStillRespond();
        });

        it('should accept moderately nested BIN-RPC parameters', async function () {
            await requireXmlRpcVersion(this, '0.12');
            const response = await sendRequest(binRpcNested(32), 10_000);
            response.should.containEql('system.multicall');
            response.should.not.containEql('faultCode');
        });

        it('should not crash on deeply nested XML-RPC parameters', async function () {
            await requireXmlRpcVersion(this, '0.12');
            this.timeout(30_000);
            const response = await sendRequest(xmlRpcNested(100_000), 20_000);
            response.should.startWith('HTTP/1.1 200');
            await shouldStillRespond();
        });

        it('should reject deeply nested BIN-RPC parameters', async function () {
            await requireXmlRpcVersion(this, '0.12');
            this.timeout(30_000);
            const response = await sendRequest(binRpcNested(100_000), 20_000);
            response.should.startWith('Bin');
            response.should.containEql('faultCode');
            await shouldStillRespond();
        });
    });

    // cleanup test environment
    cleanupTest();
});
