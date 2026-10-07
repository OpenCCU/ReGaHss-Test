/* eslint-disable capitalized-comments */

// Data driven ReGaHss script test corpus (test/corpus/*.rega).
//
// A corpus file consists of optional directives followed by test cases:
//
//   !! faketime: 2024-06-15 12:00:00 CEST
//
//   #### string concatenation
//   string s = "a" # "b";
//   WriteLine(s);
//   ---- output
//   ab
//   ---- vars
//   s=ab
//   ----
//
// The output section contains the expected output of the script, each line
// of the section stands for a line terminated by CR LF (WriteLine). Special
// characters are escaped (\r, \n, \t, \\), a trailing "\c" marks output
// without a final line break. The optional vars section lists the expected
// values of the script variables, the errors section (only present if there
// were any) the errors the script engine logged. Expected values are
// recorded from a
// ReGaHss binary (REGA_CORPUS_RECORD=1), which documents its behaviour and
// detects any change of it in other releases.

const fs = require('fs');

const caseHeader = '#### ';
const outputHeader = '---- output';
const varsHeader = '---- vars';
const errorsHeader = '---- errors';
const endMarker = '----';

// variables every /rega.exe response contains
const ignoredVars = new Set(['exec', 'sessionId', 'httpUserAgent']);

function escape(text) {
    return text
        .replaceAll('\\', '\\\\')
        .replaceAll('\r', String.raw`\r`)
        .replaceAll('\n', String.raw`\n`)
        .replaceAll('\t', String.raw`\t`);
}

// unescapes a line, a trailing \c marks output without final line break
function unescapeLine(text) {
    let noEol = false;
    const result = text.replaceAll(/\\([\\rntc])/g, (match, char, offset) => {
        if (char === 'c') {
            if (offset + match.length === text.length) {
                noEol = true;
                return '';
            }

            return match;
        }

        return {
            '\\': '\\', r: '\r', n: '\n', t: '\t'
        }[char];
    });
    return {text: result, noEol};
}

/**
 * @param {string} output - script output
 * @returns {string[]} lines of the output section
 */
function encodeOutput(output) {
    if (output === '') {
        return [];
    }

    const parts = output.split('\r\n');
    if (parts.at(-1) === '') {
        parts.pop();
    } else {
        parts[parts.length - 1] += '\u0000';
    }

    return parts.map(part => escape(part).replace('\u0000', String.raw`\c`));
}

/**
 * @param {string[]} lines - lines of the output section
 * @returns {string} expected script output
 */
function decodeOutput(lines) {
    if (lines.length === 0) {
        return '';
    }

    const parts = lines.map(line => unescapeLine(line));
    const output = parts.map(part => part.text).join('\r\n');
    return parts.at(-1).noEol ? output : output + '\r\n';
}

/**
 * @param {Object<string, string>} objects - variables of a script response
 * @returns {string[]} lines of the vars section
 */
function encodeVars(objects) {
    return Object.entries(objects)
        .filter(([name]) => !ignoredVars.has(name))
        .map(([name, value]) => name + '=' + escape(String(value)));
}

function decodeVars(lines) {
    const vars = {};
    for (const line of lines) {
        const index = line.indexOf('=');
        vars[line.slice(0, index)] = unescapeLine(line.slice(index + 1)).text;
    }

    return vars;
}

/**
 * Selects the variables listed in the vars section of a case from a response.
 *
 * @param {Object<string, string>} objects
 * @returns {Object<string, string>}
 */
function scriptVars(objects) {
    return decodeVars(encodeVars(objects));
}

// log line of the script engine: [time] ERROR: <message> [<function>():iseESP<file>.cpp:<line>]
const timestampRx = /^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [A-Z]+] /;
const errorRx = /^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [A-Z]+] ERROR: (.*)$/;
const sourceRx = /\s*\[\w+\(\):(\w+)\.cpp:\d+]$/;

/**
 * Extracts the errors of the script engine (source files iseESP*) from log
 * lines: the first line of each message without time stamp and source
 * location (which differ between releases).
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function scriptErrors(lines) {
    const errors = [];
    let message = null;
    const finish = line => {
        const source = sourceRx.exec(line);
        if (source) {
            const text = message[0].replace(sourceRx, '');
            const syntaxError = /^(SyntaxError: Error \d+ at row \d+ col \d+) near /.exec(text);
            if (!source[1].startsWith('iseESP')) {
                // (no error of the script engine)
            } else if (syntaxError) {
                // (the text after the error position is not reliable: at the end
                // of a script it shows the content of an unrelated buffer)
                errors.push(syntaxError[1]);
            } else if (!text.startsWith('SyntaxError: ')) {
                // (the second line of a syntax error repeats the text again)
                errors.push(text);
            }

            message = null;
        }
    };

    for (const line of lines) {
        const error = errorRx.exec(line);
        if (error) {
            message = [error[1]];
            finish(line);
        } else if (message && !timestampRx.test(line)) {
            // (continuation of a multi-line message)
            finish(line);
        } else {
            message = null;
        }
    }

    return errors;
}

let markerCounter = 0;

/**
 * Executes a script and collects the errors the script engine logs for it.
 *
 * @param {import('./rega-instance.js').ReGaInstance} instance
 * @param {string} script
 * @returns {Promise<{output: string, objects: Object<string, string>, errors: string[]}>}
 */
