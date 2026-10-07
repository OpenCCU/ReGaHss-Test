// Mocha configuration of the ReGaHss test suite
//
//   REGA_JOBS=<n>         run the test files in <n> parallel worker processes
//                         (each with its own ReGaHss instance and ports)
//   REGA_JUNIT_FILE=<f>   additionally write a JUnit XML report

const fs = require('fs');
const path = require('path');

const jobs = Number(process.env.REGA_JOBS || 1);

// Test files with long running tests (timer tests) first, so that they do not
// delay the end of a parallel test run
const isSlow = file => /^0[5-7]/.test(file);
// (only if no test files are given on the command line, as mocha would run
// them in addition to the configured ones)
const cliSpec = process.argv.slice(2).some(arg => /(^|\/)test\/[^/]+\.js$/.test(arg));
const testDir = path.join(__dirname, 'test');
const files = fs.readdirSync(testDir).filter(file => file.endsWith('.js')).toSorted();
const spec = [
    ...files.filter(file => isSlow(file)).toReversed(),
    ...files.filter(file => !isSlow(file))
].map(file => path.join('test', file));

module.exports = {
    ...(cliSpec ? {} : {spec}),
    reporter: path.join(__dirname, 'lib', 'reporter.js'),
    parallel: jobs > 1,
    jobs: Math.max(jobs, 1)
};
