// Minimal clients for the HTTP based interfaces of ReGaHss: the remote script
// interface (/rega.exe) and plain HTTP requests (e.g. for security tests).

const http = require('http');

// ReGaHss scripts and responses are ISO-8859-1 encoded
const encoding = 'latin1';

const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: '\''
};

function decodeEntities(string) {
    return string.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
            return String.fromCodePoint(code);
        }

        return entities[entity] ?? match;
    });
}

/**
 * Splits a /rega.exe response into the script output and the variables of
 * the script, which ReGaHss appends as (flat) xml document, e.g.
 * <xml><exec>/rega.exe</exec><sessionId></sessionId><i>5</i></xml>
 *
 * @param {string} response
 * @returns {{output: string, objects: Object<string, string>}}
 */
function parseScriptResponse(response) {
    const xmlStart = response.lastIndexOf('<xml>');
    if (xmlStart === -1 || !response.trimEnd().endsWith('</xml>')) {
        throw new Error('xml in rega response missing');
    }

    const output = response.slice(0, xmlStart);
    const xml = response.slice(xmlStart + '<xml>'.length, response.lastIndexOf('</xml>'));
    const objects = {};
    const rx = /<([^\s/>]+)>([^<]*)<\/\1>|<([^\s/>]+)\/>/g;
    let consumed = 0;
    for (const match of xml.matchAll(rx)) {
        if (xml.slice(consumed, match.index).trim() !== '') {
            break;
        }

        consumed = match.index + match[0].length;
        const name = match[1] ?? match[3];
        const value = match[1] ? decodeEntities(match[2]) : '';
        objects[name] = Object.hasOwn(objects, name) ? [objects[name], value].flat() : value;
    }

    if (xml.slice(consumed).trim() !== '') {
        throw new Error('invalid xml in rega response: ' + xml.slice(consumed, consumed + 80));
    }

    return {output, objects};
}

/**
 * Performs a single HTTP request (no redirects are followed, the path is sent
 * as is without any normalization).
 *
 * @param {object} options
 * @param {number} options.port
 * @param {string} [options.host=127.0.0.1]
 * @param {string} [options.method=GET]
 * @param {string} [options.path=/]
 * @param {string|Buffer} [options.body]
 * @param {object} [options.headers]
 * @param {number} [options.timeout=0] - socket timeout in ms (0: none)
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>}
 */
function httpRequest({port, host = '127.0.0.1', method = 'GET', path = '/', body, headers = {}, timeout = 0}) {
    return new Promise((resolve, reject) => {
        const payload = typeof body === 'string' ? Buffer.from(body, encoding) : body;
        const request = http.request({
            host,
            port,
            method,
            path,
            agent: false,
            headers: payload ? {'Content-Length': payload.length, ...headers} : headers
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => resolve({statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}));
        });
        if (timeout > 0) {
            request.setTimeout(timeout, () => {
                const error = new Error('HTTP request ' + method + ' ' + path + ' timed out after ' + timeout + 'ms');
                error.code = 'ETIMEDOUT';
                request.destroy(error);
            });
        }

        request.on('error', reject);
        request.end(payload);
    });
}

class RegaClient {
    /**
     * @param {object} options
     * @param {number|function(): number} options.port - port of the ReGaHss HTTP server (or a function returning it)
     * @param {string} [options.host=127.0.0.1]
     * @param {function(Error): Error} [options.onError] - allows to enrich request errors (e.g. with crash information)
     */
    constructor({port, host = '127.0.0.1', onError = error => error}) {
        this._port = port;
        this.host = host;
        this.onError = onError;
    }

    get port() {
        return typeof this._port === 'function' ? this._port() : this._port;
    }

    /**
     * Performs an HTTP request to the ReGaHss web server.
     *
     * @param {object} options - see httpRequest()
     * @returns {Promise<{statusCode: number, headers: object, body: Buffer, text: string}>}
     */
    async request(options) {
        try {
            const response = await httpRequest({host: this.host, port: this.port, ...options});
            response.text = response.body.toString(encoding);
            return response;
        } catch (error) {
            throw this.onError(error);
        }
    }

    /**
     * Executes a ReGaHss script via the remote script interface.
     *
     * Returns a promise resolving to {output, objects} if no callback is
     * given, otherwise callback(error, output, objects) is called (interface
     * of the former homematic-rega module).
     *
     * @param {string} script
     * @param {function(?Error, string=, object=)} [callback]
     * @returns {Promise<{output: string, objects: Object<string, string>}>|undefined}
     */
    exec(script, callback) {
        const promise = this.request({
            method: 'POST',
            path: '/rega.exe',
            body: script,
            headers: {'Content-Type': 'application/x-www-form-urlencoded'}
        }).then(response => {
            if (response.statusCode !== 200) {
                throw new Error('rega.exe returned HTTP status ' + response.statusCode);
            }

            if (response.text === '') {
                throw new Error('empty rega response');
            }

            return parseScriptResponse(response.text);
        });

        if (typeof callback !== 'function') {
            return promise;
        }

        // (called outside of the promise chain, so that exceptions thrown by
        // the callback, e.g. failed assertions, are reported to mocha as
        // uncaught exceptions of the running test)
        promise.then(
            ({output, objects}) => setImmediate(callback, null, output, objects),
            error => setImmediate(callback, error)
        );
    }
}

module.exports = {
    RegaClient,
    httpRequest,
    parseScriptResponse
};
