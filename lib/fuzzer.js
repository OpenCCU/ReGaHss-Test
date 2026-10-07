/* eslint-disable no-bitwise */

// Deterministic (seeded) input generators for fuzzing the interfaces of
// ReGaHss: BIN-RPC and XML-RPC requests (libXmlRpc, libxmlparser) to its RPC
// server, HTTP requests to its web server and ReGa scripts for its script
// engine. Each generator returns valid, slightly broken and heavily mutated
// inputs; the same seed always produces the same sequence of inputs.

const net = require('net');

/**
 * Pseudo random number generator (mulberry32).
 *
 * @param {number} seed
 */
function random(seed) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6D_2B_79_F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };

    const rnd = {
        next,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        chance: p => next() < p,
        pick: list => list[Math.floor(next() * list.length)],
        bytes(length) {
            const buffer = Buffer.alloc(length);
            for (let i = 0; i < length; i++) {
                buffer[i] = Math.floor(next() * 256);
            }

            return buffer;
        }
    };
    return rnd;
}

const interestingIntegers = [0, 1, -1, 127, 128, 255, 256, 32_767, 32_768, 65_535, 65_536, 2_147_483_647, -2_147_483_648, 4_294_967_295, 0x7F_FF_FF_FE];
const interestingStrings = [
    '',
    ' ',
    '%s%s%s%n',
    '%x%x%x',
    '\u0000',
    'A'.repeat(1024),
    'A'.repeat(65_536),
    '../../../../etc/passwd',
    'BidCoS-RF:1',
    'BidCoS-RF:1:2:3',
    'HmIP-RF.0000D3C98C9233:1.STATE',
    '<value>',
    ']]>',
    '&amp;',
    '&#0;',
    'ÿþ',
    'ÄÖÜäöüß',
    '\r\n\r\n',
    '"\'\\',
    String.fromCodePoint(0x1_F6_00)
];
const rpcMethods = [
    'event',
    'listDevices',
    'newDevices',
    'deleteDevices',
    'updateDevice',
    'replaceDevice',
    'readdedDevice',
    'reportValueUsage',
    'setReadyConfig',
    'system.multicall',
    'system.listMethods',
    'system.methodHelp',
    'init',
    'getValue',
    ''
];

function randomString(rnd) {
    if (rnd.chance(0.4)) {
        return rnd.pick(interestingStrings);
    }

    const length = rnd.chance(0.9) ? rnd.int(0, 40) : rnd.int(40, 4000);
    return rnd.bytes(length).toString('latin1');
}

/**
 * Random RPC value: {type, value} (types: int, bool, string, double, base64,
 * array, struct).
 */
function randomValue(rnd, depth = 0) {
    const types = depth > 6 ? ['int', 'bool', 'string', 'double'] : ['int', 'bool', 'string', 'double', 'base64', 'array', 'struct', 'array', 'struct'];
    const type = rnd.pick(types);
    switch (type) {
        case 'int': {
            return {type, value: rnd.chance(0.5) ? rnd.pick(interestingIntegers) : rnd.int(-1_000_000, 1_000_000)};
        }

        case 'bool': {
            return {type, value: rnd.chance(0.5)};
        }

        case 'double': {
            return {type, value: rnd.pick([0, -0, 0.5, 1e-300, 1e300, -123.456, Number.MAX_VALUE, Number.MIN_VALUE, rnd.next() * 1e6])};
        }

        case 'base64': {
            return {type, value: rnd.bytes(rnd.int(0, 64))};
        }

        case 'array': {
            const items = [];
            for (let i = rnd.int(0, 5); i > 0; i--) {
                items.push(randomValue(rnd, depth + 1));
            }

            return {type, value: items};
        }

        case 'struct': {
            const members = [];
            for (let i = rnd.int(0, 5); i > 0; i--) {
                members.push([rnd.chance(0.5) ? rnd.pick(['ADDRESS', 'TYPE', 'PARENT', 'CHILDREN', 'PARAMSETS', 'VERSION', 'FLAGS', 'faultCode', 'methodName', 'params']) : randomString(rnd), randomValue(rnd, depth + 1)]);
            }

            return {type, value: members};
        }

        default: {
            return {type: 'string', value: randomString(rnd)};
        }
    }
}

