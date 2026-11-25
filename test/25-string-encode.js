/* global describe, it, before */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Tests the string methods HtmlEncode(), HtmlEncodeKeepEntities() and
// JsEncode(), which replace the chains of Replace() calls the WebUI uses to
// escape texts for HTML and for JavaScript string literals.
// see https://github.com/OpenCCU/OpenCCU-Base/pull/419

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    regaInstance,
    requireRegaVersion
} = require('../lib/helper.js');

require('should');

/**
 * Returns a ReGa string literal for a string (Latin-1, the script is sent as
 * Latin-1).
 *
 * @param {string} string - string of the literal
 * @returns {string} the literal
 */
function regaLiteral(string) {
    return '"' + string
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\r', '\\r')
        .replaceAll('\n', '\\n')
        .replaceAll('\t', '\\t') + '"';
}

/**
 * Returns the result of a string method of ReGaHss for a string.
 *
 * @param {string} string - string the method is called for
 * @param {string} method - name of the method
 * @returns {Promise<string>} the result
 */
async function encode(string, method) {
    // (the result is enclosed in brackets, so that line breaks and trailing
    // spaces are kept)
    const {output, objects} = await rega.exec(`string s = ${regaLiteral(string)}; string r = s.${method}(); Write("[" # r # "]");`);
    // (the string the method is called for is not changed)
    objects.s.should.equal(string);
    output.should.startWith('[').and.endWith(']');
    return output.slice(1, -1);
}

// all Latin-1 characters except NUL (a ReGa string ends at NUL)
const allChars = Array.from({length: 255}, (_, index) => String.fromCodePoint(index + 1)).join('');

/**
 * Decodes the character references HtmlEncode() creates (like a browser
 * decodes HTML text and attribute values).
 *
 * @param {string} html - encoded text
 * @returns {string} decoded text
 */
