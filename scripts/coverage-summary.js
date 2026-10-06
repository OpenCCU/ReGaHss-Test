#!/usr/bin/env node
// Converts a gcovr JSON summary (--json-summary) into a markdown table.
//
// Usage: coverage-summary.js <summary.json>

const fs = require('fs');

const summary = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function percent(value) {
    return value === null || value === undefined ? '-' : value + '%';
}

function row(name, data) {
    return `| ${name} | ${percent(data.line_percent)} (${data.line_covered}/${data.line_total}) | ${percent(data.function_percent)} | ${percent(data.branch_percent)} |`;
}

console.log('| File | Lines | Functions | Branches |');
console.log('|---|---|---|---|');
for (const file of summary.files) {
    console.log(row('`' + file.filename + '`', file));
}

console.log(row('**total**', summary));