// Plausible parameters of the methods (to get past the parameter checks)
function methodParameters(rnd, method) {
    const string = value => ({type: 'string', value});
    switch (method) {
        case 'event': {
            return [string(rnd.pick(['1007', '1570', 'x', ''])), string(rnd.pick(['BidCoS-RF:1', 'BidCoS-RF:16', 'UNKNOWN:1', ''])), string(rnd.pick(['PRESS_SHORT', 'STATE', 'LEVEL', ''])), randomValue(rnd, 5)];
        }

        case 'system.multicall': {
            const calls = [];
            for (let i = rnd.int(0, 4); i > 0; i--) {
                calls.push({type: 'struct', value: [['methodName', string(rnd.pick(rpcMethods))], ['params', {type: 'array', value: methodParameters(rnd, 'event')}]]});
            }

            return [{type: 'array', value: calls}];
        }

        default: {
            const parameters = [];
            for (let i = rnd.int(0, 4); i > 0; i--) {
                parameters.push(randomValue(rnd, 2));
            }

            return parameters;
        }
    }
}

// BIN-RPC encoding (the counterpart of libXmlRpc's binary protocol)
function int32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(Math.trunc(value) >>> 0);
    return buffer;
}

function binString(value) {
    const data = Buffer.from(value, 'latin1');
    return Buffer.concat([int32(data.length), data]);
}

function binDouble(value) {
    // (mantissa scaled to 2^30 and exponent, like frexp())
    if (value === 0 || !Number.isFinite(value)) {
        return Buffer.concat([int32(0), int32(0)]);
    }

    let exponent = Math.floor(Math.log2(Math.abs(value))) + 1;
    let mantissa = value / (2 ** exponent);
    if (Math.abs(mantissa) >= 1) {
        mantissa /= 2;
        exponent += 1;
    }

    return Buffer.concat([int32(Math.round(mantissa * 0x40_00_00_00)), int32(exponent)]);
}

function binValue({type, value}) {
    switch (type) {
        case 'int': {
            return Buffer.concat([int32(1), int32(value)]);
        }

        case 'bool': {
            return Buffer.concat([int32(2), Buffer.from([value ? 1 : 0])]);
        }

        case 'string': {
            return Buffer.concat([int32(3), binString(value)]);
        }

        case 'double': {
            return Buffer.concat([int32(4), binDouble(value)]);
        }

        case 'base64': {
            return Buffer.concat([int32(0x11), int32(value.length), value]);
        }

        case 'array': {
            return Buffer.concat([int32(0x1_00), int32(value.length), ...value.map(item => binValue(item))]);
        }

        default: {
            return Buffer.concat([int32(0x1_01), int32(value.length), ...value.flatMap(([key, item]) => [binString(key), binValue(item)])]);
        }
    }
}

function binRequest(method, parameters) {
    const body = Buffer.concat([binString(method), int32(parameters.length), ...parameters.map(parameter => binValue(parameter))]);
    return Buffer.concat([Buffer.from('Bin\u0000', 'latin1'), int32(body.length), body]);
}

