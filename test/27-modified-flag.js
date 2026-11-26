/* global describe, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests the modified flag of the DOM (dom.IsDOMModified()) at the start of
// ReGaHss and when pages of the WebUI are loaded: the DOM was marked as
// modified at each start (reading InterfacesList.xml, initializing the timers
// of the programs) and each time the start page of the WebUI was loaded (it
// sets system.LoginPage() to the same value), so that it was saved again and
// again (CheckModifiedCycle).

const {
    regaLabel,
    ReGaInstance,
    requireRegaVersion
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    let instance = null;

    const modified = async () => (await instance.exec('Write(dom.IsDOMModified());')).output;

    const start = async () => {
        await instance.start({testFile: __filename});
        await instance.ready();
        await instance.waitFor(/ReGa entering normal operation/);
    };

    // fixed in ReGaHss R1.00.0388.0272
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0272');
    });

    describe('init', function () {
        step('should start ReGaHss [' + regaLabel + ']', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({name: 'modified-flag'});
            await start();
            // (the InterfacesList.xml of the tests has other ports than the
            // interfaces of the test regadom: a real modification)
            await instance.waitFor(/interfaces changed by .*InterfacesList\.xml, so set modified flag/, {timeout: 10_000});
            (await modified()).should.equal('true');
        });

        step('should restart ReGaHss with the saved DOM', async function () {
            this.timeout(60_000);
            await instance.exec('system.Save();');
            (await modified()).should.equal('false');
            await instance.stop();
            instance.copyRegadom = false;
            await start();
        });
    });

    describe('modified flag', function () {
        step('should not be set at the start of ReGaHss', async function () {
            this.timeout(30_000);
            (await modified()).should.equal('false');
            // (InterfacesList.xml did not change the interfaces of the saved DOM)
            const changed = await instance.waitFor(/interfaces changed by/, {timeout: 1000}).then(() => true, () => false);
            changed.should.be.false();
        });

        step('should not be set by loading the start and login page of the WebUI', async function () {
            this.timeout(30_000);
            for (const path of ['/', '/index.htm', '/login.htm']) {
                const response = await instance.client.request({path});
                response.statusCode.should.equal(200, path);
            }

            (await modified()).should.equal('false');
        });

        step('should only be set by a system setting if its value changes', async function () {
            this.timeout(30_000);
            (await instance.exec('system.LoginPage(system.LoginPage()); system.Longitude(system.Longitude()); Write(dom.IsDOMModified());')).output.should.equal('false');
            (await instance.exec('string p = system.LoginPage(); system.LoginPage("/other.htm"); Write(dom.IsDOMModified()); system.LoginPage(p);')).output.should.equal('true');
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
