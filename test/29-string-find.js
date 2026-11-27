/* global describe, it, before */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Tests the string methods Find() with the optional parameters start position
// and number of the occurrence, and StringBetween(), which return a position
// or a part of a string without creating copies of the string with Substr().
// see https://github.com/OpenCCU/OpenCCU/issues/346
// see https://github.com/OpenCCU/OpenCCU/issues/527

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    requireRegaVersion
} = require('../lib/helper.js');

require('should');

/**
 * Returns a ReGa literal for a string or a number.
 *
 * @param {string|number} value - value of the literal
 * @returns {string} the literal
 */
function regaLiteral(value) {
    if (typeof value === 'number') {
        return String(value);
    }

    return '"' + value
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\t', '\\t') + '"';
}

/**
 * Returns the result of a string method of ReGaHss for a string.
 *
 * @param {string} string - string the method is called for
 * @param {string} method - name of the method
 * @param {Array<string|number>} args - parameters of the method
 * @returns {Promise<string>} the result
 */
async function call(string, method, args) {
    // (the result is enclosed in brackets, so that an empty one is seen)
    const {output, objects} = await rega.exec(`string s = ${regaLiteral(string)}; var r = s.${method}(${args.map(arg => regaLiteral(arg)).join(', ')}); Write("[" # r # "]");`);
    // (the string the method is called for is not changed)
    objects.s.should.equal(string);
    output.should.startWith('[').and.endWith(']');
    return output.slice(1, -1);
}