// XML-RPC encoding
function xmlEscape(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function xmlValue({type, value}, rnd) {
    switch (type) {
        case 'int': {
            return `<value><${rnd.pick(['i4', 'int'])}>${value}</${rnd.pick(['i4', 'int', 'i4'])}></value>`;
        }

        case 'bool': {
            return `<value><boolean>${rnd.chance(0.9) ? Number(value) : rnd.pick(['true', '2', '-1', ''])}</boolean></value>`;
        }

        case 'double': {
            return `<value><double>${rnd.chance(0.9) ? value : rnd.pick(['NaN', '1e999', '-', '1.2.3', ''])}</double></value>`;
        }

        case 'base64': {
            return `<value><base64>${rnd.chance(0.9) ? value.toString('base64') : '!!!==='}</base64></value>`;
        }

        case 'array': {
            return `<value><array><data>${value.map(item => xmlValue(item, rnd)).join('')}</data></array></value>`;
        }

        case 'struct': {
            return `<value><struct>${value.map(([key, item]) => `<member><name>${xmlEscape(key)}</name>${xmlValue(item, rnd)}</member>`).join('')}</struct></value>`;
        }

        default: {
            return rnd.chance(0.5) ? `<value>${xmlEscape(value)}</value>` : `<value><string>${rnd.chance(0.9) ? xmlEscape(value) : value}</string></value>`;
        }
    }
}

const xmlSnippets = [
    '<?xml version="1.0"?>',
    '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">]>',
    '&a;&a;&a;',
    '<![CDATA[x]]>',
    '<!-- comment -->',
    '&#0;',
    '&#xFFFFFFFF;',
    '&unknown;',
    '<value>',
    '</value>',
    '<struct><member>',
    '<array><data>',
    '<x a="1" b=\'2\' c>',
    '</',
    '<',
    '>',
    '&',
    '"',
    '\u0000',
    '<value><array><data>'.repeat(200),
    '<?pi?>',
    '<a/>',
    ' '.repeat(5000)
];

function xmlRequest(method, parameters, rnd) {
    let xml = `<?xml version="1.0"?>\n<methodCall><methodName>${xmlEscape(method)}</methodName><params>${parameters.map(parameter => `<param>${xmlValue(parameter, rnd)}</param>`).join('')}</params></methodCall>`;
    if (rnd.chance(0.3)) {
        // (structural mutations: insert or remove markup)
        for (let i = rnd.int(1, 3); i > 0; i--) {
            const position = rnd.int(0, xml.length);
            xml = rnd.chance(0.6)
                ? xml.slice(0, position) + rnd.pick(xmlSnippets) + xml.slice(position)
                : xml.slice(0, position) + xml.slice(position + rnd.int(1, 20));
        }
    }

    return xml;
}

function httpPost(path, body, rnd) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
    const length = rnd.chance(0.85) ? data.length : rnd.pick([0, -1, data.length + 100, data.length - 1, 4_294_967_295, '1e3', 'abc', '']);
    const header = `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/xml\r\nContent-Length: ${length}\r\n\r\n`;
    return Buffer.concat([Buffer.from(header, 'latin1'), data]);
}

/**
 * Applies random byte level mutations (bit flips, interesting bytes,
 * truncation, insertions, duplications, broken length fields).
 *
 * @param {Buffer} input
 * @param {object} rnd
 * @param {object} [options]
 * @param {number} [options.lengthField] - offset of a 32-bit length field (BIN-RPC)
 * @returns {Buffer}
 */
function mutate(input, rnd, {lengthField = -1} = {}) {
    let buffer = Buffer.from(input);
    for (let i = rnd.int(1, 4); i > 0 && buffer.length > 0; i--) {
        const position = rnd.int(0, buffer.length - 1);
        switch (rnd.int(0, 6)) {
            case 0: {
                buffer[position] ^= 1 << rnd.int(0, 7);
                break;
            }

            case 1: {
                buffer[position] = rnd.pick([0x00, 0x01, 0x7F, 0x80, 0xFF]);
                break;
            }

            case 2: {
                buffer = buffer.subarray(0, position);
                break;
            }

            case 3: {
                buffer = Buffer.concat([buffer.subarray(0, position), rnd.bytes(rnd.int(1, 16)), buffer.subarray(position)]);
                break;
            }

            case 4: {
                const end = Math.min(buffer.length, position + rnd.int(1, 64));
                buffer = Buffer.concat([buffer.subarray(0, end), buffer.subarray(position, end), buffer.subarray(end)]);
                break;
            }

            case 5: {
                // (32-bit field anywhere, e.g. a length or count)
                if (buffer.length >= position + 4) {
                    buffer.writeUInt32BE(rnd.pick([0, 1, 0x7F_FF_FF_FF, 0x80_00_00_00, 0xFF_FF_FF_FF, 0x00_01_00_00]), position);
                }

                break;
            }

            default: {
                if (lengthField >= 0 && buffer.length >= lengthField + 4) {
                    buffer.writeUInt32BE(rnd.pick([0, 1, buffer.length, buffer.length * 2, 0x7F_FF_FF_FF, 0xFF_FF_FF_FF]), lengthField);
                }
            }
        }
    }

    return buffer;
}

/**
 * BIN-RPC request to the RPC server of ReGaHss.
 *
 * @param {object} rnd
 * @returns {Buffer}
 */
function binrpcInput(rnd) {
    const method = rnd.chance(0.9) ? rnd.pick(rpcMethods.filter(Boolean)) : randomString(rnd);
    const request = binRequest(method, methodParameters(rnd, method));
    return rnd.chance(0.5) ? mutate(request, rnd, {lengthField: 4}) : request;
}

/**
 * XML-RPC request (HTTP POST) to the RPC server of ReGaHss.
 *
 * @param {object} rnd
 * @returns {Buffer}
 */
