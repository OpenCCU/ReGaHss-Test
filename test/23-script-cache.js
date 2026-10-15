/* global describe, it, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests the caches of the script engine of ReGaHss: the code cache used by
// Call() and the pages, system.ClearCache() and system.CacheMode() as well as
// concurrent first requests of a page (page cache).
// see https://github.com/OpenCCU/OpenCCU/issues/2638
// and https://github.com/OpenCCU/OpenCCU/issues/1467

const fs = require('fs');
const path = require('path');

const {
    regaLabel,
    workerDir,
    ReGaInstance,
    requireRegaVersion
} = require('../lib/helper.js');

require('should');

const fixtureDir = path.join(__dirname, 'fixtures', 'www', 'cache-test');
const fixtureName = 'cache-test';

/**
 * Creates a document root for the web server of ReGaHss: the WebUI files of
 * the configured document root (rega.conf) as symbolic links plus the fixture
 * files of this test.
 *
 * @param {string} dir - directory to create the document root in
 * @returns {string} the document root
 */
function createDocRoot(dir) {
    const conf = fs.readFileSync(path.join(__dirname, '..', 'rega.conf'), 'latin1');
    const webRoot = /^HttpDocPath=(.*)$/m.exec(conf)[1].trim();
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    for (const entry of fs.readdirSync(webRoot)) {
        fs.symlinkSync(path.join(webRoot, entry), path.join(dir, entry));
    }

    fs.symlinkSync(fixtureDir, path.join(dir, fixtureName));
    return dir;
}

const call = fn => `Call("/${fixtureName}/functions.fn::${fn}()");`;

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    let instance = null;

    // fixed in ReGaHss R1.00.0388.0264
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0264');
    });

    describe('init', function () {
        step('should start ReGaHss [' + regaLabel + ']', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({
                name: 'script-cache',
                httpDocPath: createDocRoot(path.join(workerDir(), 'www-script-cache'))
            });
            await instance.start({testFile: __filename});
            await instance.ready();
            await instance.waitFor(/ReGa entering normal operation/);
        });
    });

    describe('Call() and system.ClearCache()', function () {
        const output = async script => (await instance.exec(script)).output;

        // (the function lookup of Call() was not cleared and code cache IDs
        // were reused: Call() executed no or the code of another function)
        it('should execute the called functions after system.ClearCache()', async function () {
            this.timeout(30_000);
            (await output(call('fnA'))).should.equal('AAA');
            (await output(call('fnB'))).should.equal('BBB');
            await output('system.ClearCache();');
            (await output(call('fnB'))).should.equal('BBB');
            (await output(call('fnC'))).should.equal('CCC');
            (await output(call('fnA'))).should.equal('AAA');
            (await output(call('fnB'))).should.equal('BBB');
        });

        // (system.CacheMode(0) clears all caches on every request)
        it('should execute the called functions after system.CacheMode(0)/(1)', async function () {
            this.timeout(30_000);
            (await output(call('fnA'))).should.equal('AAA');
            (await output(call('fnB'))).should.equal('BBB');
            try {
                await output('system.CacheMode(0);');
                (await output(call('fnC'))).should.equal('CCC');
            } finally {
                await output('system.CacheMode(1);');
            }

            (await output(call('fnC'))).should.equal('CCC');
            (await output(call('fnA'))).should.equal('AAA');
            (await output(call('fnB'))).should.equal('BBB');
        });

        // (the code being executed was freed by system.ClearCache(): use-after-free)
        it('should continue the code calling system.ClearCache()', async function () {
            this.timeout(30_000);
            (await output(call('fnA'))).should.equal('AAA');
            (await output(call('fnClear'))).should.equal('xy');
            (await output(call('fnClear'))).should.equal('xy');
            (await output(call('fnA'))).should.equal('AAA');
            (await output(call('fnB'))).should.equal('BBB');
            instance.running.should.be.true();
        });
    });

    describe('concurrent first requests of a page', function () {
        const page = '[A][X][B][Y][C]';
        let sid = null;

        const get = async () => {
            const response = await instance.client.request({path: `/${fixtureName}/race.htm?sid=${sid}`, timeout: 30_000});
            response.statusCode.should.equal(200);
            return response.text.trim();
        };

        step('should log in', async function () {
            this.timeout(30_000);
            const response = await instance.client.request({
                method: 'POST',
                path: '/login.htm',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'tbUsername=Admin&tbPassword='
            });
            response.statusCode.should.equal(302);
            sid = /sid=(@[^@]+@)/.exec(response.headers.location || '')?.[1];
            (sid === undefined).should.be.false('no session id in ' + response.headers.location);
            (await get()).should.equal(page);
        });

        // (the page cache was modified without lock while a page was processed
        // for the first time: requests returned incomplete pages, and the
        // cached page could permanently contain duplicated or missing parts)
        step('should return the complete page to all requests', async function () {
            this.slow(20_000);
            this.timeout(120_000);
            for (let round = 0; round < 10; round++) {
                await instance.exec('system.ClearCache();');
                const responses = await Promise.all(Array.from({length: 20}, () => get()));
                const after = await get();
                const unexpected = [...new Set(responses.filter(text => text !== page))];
                unexpected.length.should.equal(0, 'concurrent requests in round ' + round + ' returned ' + JSON.stringify(unexpected));
                after.should.equal(page, 'request after the concurrent requests in round ' + round);
            }
        });
    });

    describe('cleanup', function () {
        step('should still run ReGaHss [' + regaLabel + ']', function () {
            instance.running.should.be.true('ReGaHss is not running anymore, last log lines:\n' + instance.tail(20));
        });
    });

    after(async function () {
        this.timeout(30_000);
        if (instance) {
            await instance.stop();
        }
    });
});