const table = '<td>key</td><td>value</td>';

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest(false);

    // added in ReGaHss R1.00.0388.0273
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0273');
    });

    describe('Find()', function () {
        const cases = [
            // the first occurrence (as before)
            ['abcabc', ['b'], '1'],
            ['abcabc', ['x'], '-1'],
            ['abc', [''], '0'],
            ['', [''], '-1'],
            ['', ['x'], '-1'],
            // searched from a start position
            ['abcabc', ['b', 0], '1'],
            ['abcabc', ['b', 1], '1'],
            ['abcabc', ['b', 2], '4'],
            ['abcabc', ['c', 5], '5'],
            ['abcabc', ['b', 5], '-1'],
            ['abcabc', ['b', 6], '-1'],
            ['abcabc', ['b', 100], '-1'],
            ['abcabc', ['b', -5], '1'],
            ['abc', ['', 1], '1'],
            ['abc', ['', 3], '-1'],
            ['', ['x', 0], '-1'],
            // the n-th occurrence from a start position
            [table, ['<td>', 0, 2], '12'],
            [table, ['<td>', 0, 1], '0'],
            [table, ['<td>', 0, 3], '-1'],
            [table, ['</td>', 0, 2], '21'],
            [table, ['<td>', 1, 1], '12'],
            [table, ['<td>', 13, 1], '-1'],
            ['abcabc', ['b', 2, 1], '4'],
            ['abcabc', ['b', 0, 2], '4'],
            ['abcabc', ['b', -1, 2], '4'],
            ['abcabc', ['b', 0, 0], '-1'],
            ['abcabc', ['b', 0, -1], '-1'],
            ['abcabc', ['b', 0, 1000], '-1'],
            ['abcabc', ['x', 0, 1], '-1'],
            ['abcabc', ['b', 10, 1], '-1'],
            // (overlapping occurrences count)
            ['aaa', ['aa', 0, 2], '1'],
            ['aaaa', ['aa', 1, 2], '2'],
            ['aaa', ['aa', 0, 3], '-1'],
            ['abc', ['', 0, 3], '2']
        ];
        for (const [string, args, expected] of cases) {
            it(`should return ${expected} for ${JSON.stringify(string)}.Find(${args.map(arg => JSON.stringify(arg)).join(', ')})`, async function () {
                const result = await call(string, 'Find', args);
                result.should.equal(expected);
            });
        }

        it('should return an integer', async function () {
            const {output} = await rega.exec('string s = "abcabc"; var a = s.Find("b"); var b = s.Find("b", 2); var c = s.Find("b", 0, 2); var d = s.Find("x", 0, 2); Write(a.VarType() # "|" # b.VarType() # "|" # c.VarType() # "|" # d.VarType() # "|" # (c + d));');
            output.should.equal('2|2|2|2|3');
        });

        it('should return the same for the first occurrence from position 0 as without them', async function () {
            const {output} = await rega.exec(`
string s = ${regaLiteral(table)};
string k;
foreach (k, "<td>\\t</td>\\tvalue\\tx\\t>") {
  Write((s.Find(k) == s.Find(k, 0)) # (s.Find(k) == s.Find(k, 0, 1)) # ";");
}
`);
            output.should.equal('truetrue;'.repeat(5));
        });

        it('should take the parameters from expressions', async function () {
            const {output} = await rega.exec(`
string s = ${regaLiteral(table)};
integer i = 1;
Write(s.Find("<" # "td>", i - 1, i + 1) # "|" # s.Find("<td>", s.Find("</td>")) # "|" # s.Find("</td>", 1.9, "2"));
`);
            output.should.equal('12|12|21');
        });

        it('should find all occurrences one after another', async function () {
            const {output} = await rega.exec(`
string s = "a,b,,c,";
integer p = s.Find(",");
while (p >= 0) {
  Write(p # ";");
  p = s.Find(",", p + 1);
}
`);
            output.should.equal('1;3;4;6;');
        });

        it('should parse the cells of a table', async function () {
            const {output} = await rega.exec(`
string s = "<tr><td>t1</td><td>21.5</td></tr><tr><td>t2</td><td>19.0</td></tr>";
integer p = s.Find("<td>");
integer e;
while (p >= 0) {
  e = s.Find("</td>", p);
  Write(s.Substr(p + 4, e - (p + 4)) # ";");
  p = s.Find("<td>", e);
}
Write("|" # s.Substr(s.Find("<td>", 0, 4) + 4, 4));
`);
            output.should.equal('t1;21.5;t2;19.0;|19.0');
        });
    });

    describe('StringBetween()', function () {
        const cases = [
            [table, ['<td>', '</td>'], 'key'],
            ['a[b]c[d]', ['[', ']'], 'b'],
            ['key=value;next=1;', ['key=', ';'], 'value'],
            ['xAx', ['x', 'x'], 'A'],
            ['[[x]]', ['[', ']'], '[x'],
            ['a[]b', ['[', ']'], ''],
            ['xx', ['x', 'x'], ''],
            // (the end is searched after the start)
            ['a]b[c]', ['[', ']'], 'c'],
            ['abcabc', ['b', 'b'], 'ca'],
            // empty start: from the beginning, empty end: to the end
            ['a[b]c', ['', '['], 'a'],
            ['a[b]c', [']', ''], 'c'],
            ['abc', ['', ''], 'abc'],
            ['abc', ['', 'a'], ''],
            ['abc', ['c', ''], ''],
            ['abc', ['abc', ''], ''],
            // start or end not found
            ['abc', ['x', ']'], ''],
            ['a[bc', ['[', ']'], ''],
            ['a]b[c', ['[', ']'], ''],
            ['abc', ['', 'x'], ''],
            ['abc', ['x', ''], ''],
            ['abc', ['c', 'c'], ''],
            ['', ['', ''], ''],
            ['', ['[', ']'], ''],
            // Latin-1 characters and tabs
            ['°C: 21,5\tÄnderung', ['°C: ', '\t'], '21,5'],
            ['a\tb\tc', ['\t', '\t'], 'b']
        ];
        for (const [string, args, expected] of cases) {
            it(`should return ${JSON.stringify(expected)} for ${JSON.stringify(string)}.StringBetween(${args.map(arg => JSON.stringify(arg)).join(', ')})`, async function () {
                const result = await call(string, 'StringBetween', args);
                result.should.equal(expected);
            });
        }

        it('should return a string', async function () {
            const {output} = await rega.exec('string s = "a12b"; var a = s.StringBetween("a", "b"); var b = s.StringBetween("x", "b"); Write(a.VarType() # "|" # b.VarType() # "|" # a # "|" # b);');
            output.should.equal('4|4|12|');
        });

        it('should be chained and take the parameters from expressions', async function () {
            const {output} = await rega.exec(`
string s = "<tr><td>t1</td><td>21.5</td></tr><tr><td>t2</td><td>19.0</td></tr>";
string td = "td";
Write(s.StringBetween("</tr>", "").StringBetween("<" # td # ">", "</" # td # ">") # "|" # s.Substr(s.Find("<td>", 0, 4)).StringBetween("<td>", "</td>"));
`);
            output.should.equal('t2|19.0');
        });
    });

    cleanupTest();
});
