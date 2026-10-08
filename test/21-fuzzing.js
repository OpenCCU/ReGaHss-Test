/* global describe, it */
/* eslint-disable prefer-arrow-callback, no-await-in-loop */

// Fuzzing of the interfaces of ReGaHss with deterministic (seeded) inputs:
// BIN-RPC and XML-RPC requests to its RPC server (libXmlRpc, libxmlparser),
// HTTP requests to its web server and random ReGa scripts. After every 25
// inputs (and at the end) ReGaHss must still be running and answer requests
// on both servers; crashes are detected immediately. Run with the ASan/UBSan
// instrumented libraries (asan variant) memory errors in the libraries are
// reported, too.
//
//   REGA_FUZZ_ITERATIONS=<n>  inputs per target (default 200, nightly CI more)
//   REGA_FUZZ_SEED=<n>        seed of the inputs (default 1)
//   REGA_FUZZ_DIR=<dir>       directory to save the last inputs to if
//                             ReGaHss crashes or hangs (for reproduction)

const fs = require('fs');
const path = require('path');

const {
    rega,
    regaLabel,
    regaInstance,
    regaEmulator,
    initTest,
    cleanupTest
} = require('../lib/helper.js');
const {
    random, binRequest, binrpcInput, xmlrpcInput, httpInput, randomScript, sendRaw
} = require('../lib/fuzzer.js');

require('should');

const iterations = Number(process.env.REGA_FUZZ_ITERATIONS || 200);
const seed = Number(process.env.REGA_FUZZ_SEED || 1);
const fuzzDir = process.env.REGA_FUZZ_DIR || '';
// (emulated ReGaHss answers slower)
const slowdown = regaEmulator ? 5 : 1;

const sleep = ms => new Promise(resolve => {
    setTimeout(resolve, ms);
});

const targets = [
    {name: 'BIN-RPC', port: 'xmlrpc', input: binrpcInput},
    {name: 'XML-RPC', port: 'xmlrpc', input: xmlrpcInput},
    {name: 'HTTP', port: 'http', input: httpInput},
    {name: 'script', input: randomScript}
];

function saveInputs(target, targetSeed, iteration, history) {
    if (!fuzzDir) {
        return '';
    }

    fs.mkdirSync(fuzzDir, {recursive: true});
    const file = path.join(fuzzDir, target.name + '-seed' + targetSeed + '.json');
    fs.writeFileSync(file, JSON.stringify({
        target: target.name,
        seed: targetSeed,
        iteration,
        // (last inputs, the one sent last at the end)
        inputs: history.map(input => Buffer.from(input, 'latin1').toString('base64'))
    }, null, 2));
    return file;
}

// ReGaHss must run and answer on its web server and RPC server
async function healthCheck() {
    const instance = regaInstance();
    if (!instance.running) {
        throw new Error('ReGaHss is not running anymore');
    }

    const answer = await Promise.race([
        rega.exec('Write("alive");').then(({output}) => output, error => 'error: ' + error.message),
        sleep(15_000 * slowdown).then(() => 'timeout')
    ]);
    if (answer !== 'alive') {
        throw new Error('ReGaHss does not execute scripts anymore (' + answer + ')');
    }

    const response = await sendRaw(instance.ports.xmlrpc, binRequest('system.listMethods', []), 15_000 * slowdown);
    if (response.subarray(0, 3).toString('latin1') !== 'Bin') {
        throw new Error('the RPC server of ReGaHss does not answer anymore (' + JSON.stringify(response.subarray(0, 40).toString('latin1')) + ')');
    }
}

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    initTest({sim: true});

    // (initTest() waits until ReGaHss entered normal operation)
    describe('fuzzing', function () {
        for (const [index, target] of targets.entries()) {
            const targetSeed = (seed * 100) + index;
            it(`should survive ${iterations} ${target.name} inputs (seed ${targetSeed})`, async function () {
                this.timeout(((iterations * 3000) + 60_000) * slowdown);
                const rnd = random(targetSeed);
                const history = [];
                const start = Date.now();
                for (let iteration = 1; iteration <= iterations; iteration++) {
                    const input = target.input(rnd);
                    history.push(Buffer.isBuffer(input) ? input.toString('latin1') : input);
                    if (history.length > 20) {
                        history.shift();
                    }

                    try {
                        await (target.port ? sendRaw(regaInstance().ports[target.port], input, 1000 * slowdown) : Promise.race([rega.exec(input).catch(() => undefined), sleep(10_000 * slowdown)]));

                        if (iteration % 25 === 0 || iteration === iterations || !regaInstance().running) {
                            await healthCheck();
                        }
                    } catch (error) {
                        const file = saveInputs(target, targetSeed, iteration, history);
                        error.message = `${target.name} input ${iteration} (seed ${targetSeed}): ${error.message}` + (file ? ' – last inputs saved to ' + file : '');
                        throw error;
                    }
                }

                console.log(`        ${iterations} ${target.name} inputs in ${((Date.now() - start) / 1000).toFixed(1)}s`);
            });
        }
    });

    cleanupTest();
});