async function execScript(instance, script) {
    const lines = [];
    const untap = instance.log.tap(line => lines.push(line));
    try {
        const result = await instance.exec(script);
        // all log lines of the script have been received once the runtime
        // error of a subsequent marker script (which logs the script) is logged
        markerCounter += 1;
        const marker = 'corpus_marker_' + process.pid + '_' + markerCounter;
        await Promise.all([
            instance.waitFor(new RegExp(marker), {timeout: 10_000, buffered: false}),
            instance.exec('dom.GetObject("' + marker + '").Name();')
        ]);
        result.errors = scriptErrors(lines.filter(line => !line.includes('corpus_marker_')));
        return result;
    } finally {
        untap();
    }
}

/**
 * Parses a corpus file.
 *
 * @param {string} file
 * @returns {{file: string, directives: Object<string, string>, header: string[], cases: object[]}}
 */
function parseCorpus(file) {
    const lines = fs.readFileSync(file, 'latin1').replaceAll('\r\n', '\n').split('\n');
    if (lines.at(-1) === '') {
        lines.pop();
    }

    const corpus = {
        file, directives: {}, header: [], cases: []
    };
    let current = null;
    let section = null;
    const parseLine = (line, index) => {
        if (line.startsWith(caseHeader)) {
            current = {
                name: line.slice(caseHeader.length).trim(), line: index + 1, script: [], output: null, vars: null, errors: []
            };
            corpus.cases.push(current);
            section = 'script';
            return;
        }

        if (current === null) {
            corpus.header.push(line);
            const directive = /^!! *([\w-]+): *(.*)$/.exec(line);
            if (directive) {
                corpus.directives[directive[1]] = directive[2].trim();
            }

            return;
        }

        switch (line) {
            case outputHeader: {
                current.output = [];
                section = 'output';
                return;
            }

            case varsHeader: {
                current.vars = [];
                section = 'vars';
                return;
            }

            case errorsHeader: {
                current.errors = [];
                section = 'errors';
                return;
            }

            case endMarker: {
                section = null;
                return;
            }

            default: {
                if (section) {
                    current[section].push(line);
                } else if (line.trim() !== '') {
                    throw new Error(file + ':' + (index + 1) + ': unexpected line outside of a section: ' + line);
                }
            }
        }
    };

    for (const [index, line] of lines.entries()) {
        parseLine(line, index);
    }

    for (const testcase of corpus.cases) {
        while (testcase.script.length > 0 && testcase.script.at(-1).trim() === '') {
            testcase.script.pop();
        }

        testcase.source = testcase.script.join('\n');
        testcase.expectedOutput = testcase.output === null ? null : decodeOutput(testcase.output);
        testcase.expectedVars = testcase.vars === null ? null : decodeVars(testcase.vars);
        testcase.expectedErrors = testcase.errors.map(line => unescapeLine(line).text);
    }

    return corpus;
}

/**
 * Writes a corpus file with the recorded results of its cases.
 *
 * @param {object} corpus - parsed corpus, cases with a 'recorded' property {output, objects}
 */
function writeCorpus(corpus) {
    const lines = [...corpus.header];
    for (const testcase of corpus.cases) {
        lines.push(caseHeader + testcase.name, ...testcase.script);
        const {recorded} = testcase;
        lines.push(outputHeader, ...(recorded ? encodeOutput(recorded.output) : testcase.output || []));
        if (testcase.vars !== null) {
            lines.push(varsHeader, ...(recorded ? encodeVars(recorded.objects) : testcase.vars));
        }

        const errors = recorded ? recorded.errors.map(error => escape(error)) : testcase.errors;
        if (errors.length > 0) {
            lines.push(errorsHeader, ...errors);
        }

        lines.push(endMarker, '');
    }

    fs.writeFileSync(corpus.file, lines.join('\n'), 'latin1');
}

module.exports = {
    parseCorpus,
    execScript,
    scriptErrors,
    writeCorpus,
    encodeOutput,
    decodeOutput,
    scriptVars
};
