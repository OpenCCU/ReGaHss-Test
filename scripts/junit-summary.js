#!/usr/bin/env node
// Converts the JUnit XML report of the test suite (lib/reporter.js) into a
// markdown summary: results per test file and the failed tests.
//
// Usage: junit-summary.js <junit.xml>

const fs = require('fs');

const maxFailures = 30;

function unescapeXml(value) {
    return value
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&amp;', '&');
}

function attributes(string) {
    const result = {};
    for (const [, name, value] of string.matchAll(/(\w+)="([^"]*)"/g)) {
        result[name] = unescapeXml(value);
    }

    return result;
}

function markdown(value) {
    return value.replaceAll('|', String.raw`\|`).replaceAll('`', '\'').replaceAll(/\s+/g, ' ').trim();
}

const file = process.argv[2];
if (!file) {
    console.error('usage: junit-summary.js <junit.xml>');
    process.exit(1);
}

const xml = fs.readFileSync(file, 'utf8');
const rows = [];
const failures = [];
const total = {
    tests: 0, failures: 0, skipped: 0, time: 0
};
for (const [, suiteAttributes, body] of xml.matchAll(/<testsuite (.*?)>([\s\S]*?)<\/testsuite>/g)) {
    const suite = attributes(suiteAttributes);
    const tests = Number(suite.tests);
    const failed = Number(suite.failures);
    const skipped = Number(suite.skipped);
    const time = Number(suite.time);
    total.tests += tests;
    total.failures += failed;
    total.skipped += skipped;
    total.time += time;
    rows.push(`| ${failed > 0 ? '❌' : '✅'} ${markdown(suite.name)} | ${tests} | ${tests - failed - skipped} | ${failed} | ${skipped} | ${time.toFixed(1)}s |`);
    for (const [, caseAttributes, failure] of body.matchAll(/<testcase ([^>]*?)(?:\/>|>\s*<failure message="([^"]*)"[\s\S]*?<\/testcase>|>[\s\S]*?<\/testcase>)/g)) {
        if (failure !== undefined) {
            const testcase = attributes(caseAttributes);
            failures.push(`- **${markdown(suite.name)}** › ${markdown([...testcase.classname.split(' › ').slice(1), testcase.name].join(' › '))}: \`${markdown(unescapeXml(failure)).slice(0, 300)}\``);
        }
    }
}

const lines = [
    '| Test file | Tests | Passed | Failed | Skipped | Time |',
    '|---|---|---|---|---|---|',
    ...rows,
    `| **Total** | **${total.tests}** | **${total.tests - total.failures - total.skipped}** | **${total.failures}** | **${total.skipped}** | **${total.time.toFixed(1)}s** |`
];
if (failures.length > 0) {
    lines.push('', `**Failed tests (${failures.length}):**`, '', ...failures.slice(0, maxFailures));
    if (failures.length > maxFailures) {
        lines.push(`- ... ${failures.length - maxFailures} more, see junit.xml`);
    }
}

console.log(lines.join('\n'));