function xmlrpcInput(rnd) {
    const method = rnd.chance(0.9) ? rnd.pick(rpcMethods.filter(Boolean)) : randomString(rnd);
    const request = httpPost(rnd.pick(['/RPC2', '/', '/groups']), xmlRequest(method, methodParameters(rnd, method), rnd), rnd);
    return rnd.chance(0.3) ? mutate(request, rnd) : request;
}

const httpPaths = [
    '/',
    '/rega.exe',
    '/index.htm',
    '/esp/system.htm?sid=@abc@',
    '/pages/index.htm',
    '/../../../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/webui/webui.js',
    '/esp/exec.htm',
    '/ise/checkrega.cgi',
    '/' + 'a'.repeat(4000),
    '/x?' + '&a=b'.repeat(500),
    '/%',
    '/%00',
    '/ÿ'
];

/**
 * HTTP request to the web server of ReGaHss.
 *
 * @param {object} rnd
 * @returns {Buffer}
 */
function httpInput(rnd) {
    const method = rnd.pick(['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'GET', 'POST', 'X', '']);
    const path = rnd.pick(httpPaths);
    const version = rnd.pick(['HTTP/1.1', 'HTTP/1.0', 'HTTP/1.1', 'HTTP/9.9', '']);
    const headers = ['Host: 127.0.0.1'];
    for (let i = rnd.int(0, 4); i > 0; i--) {
        headers.push(rnd.pick([
            'Content-Type: text/plain',
            'Connection: keep-alive',
            'Transfer-Encoding: chunked',
            'Cookie: ' + 'a=b;'.repeat(rnd.int(1, 2000)),
            'X-Long: ' + 'x'.repeat(rnd.int(1, 20_000)),
            'Content-Length: ' + rnd.pick([-1, 0, 99_999_999, 'x']),
            ': empty',
            'NoColon',
            'Range: bytes=0-'
        ]));
    }

    const body = rnd.chance(0.5) ? randomScript(rnd) : randomString(rnd);
    if (method === 'POST' && !headers.some(header => header.startsWith('Content-Length'))) {
        headers.push('Content-Length: ' + Buffer.byteLength(body, 'latin1'));
    }

    const request = Buffer.from(`${method} ${path} ${version}\r\n${headers.join('\r\n')}\r\n\r\n${body}`, 'latin1');
    return rnd.chance(0.3) ? mutate(request, rnd) : request;
}

// ReGa script generator (read only operations: no loops, no DOM changes
// except of a test variable, no system.Exec())
const scriptIdentifiers = ['a', 'b', 's', 'i', 'r', 't', 'o', 'x'];

function scriptLiteral(rnd) {
    return rnd.pick([
        () => String(rnd.pick(interestingIntegers)),
        () => String(rnd.int(-1000, 1000)),
        () => rnd.pick(['0.0', '1.5', '-2.25', '1e300', '123456789.123456789']),
        () => JSON.stringify(randomString(rnd).replaceAll('\u0000', '')).replaceAll('\\u', 'u'),
        () => rnd.pick(['true', 'false', 'null']),
        () => rnd.pick(['@2038-01-19 04:14:08@', '@1970-01-01 00:00:00@', '@2024-02-29 12:00:00@', '@9999-12-31 23:59:59@'])
    ])();
}

function scriptExpression(rnd, depth = 0) {
    if (depth > 3 || rnd.chance(0.3)) {
        return rnd.chance(0.5) ? scriptLiteral(rnd) : rnd.pick(scriptIdentifiers);
    }

    switch (rnd.int(0, 5)) {
        case 0: {
            return `(${scriptExpression(rnd, depth + 1)} ${rnd.pick(['+', '-', '*', '/', '%', '#', '&&', '||', '==', '!=', '<', '>', '<=', '>=', '&', '|', '^'])} ${scriptExpression(rnd, depth + 1)})`;
        }

        case 1: {
            const method = rnd.pick([
                'Length()',
                'ToInteger()',
                'ToFloat()',
                'ToString()',
                'ToString(' + rnd.int(-5, 20) + ')',
                'ToTime()',
                'ToUpper()',
                'ToLower()',
                'Trim()',
                'UriEncode()',
                'UriDecode()',
                'Abs()',
                'Sqrt()',
                'Exp()',
                'Log()',
                'Round(' + rnd.int(-3, 10) + ')',
                'Floor()',
                'Ceil()',
                `Substr(${scriptExpression(rnd, depth + 1)}, ${scriptExpression(rnd, depth + 1)})`,
                `Find(${scriptExpression(rnd, depth + 1)})`,
                `StrValueByIndex(${scriptExpression(rnd, depth + 1)}, ${scriptExpression(rnd, depth + 1)})`,
                `Pow(${scriptExpression(rnd, depth + 1)})`,
                `Replace(${scriptExpression(rnd, depth + 1)}, ${scriptExpression(rnd, depth + 1)})`,
                `Format(${JSON.stringify(rnd.pick(['%Y-%m-%d', '%s', '%n', '%%', '%Q', '', '%' + 'Y'.repeat(200)]))})`,
                'Year()',
                'Month()',
                'Day()',
                'Hour()',
                'Name()',
                'ID()',
                'TypeName()',
                'Value()',
                'Timestamp()',
                'EnumUsedIDs()',
                'Count()',
                'Get(0)'
            ]);
            return `${scriptExpression(rnd, depth + 1)}.${method}`;
        }

        case 2: {
            return `dom.GetObject(${rnd.pick(['ID_SYSTEM_VARIABLES', 'ID_ROOMS', 'ID_DEVICES', '"VarString1"', '"BidCos-RF.BidCoS-RF:1.PRESS_SHORT"', String(rnd.pick(interestingIntegers)), scriptExpression(rnd, depth + 1)])})`;
        }

        case 3: {
            return `system.Date(${JSON.stringify(rnd.pick(['%F %T', '%s', '%n%n%n', '%' + 'Z'.repeat(100), '', '%c %x %X %j %U']))})`;
        }

        case 4: {
            return `(!${scriptExpression(rnd, depth + 1)})`;
        }

        default: {
            return `system.GetVar(${JSON.stringify(rnd.pick(scriptIdentifiers))})`;
        }
    }
}

function scriptStatement(rnd, depth = 0) {
    switch (depth > 2 ? rnd.int(0, 2) : rnd.int(0, 5)) {
        case 0: {
            return `${rnd.pick(['var', 'integer', 'real', 'string', 'boolean', 'time', 'object'])} ${rnd.pick(scriptIdentifiers)} = ${scriptExpression(rnd)};`;
        }

        case 1: {
            return `${rnd.pick(scriptIdentifiers)} = ${scriptExpression(rnd)};`;
        }

        case 2: {
            return `${rnd.pick(['WriteLine', 'Write'])}(${scriptExpression(rnd)});`;
        }

        case 3: {
            return `if (${scriptExpression(rnd)}) { ${scriptStatement(rnd, depth + 1)} } else { ${scriptStatement(rnd, depth + 1)} }`;
        }

        case 4: {
            return `foreach (${rnd.pick(scriptIdentifiers)}, ${scriptExpression(rnd)}) { ${scriptStatement(rnd, depth + 1)} }`;
        }

        default: {
            return `dom.GetObject("VarString1").State(${scriptExpression(rnd)});`;
        }
    }
}

/**
 * ReGa script (random statements, sometimes syntactically broken).
 *
 * @param {object} rnd
 * @returns {string}
 */
function randomScript(rnd) {
    const statements = [];
    for (let i = rnd.int(1, 8); i > 0; i--) {
        statements.push(scriptStatement(rnd));
    }

    let script = statements.join('\n');
    if (rnd.chance(0.2)) {
        const position = rnd.int(0, script.length);
        script = script.slice(0, position) + rnd.pick(['{', '}', '(', ')', ';', '"', '!', '.', '#', '\u0000', '\\', '/*', '!!!']) + script.slice(position);
    }

    return script;
}

/**
 * Sends raw data to a TCP port and waits for the connection to be closed by
 * the server (or the timeout).
 *
 * @param {number} port
 * @param {Buffer} data
 * @param {number} [timeout=1000]
 * @returns {Promise<Buffer>} received data
 */
function sendRaw(port, data, timeout = 1000) {
    return new Promise(resolve => {
        const chunks = [];
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.end(data);
        });
        const finish = () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(Buffer.concat(chunks));
        };

        const timer = setTimeout(finish, timeout);
        socket.on('data', chunk => chunks.push(chunk));
        socket.on('close', finish);
        socket.on('error', finish);
    });
}

module.exports = {
    random, mutate, binRequest, binrpcInput, xmlrpcInput, httpInput, randomScript, sendRaw
};
