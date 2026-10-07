/* global describe, it, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Data driven script tests: executes the cases of the script corpus
// (test/corpus/*.rega, see lib/corpus.js) and compares their output and
// variables with the recorded ones.
//
//   REGA_CORPUS_RECORD=1   record the results of the ReGaHss under test as
//                          expected results (rewrites the corpus files)
//   REGA_CORPUS=<pattern>  only run corpus files matching the pattern
//   REGA_REF_BIN=<file>    differential test: additionally execute all cases
//                          with this (reference) ReGaHss binary and report the
//                          differences (REGA_REF_LIB_DIR: its libraries,
//                          REGA_DIFF_REPORT: markdown report file)

const fs = require('fs');
const path = require('path');

const {
    regaLabel,
    regaPreload,
    regaArch,
    indent,
    initTest,
    cleanupTest,
    workerPorts,
    workerDir,
    regaInstance,
    ReGaInstance
} = require('../lib/helper.js');
const {
    parseCorpus, writeCorpus, execScript, scriptVars, expectedOutput
} = require('../lib/corpus.js');

require('should');

const corpusDir = path.join(__dirname, 'corpus');
const record = process.env.REGA_CORPUS_RECORD === '1';
const filter = process.env.REGA_CORPUS ? new RegExp(process.env.REGA_CORPUS) : null;
const refBin = process.env.REGA_REF_BIN || '';
const refLibDir = process.env.REGA_REF_LIB_DIR || '';
const diffReport = process.env.REGA_DIFF_REPORT || '';

const corpusFiles = fs.readdirSync(corpusDir)
    .filter(file => file.endsWith('.rega') && (!filter || filter.test(file)))
    .toSorted()
    .map(file => path.join(corpusDir, file));

// differences between the ReGaHss under test and the reference ReGaHss
const differences = [];
let comparedCases = 0;

function describeDifference(actual, reference) {
    const lines = [];
    if (actual.output !== reference.output) {
        lines.push('output: ' + JSON.stringify(reference.output) + ' → ' + JSON.stringify(actual.output));
    }

    const actualVars = scriptVars(actual.objects);
    const referenceVars = scriptVars(reference.objects);
    for (const key of new Set([...Object.keys(referenceVars), ...Object.keys(actualVars)])) {
        if (actualVars[key] !== referenceVars[key]) {
            lines.push(key + ': ' + JSON.stringify(referenceVars[key]) + ' → ' + JSON.stringify(actualVars[key]));
        }
    }

    if (JSON.stringify(actual.errors) !== JSON.stringify(reference.errors)) {
        lines.push('errors: ' + JSON.stringify(reference.errors) + ' → ' + JSON.stringify(actual.errors));
    }

    return lines;
}

function writeDiffReport() {
    if (!diffReport) {
        return;
    }

    const lines = [
        `Reference: \`${refBin}\`, ${comparedCases} cases compared, ${differences.length} with different results.`,
        ''
    ];
    for (const difference of differences) {
        lines.push(`- **${difference.file}** › ${difference.name}:`, ...difference.lines.map(line => '  - `' + line.replaceAll('`', '\'').slice(0, 300) + '`'));
    }

    fs.mkdirSync(path.dirname(path.resolve(diffReport)), {recursive: true});
    fs.writeFileSync(diffReport, lines.join('\n') + '\n');
}

// reference instances (one per fixed time, kept running for all corpus
// files, as older ReGaHss versions cannot bind their ports again immediately
// after a restart); port offsets within the ports of the worker
const references = new Map();
const referencePorts = [[5, 6], [7, 8]];

async function referenceInstance(fixedTime) {
    const key = fixedTime || '';
    if (!references.has(key)) {
        const offsets = referencePorts[references.size];
        if (offsets === undefined) {
            references.set(key, null);
            console.log(indent('no ports left for a reference instance with fixed time ' + fixedTime, 8));
        } else {
            const base = workerPorts();
            const instance = new ReGaInstance({
                bin: refBin,
                libDir: refLibDir,
                label: 'reference',
                name: 'reference',
                fixedTime,
                ports: {...base, http: base.http + offsets[0], xmlrpc: base.http + offsets[1]},
                workDir: workerDir('-ref' + references.size),
                preload: ''
            });
            references.set(key, instance);
            await instance.start({testFile: path.join(corpusDir, 'reference' + (fixedTime ? '-fixed-time' : '') + '.rega')});
            await instance.ready();
        }
    }

    return references.get(key);
}

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    if (refBin) {
        after(async function () {
            this.timeout(60_000);
            for (const instance of references.values()) {
                if (instance) {
                    // eslint-disable-next-line no-await-in-loop
                    await instance.stop();
                }
            }

            writeDiffReport();
        });
    }

    for (const file of corpusFiles) {
        const corpus = parseCorpus(file);
        const name = path.basename(file);
        const fixedTime = corpus.directives['fixed-time'] || null;

        describe('corpus ' + name + (fixedTime ? ' @ ' + fixedTime : ''), function () {
            initTest({sim: false, fixedTime});

            // reference ReGaHss for differential tests
            let reference = null;
            if (refBin && !(fixedTime && regaPreload)) {
                before(async function () {
                    this.timeout(60_000);
                    reference = await referenceInstance(fixedTime);
                });
            }

            describe('running script corpus', function () {
                for (const testcase of corpus.cases) {
                    it(testcase.name, async function () {
                        this.timeout(30_000);
                        const location = '(' + name + ':' + testcase.line + ')';
                        const result = await execScript(regaInstance(), testcase.source);

                        if (reference) {
                            comparedCases += 1;
                            const referenceResult = await execScript(reference, testcase.source);
                            const lines = describeDifference(result, referenceResult);
                            if (lines.length > 0) {
                                differences.push({file: name, name: testcase.name, lines});
                                console.log(indent('differs from reference: ' + lines.join('; '), 8));
                            }
                        }

                        if (record) {
                            testcase.recorded = result;
                            return;
                        }

                        const output = expectedOutput(testcase, regaArch);
                        if (output === null) {
                            throw new Error('no expected output recorded ' + location + ', record it with REGA_CORPUS_RECORD=1');
                        }

                        result.output.should.equal(output, 'output of "' + testcase.name + '" ' + location);
                        if (testcase.expectedVars !== null) {
                            scriptVars(result.objects).should.deepEqual(testcase.expectedVars, 'variables of "' + testcase.name + '" ' + location);
                        }

                        result.errors.should.deepEqual(testcase.expectedErrors, 'logged errors of "' + testcase.name + '" ' + location);
                    });
                }
            });

            if (record) {
                after(function () {
                    if (corpus.cases.some(testcase => testcase.recorded)) {
                        writeCorpus(corpus);
                    }
                });
            }

            cleanupTest();
        });
    }
});
