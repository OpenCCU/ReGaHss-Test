/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, max-nested-callbacks */

// Long running stability/memory test (soak test): executes scripts, sends
// device events and lets programs and timers run for REGA_SOAK_SECONDS (a
// short run by default, longer in the nightly CI run) and tracks the
// resident memory (RSS), the number of threads and open file descriptors of
// ReGaHss. ReGaHss must stay alive and responsive and must not leak memory,
// threads or file descriptors (checked against a threshold after a warmup).

const {
    regaLabel,
    regaEmulator,
    indent,
    initTest,
    cleanupTest,
    regaInstance,
    simulator
} = require('../lib/helper.js');
const {
    exec, createSysvars, createProgram, set, value, increment
} = require('../lib/script-helpers.js');

require('should');

const soakSeconds = Number(process.env.REGA_SOAK_SECONDS || 30);
// (emulated ReGaHss is slower, fewer iterations per second)
const slowdown = regaEmulator ? 4 : 1;

// one round of load: scripts, a system variable change triggering a program
// and a device event triggering a program (Key1 of the test regadom)
async function load(iteration) {
    await exec(`
string s = "iteration ${iteration}";
integer n = ${iteration};
object sv = dom.GetObject("Soak Number");
sv.State(sv.Value() + 1);
string ids = dom.GetObject(ID_DEVICES).EnumUsedIDs();
WriteLine(s # " " # n # " " # system.Date("%F %T"));`);
    await set('Soak Trigger', iteration % 2 === 0);
    await simulator().interface('BidCos-RF').event('BidCoS-RF:1', 'PRESS_SHORT', true);
}

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    describe('stability (' + soakSeconds + 's soak)', function () {
        initTest({sim: true});

        const samples = [];

        // (a nested describe, so the tests run after the init steps of initTest())
        describe('soak', function () {
            it('should stay alive and responsive under load', async function () {
                this.timeout((soakSeconds + 90) * 1000 * slowdown);
                await createSysvars({'Soak Number': 'number', 'Soak Trigger': 'bool', 'Soak Count': 'number'});
                await createProgram({
                    name: 'Soak Program',
                    rules: [{conditions: [[{sysvar: 'Soak Trigger', value: true, trigger: 'change'}]], destinations: [increment('Soak Count')]}]
                });
                const instance = regaInstance();
                const deadline = Date.now() + (soakSeconds * 1000);
                let iteration = 0;
                let nextSample = 0;
                while (Date.now() < deadline) {
                    await load(iteration);
                    iteration += 1;

                    // (a resource sample every ~2 seconds)
                    if (Date.now() >= nextSample) {
                        const usage = instance.resourceUsage();
                        if (!usage) {
                            throw new Error('ReGaHss is not running anymore after ' + iteration + ' iterations');
                        }

                        samples.push({time: Date.now(), iteration, ...usage});
                        nextSample = Date.now() + 2000;
                    }
                }

                // ReGaHss still executes scripts and ran the programs
                const alive = await exec('Write("alive");');
                alive.should.equal('alive');
                Number(await value('Soak Count')).should.be.above(0);
                this.test.title += ` (${iteration} iterations, ${samples.length} samples)`;
            });

            it('should not leak memory, threads or file descriptors', function () {
                samples.length.should.be.above(3, 'not enough samples');

                // (compare the second half with the first after a warmup)
                const warmup = samples[Math.floor(samples.length / 2)];
                const last = samples.at(-1);
                const report = samples.map(sample => `${((sample.time - samples[0].time) / 1000).toFixed(0)}s: rss ${sample.rss} KiB, ${sample.threads} threads, ${sample.fds} fds`);
                console.log(indent('resource usage:\n' + report.join('\n'), 8));

                // the number of threads and file descriptors must not keep growing
                last.threads.should.be.belowOrEqual(warmup.threads + 2, 'number of threads keeps growing (thread leak)');
                last.fds.should.be.belowOrEqual(warmup.fds + 8, 'number of open file descriptors keeps growing (fd leak)');

                // the resident memory may grow somewhat (caches), but not without bounds
                const growth = last.rss - warmup.rss;
                const limit = Math.max(8192, warmup.rss * 0.25);
                growth.should.be.below(limit, `resident memory grew by ${growth} KiB after the warmup (possible memory leak)`);
            });
        });

        cleanupTest();
    });
});