function decodeHtml(html) {
    const references = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\''
    };
    return html.replaceAll(/&(?:amp|lt|gt|quot|#39);/g, reference => references[reference]);
}

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest(false);

    // added in ReGaHss R1.00.0388.0271
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0271');
    });

    describe('HtmlEncode()', function () {
        const cases = [
            ['', ''],
            ['abc', 'abc'],
            ['a&b<c>d"e\'f', 'a&amp;b&lt;c&gt;d&quot;e&#39;f'],
            ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
            ['&#176;C', '&amp;#176;C'],
            ['&deg;C', '&amp;deg;C'],
            ['&amp;', '&amp;amp;'],
            ['°C äöüß ©', '°C äöüß ©'],
            ['line 1\r\nline 2\ttab', 'line 1\r\nline 2\ttab'],
            ['"""', '&quot;&quot;&quot;']
        ];
        for (const [input, expected] of cases) {
            it(`should encode ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, async function () {
                const result = await encode(input, 'HtmlEncode');
                result.should.equal(expected);
            });
        }

        it('should encode all characters so that decoding the result yields the string again', async function () {
            const result = await encode(allChars, 'HtmlEncode');
            result.should.not.match(/[<>"']/);
            result.should.not.match(/&(?!(?:amp|lt|gt|quot|#39);)/);
            decodeHtml(result).should.equal(allChars);
        });

        it('should return the same as the Replace() chain of the WebUI with encoded quotes', async function () {
            const {output} = await rega.exec(`
string s = ${regaLiteral(allChars)};
string r1 = s.HtmlEncode();
string r2 = s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\\"", "&quot;").Replace("'", "&#39;");
WriteLine(r1 == r2);
            `);
            output.should.equal('true\r\n');
        });
    });

    describe('HtmlEncodeKeepEntities()', function () {
        const cases = [
            ['', ''],
            ['%', '%'],
            // the character references of units, e.g. of CUxD devices or
            // entered for system variables, are kept
            ['&#176;C', '&#176;C'],
            ['&#xB0;C', '&#xB0;C'],
            ['&#XB0;C', '&#XB0;C'],
            ['&#xb0;C', '&#xb0;C'],
            ['&deg;C', '&deg;C'],
            ['&euro;', '&euro;'],
            ['m&sup2;', 'm&sup2;'],
            ['&#60;b&#62;', '&#60;b&#62;'],
            ['&amp;lt;', '&amp;lt;'],
            ['A&B; &#176;', 'A&B; &#176;'],
            // but no markup
            ['<b>m</b>', '&lt;b&gt;m&lt;/b&gt;'],
            ['"&#176;"', '&quot;&#176;&quot;'],
            ['x\'&q', 'x&#39;&amp;q'],
            // an '&' which does not start a character reference is encoded
            ['&', '&amp;'],
            ['&#', '&amp;#'],
            ['&#;', '&amp;#;'],
            ['&#x;', '&amp;#x;'],
            ['&#xG0;', '&amp;#xG0;'],
            ['&#12a;', '&amp;#12a;'],
            ['&deg', '&amp;deg'],
            ['& deg;', '&amp; deg;'],
            ['&1a;', '&amp;1a;'],
            ['&&deg;', '&amp;&deg;'],
            ['&dég;', '&amp;dég;'],
            ['°C', '°C']
        ];
        for (const [input, expected] of cases) {
            it(`should encode ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, async function () {
                const result = await encode(input, 'HtmlEncodeKeepEntities');
                result.should.equal(expected);
            });
        }

        it('should return the same as HtmlEncode() for a string without character references', async function () {
            const chars = allChars.replaceAll(/[\da-z#;]/gi, '');
            const result = await encode(chars, 'HtmlEncodeKeepEntities');
            result.should.equal(await encode(chars, 'HtmlEncode'));
        });
    });

    describe('JsEncode()', function () {
        const cases = [
            ['', ''],
            ['abc äöüß °©', 'abc äöüß °©'],
            ['\\', String.raw`\x5C`],
            ['\'', String.raw`\x27`],
            ['"', String.raw`\x22`],
            ['<>&', String.raw`\x3C\x3E\x26`],
            ['a\r\nb\tc', String.raw`a\x0D\x0Ab\x09c`],
            ['</script>', String.raw`\x3C/script\x3E`],
            ['It\'s "x" \\ y', String.raw`It\x27s \x22x\x22 \x5C y`],
            ['&#176;C', String.raw`\x26#176;C`]
        ];
        for (const [input, expected] of cases) {
            it(`should encode ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, async function () {
                const result = await encode(input, 'JsEncode');
                result.should.equal(expected);
            });
        }

        it('should encode all characters so that the result is a valid JavaScript string literal in single or double quotes', async function () {
            const result = await encode(allChars, 'JsEncode');
            // (no character which ends the literal, a <script> element or an
            // HTML attribute value or starts a character reference; no line
            // break or other control character)
            // eslint-disable-next-line no-control-regex
            result.should.not.match(/["'<>&\u0000-\u001F\u007F]/);
            result.should.not.match(/\\(?!x[\dA-F]{2})/);
            // eslint-disable-next-line no-new-func
            new Function('return \'' + result + '\';')().should.equal(allChars);
            // eslint-disable-next-line no-new-func
            new Function('return "' + result + '";')().should.equal(allChars);
        });
    });

    describe('method calls', function () {
        it('should call the methods on the result of other methods and expressions', async function () {
            const {output} = await rega.exec(`
integer i = 42;
WriteLine(i.ToString().HtmlEncode() # " " # "a<b".HtmlEncode().Length() # " " # ("<" # "&#176;").HtmlEncodeKeepEntities() # " " # "<'>".HtmlEncode().JsEncode());
            `);
            output.should.equal('42 6 &lt;&#176; \\x26lt;\\x26#39;\\x26gt;\r\n');
        });
    });

    describe('maximum string length', function () {
        // (like for '#' and Replace(), a result longer than 32 MiB ends the
        // script with a runtime error)
        for (const [method, char, factor] of [['HtmlEncode', '"', 6], ['HtmlEncodeKeepEntities', '"', 6], ['JsEncode', '<', 4]]) {
            it(`should end a script creating a string longer than 32 MiB with ${method}() with a runtime error`, async function () {
                this.timeout(60_000);
                const logged = regaInstance().waitFor(new RegExp(method + String.raw`\(\) exceeds the maximum string length of 33554432 characters`), {buffered: false, timeout: 30_000});
                // (the longest string which is encoded to at most 32 MiB, and
                // one more character, which exceeds the limit; built from
                // blocks of 1 MiB)
                const fit = Math.floor((32 * 1024 * 1024) / factor);
                const blocks = Math.ceil((fit + 1) / (1024 * 1024));
                const {output} = await rega.exec(`
string a = ${regaLiteral(char)};
integer b = 0;
while (b < 20) {
  b = b + 1;
  a = a # a;
}
string m = "";
b = 0;
while (b < ${blocks}) {
  b = b + 1;
  m = m # a;
}
string r = "";
if (true) {
  r = m.Substr(0, ${fit}).${method}();
  Write(r.Length());
  r = m.Substr(0, ${fit + 1}).${method}();
  Write(" not reached");
}
WriteLine(" " # r.Length());
                `);
                // (like for other runtime errors in an assignment, the
                // variable is set to the string the method was called for)
                output.should.equal(`${fit * factor} ${fit + 1}\r\n`);
                await logged;
                regaInstance().running.should.be.true();
            });
        }
    });

    cleanupTest();
});
