/* eslint-disable capitalized-comments */

// Data driven ReGaHss script test corpus (test/corpus/*.rega).
//
// A corpus file consists of optional directives followed by test cases:
//
//   !! fixed-time: 2024-06-15 12:00:00 CEST
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
//
// Additional qualified sections "---- output [<qualifier> ...]" (also for
// vars and errors) contain the expected results of other architectures of
// ReGaHss (x86_64, i686, aarch64, arm) or of ReGaHss versions with a changed
// behaviour (>=<version>, e.g. >=R1.00.0388.0266) if they differ, e.g.:
//
//   ---- output
//   null
//   ---- errors
//   ScriptRuntimeError: ...
//   ---- output [>=R1.00.0388.0266]
//   VarBool1
//   ---- errors [>=R1.00.0388.0266]
//   ----
//
// A qualified section applies if all of its qualifiers match (one of its
// architectures, if any, and all of its versions), the last matching one
// replaces the unqualified section (an empty qualified errors section: no
// errors). A development build of ReGaHss (REGA_DEV_BUILD=1, e.g. of a ReGaHss
// pull request) reports the version of the last release but may already
// contain a later change of the behaviour, so the expected results of later
// versions are accepted for it as well.

const fs = require('fs');
const {compareRegaVersions} = require('./version.js');

const caseHeader = '#### ';
const outputHeader = '---- output';
const varsHeader = '---- vars';
const errorsHeader = '---- errors';
const endMarker = '----';
const sectionKinds = ['output', 'vars', 'errors'];
const qualifiedHeaderRx = /^-{4} (output|vars|errors) \[([^\]]*)]$/;
const archQualifierRx = /^[a-z][\w-]*$/;
const versionQualifierRx = /^>=(R\d+(?:\.\d+){3})$/;

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
            } else if (!/^SyntaxError:( |$)/.test(text)) {
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
 * Parses the qualifiers of a qualified section header.
 *
 * @param {string} text - qualifiers, e.g. "aarch64 arm" or ">=R1.00.0388.0266"
 * @param {string} location - file:line for error messages
 * @returns {{qualifiers: string, archs: string[], minVersions: string[]}}
 */
function parseQualifiers(text, location) {
    const result = {qualifiers: text.trim(), archs: [], minVersions: []};
    for (const qualifier of result.qualifiers.split(/\s+/).filter(Boolean)) {
        const version = versionQualifierRx.exec(qualifier);
        if (version) {
            result.minVersions.push(version[1]);
        } else if (archQualifierRx.test(qualifier)) {
            result.archs.push(qualifier);
        } else {
            throw new Error(location + ': invalid qualifier ' + qualifier);
        }
    }

    if (result.archs.length === 0 && result.minVersions.length === 0) {
        throw new Error(location + ': qualified section without qualifiers');
    }

    return result;
}

function decodeSection(kind, lines) {
    switch (kind) {
        case 'output': {
            return decodeOutput(lines);
        }

        case 'vars': {
            return decodeVars(lines);
        }

        default: {
            return lines.map(line => unescapeLine(line).text);
        }
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
                name: line.slice(caseHeader.length).trim(), line: index + 1, script: [], output: null, vars: null, errors: [], qualified: []
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

        // (expected results on other architectures or ReGaHss versions, e.g.
        // "---- output [aarch64 arm]" or "---- errors [>=R1.00.0388.0266]")
        const qualifiedHeader = qualifiedHeaderRx.exec(line);
        if (qualifiedHeader) {
            current.qualified.push({kind: qualifiedHeader[1], ...parseQualifiers(qualifiedHeader[2], file + ':' + (index + 1)), lines: []});
            section = 'qualified';
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
                if (section === 'qualified') {
                    current.qualified.at(-1).lines.push(line);
                } else if (section) {
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
        for (const qualified of testcase.qualified) {
            qualified.expected = decodeSection(qualified.kind, qualified.lines);
        }
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
        // (the recorded results replace the sections applying to the recording
        // ReGaHss, see matchingSection())
        const recordedLines = {
            output: recorded && encodeOutput(recorded.output),
            vars: recorded && encodeVars(recorded.objects),
            errors: recorded && recorded.errors.map(error => escape(error))
        };
        const qualifiedSections = kind => testcase.qualified.flatMap(qualified => qualified.kind === kind
            ? ['---- ' + kind + ' [' + qualified.qualifiers + ']',
                ...(recorded && qualified === recorded.sections[kind] ? recordedLines[kind] : qualified.lines)]
            : []);
        const unqualified = kind => recorded && recorded.sections[kind] === null ? recordedLines[kind] : null;

        lines.push(outputHeader, ...(unqualified('output') || testcase.output || []), ...qualifiedSections('output'));
        if (testcase.vars !== null) {
            lines.push(varsHeader, ...(unqualified('vars') || testcase.vars));
        }

        lines.push(...qualifiedSections('vars'));
        const errors = unqualified('errors') || testcase.errors;
        if (errors.length > 0) {
            lines.push(errorsHeader, ...errors);
        }

        lines.push(...qualifiedSections('errors'), endMarker, '');
    }

    fs.writeFileSync(corpus.file, lines.join('\n'), 'latin1');
}

/**
 * Last qualified section of a kind applying to a ReGaHss.
 *
 * @param {object} testcase - parsed case
 * @param {string} kind - output, vars or errors
 * @param {{arch: string, version: ?string}} rega - architecture (x86_64, i686,
 *     aarch64, arm) and version of ReGaHss
 * @returns {?object} the qualified section or null (unqualified section applies)
 */
function matchingSection(testcase, kind, {arch, version}) {
    const matching = testcase.qualified.filter(qualified => qualified.kind === kind
        && (qualified.archs.length === 0 || qualified.archs.includes(arch))
        && qualified.minVersions.every(minVersion => {
            if (!version) {
                throw new Error('version of ReGaHss required for "' + testcase.name + '" (line ' + testcase.line + ')');
            }

            return compareRegaVersions(version, minVersion) >= 0;
        }));
    return matching.at(-1) || null;
}

/**
 * Expected results of a case for a ReGaHss: the results for its version and,
 * for a development build, also those of the later versions with a changed
 * behaviour (which the build may already contain).
 *
 * @param {object} testcase - parsed case
 * @param {{arch: string, version: ?string, devBuild: boolean}} rega
 * @returns {Array<{version: ?string, output: ?string, vars: ?Object<string, string>, errors: string[]}>}
 *     the expected results, those for the version of ReGaHss first
 */
function expectedResults(testcase, {arch, version, devBuild}) {
    const versions = [version];
    if (devBuild) {
        const later = testcase.qualified.flatMap(qualified => qualified.minVersions)
            .filter(minVersion => !version || compareRegaVersions(minVersion, version) > 0)
            .toSorted(compareRegaVersions);
        versions.push(...new Set(later));
    }

    return versions.map(candidate => {
        const expected = {version: candidate};
        const defaults = {output: testcase.expectedOutput, vars: testcase.expectedVars, errors: testcase.expectedErrors};
        for (const kind of sectionKinds) {
            const qualified = matchingSection(testcase, kind, {arch, version: candidate});
            expected[kind] = qualified ? qualified.expected : defaults[kind];
        }

        return expected;
    });
}

module.exports = {
    parseCorpus,
    matchingSection,
    expectedResults,
    execScript,
    scriptErrors,
    writeCorpus,
    encodeOutput,
    decodeOutput,
    scriptVars
};
