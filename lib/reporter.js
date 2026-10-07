// Mocha reporter: the output of the spec reporter plus (if a file name is
// given via REGA_JUNIT_FILE or --reporter-option junit=<file>) a JUnit XML
// report. Works in serial and parallel mode.

const fs = require('fs');
const path = require('path');
const Mocha = require('mocha');

const {EVENT_TEST_PASS, EVENT_TEST_FAIL, EVENT_TEST_PENDING, EVENT_RUN_END} = Mocha.Runner.constants;

function escapeXml(value) {
    return String(value)
        // (characters not allowed in XML 1.0, e.g. ANSI escape sequences)
        // eslint-disable-next-line no-control-regex
        .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function seconds(ms) {
    return ((ms || 0) / 1000).toFixed(3);
}

function writeJunit(file, testcases, cwd) {
    const suites = new Map();
    for (const testcase of testcases) {
        const name = testcase.file ? path.relative(cwd, testcase.file) : testcase.path[0];
        if (!suites.has(name)) {
            suites.set(name, []);
        }

        suites.get(name).push(testcase);
    }

    const count = (cases, state) => cases.filter(testcase => testcase.state === state).length;
    const time = cases => cases.reduce((sum, testcase) => sum + (testcase.duration || 0), 0);
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<testsuites name="ReGaHss-Test" tests="${testcases.length}" failures="${count(testcases, 'failed')}" errors="0" skipped="${count(testcases, 'skipped')}" time="${seconds(time(testcases))}">`
    ];
    for (const [name, cases] of suites) {
        lines.push(`  <testsuite name="${escapeXml(name)}" tests="${cases.length}" failures="${count(cases, 'failed')}" errors="0" skipped="${count(cases, 'skipped')}" time="${seconds(time(cases))}">`);
        for (const testcase of cases) {
            const classname = testcase.path.slice(0, -1).join(' › ');
            const title = testcase.path.at(-1);
            const attributes = `classname="${escapeXml(classname)}" name="${escapeXml(title)}" time="${seconds(testcase.duration)}"`;
            if (testcase.state === 'failed') {
                const error = testcase.err || {};
                const message = String(error.message || error).split('\n')[0];
                lines.push(
                    `    <testcase ${attributes}>`,
                    `      <failure message="${escapeXml(message)}" type="${escapeXml(error.name || 'Error')}">${escapeXml(error.stack || error.message || error)}</failure>`,
                    '    </testcase>'
                );
            } else if (testcase.state === 'skipped') {
                lines.push(`    <testcase ${attributes}>`, '      <skipped/>', '    </testcase>');
            } else {
                lines.push(`    <testcase ${attributes}/>`);
            }
        }

        lines.push('  </testsuite>');
    }

    lines.push('</testsuites>', '');
    fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
    fs.writeFileSync(file, lines.join('\n'));
}

class Reporter extends Mocha.reporters.Spec {
    constructor(runner, options = {}) {
        super(runner, options);
        const reporterOptions = options.reporterOption || options.reporterOptions || {};
        const file = reporterOptions.junit || process.env.REGA_JUNIT_FILE;
        if (!file) {
            return;
        }

        const testcases = [];
        const add = (test, state, error) => {
            testcases.push({
                file: test.file || '',
                path: test.titlePath(),
                duration: test.duration,
                state,
                err: error
            });
        };

        runner.on(EVENT_TEST_PASS, test => add(test, 'passed'));
        runner.on(EVENT_TEST_FAIL, (test, error) => add(test, 'failed', error));
        runner.on(EVENT_TEST_PENDING, test => add(test, 'skipped'));
        runner.once(EVENT_RUN_END, () => writeJunit(file, testcases, process.cwd()));
    }
}

module.exports = Reporter;
