// Minimal XML-RPC server (HTTP POST, methodCall/methodResponse) for the
// interface simulator: supports the value types ReGaHss uses (string, int,
// i4, i8, boolean, double, dateTime.iso8601, base64, array, struct, nil).

const http = require('http');

const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: '\''
};

function decodeText(text) {
    return text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10));
        }

        return entities[entity] ?? match;
    });
}

function encodeText(text) {
    return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Parses an XML document into a tree of {name, children, text} nodes
 * (sufficient for XML-RPC: no attributes, comments or CDATA needed).
 *
 * @param {string} xml
 * @returns {{name: string, children: object[], text: string}}
 */
function parseXml(xml) {
    const root = {name: '#root', children: [], text: ''};
    const stack = [root];
    const tokenRx = /<\?[^>]*\?>|<!--[\s\S]*?-->|<(\/?)([\w.:-]+)[^>]*?(\/?)>|([^<]+)/g;
    for (const [, closing, name, selfClosing, text] of xml.matchAll(tokenRx)) {
        const current = stack.at(-1);
        if (text !== undefined) {
            current.text += decodeText(text);
        } else if (name === undefined) {
            // (declaration or comment)
        } else if (closing) {
            if (current.name !== name) {
                throw new Error('unexpected closing tag </' + name + '>');
            }

            stack.pop();
        } else {
            const node = {name, children: [], text: ''};
            current.children.push(node);
            if (!selfClosing) {
                stack.push(node);
            }
        }
    }

    if (stack.length !== 1) {
        throw new Error('unexpected end of XML document');
    }

    return root;
}

const child = (node, name) => node.children.find(item => item.name === name);

function decodeValue(node) {
    const [typed] = node.children;
    if (!typed) {
        return node.text;
    }

    switch (typed.name) {
        case 'string': {
            return typed.text;
        }

        case 'int':
        case 'i4':
        case 'i8': {
            return Number.parseInt(typed.text, 10);
        }

        case 'boolean': {
            return typed.text.trim() === '1';
        }

        case 'double': {
            return Number.parseFloat(typed.text);
        }

        case 'dateTime.iso8601': {
            return typed.text.trim();
        }

        case 'base64': {
            return Buffer.from(typed.text, 'base64');
        }

        case 'nil': {
            return null;
        }

        case 'array': {
            return (child(typed, 'data')?.children || []).filter(item => item.name === 'value').map(item => decodeValue(item));
        }

        case 'struct': {
            const result = {};
            for (const member of typed.children.filter(item => item.name === 'member')) {
                result[child(member, 'name').text] = decodeValue(child(member, 'value'));
            }

            return result;
        }

        default: {
            throw new Error('unsupported XML-RPC type ' + typed.name);
        }
    }
}

function encodeValue(value) {
    if (value === null || value === undefined) {
        return '<value><string></string></value>';
    }

    if (typeof value === 'boolean') {
        return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
    }

    if (typeof value === 'number') {
        return Number.isInteger(value) ? `<value><i4>${value}</i4></value>` : `<value><double>${value}</double></value>`;
    }

    if (Buffer.isBuffer(value)) {
        return `<value><base64>${value.toString('base64')}</base64></value>`;
    }

    if (Array.isArray(value)) {
        return `<value><array><data>${value.map(item => encodeValue(item)).join('')}</data></array></value>`;
    }

    if (typeof value === 'object') {
        const members = Object.entries(value).map(([name, item]) => `<member><name>${encodeText(name)}</name>${encodeValue(item)}</member>`);
        return `<value><struct>${members.join('')}</struct></value>`;
    }

    return `<value>${encodeText(value)}</value>`;
}

/**
 * @param {string} xml - methodCall document
 * @returns {{method: string, params: Array}}
 */
function parseMethodCall(xml) {
    const methodCall = child(parseXml(xml), 'methodCall');
    if (!methodCall) {
        throw new Error('no methodCall');
    }

    const parameters = (child(methodCall, 'params')?.children || [])
        .filter(item => item.name === 'param')
        .map(item => decodeValue(child(item, 'value')));
    return {method: child(methodCall, 'methodName').text.trim(), params: parameters};
}

function methodResponse(value) {
    return `<?xml version="1.0"?>\n<methodResponse><params><param>${encodeValue(value)}</param></params></methodResponse>`;
}

function faultResponse({faultCode, faultString}) {
    return `<?xml version="1.0"?>\n<methodResponse><fault>${encodeValue({faultCode, faultString})}</fault></methodResponse>`;
}

class XmlRpcServer {
    /**
     * @param {object} options
     * @param {string} [options.host=127.0.0.1]
     * @param {number} options.port
     * @param {function(string, Array): Promise<*>|*} handler - called with method and parameters,
     *     returns the result (an object with faultCode/faultString is sent as fault)
     */
    constructor({host = '127.0.0.1', port}, handler) {
        this.host = host;
        this.port = port;
        this.handler = handler;
        this.httpServer = http.createServer((request, response) => this._request(request, response));
    }

    listen() {
        return new Promise((resolve, reject) => {
            this.httpServer.once('error', reject);
            this.httpServer.listen(this.port, this.host, () => {
                this.httpServer.off('error', reject);
                resolve();
            });
        });
    }

    close() {
        return new Promise(resolve => {
            this.httpServer.close(() => resolve());
            this.httpServer.closeAllConnections();
        });
    }

    _request(request, response) {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', async () => {
            let body;
            try {
                // (ReGaHss sends ISO-8859-1 encoded requests)
                const {method, params} = parseMethodCall(Buffer.concat(chunks).toString('latin1'));
                const result = await this.handler(method, params);
                body = result && result.faultCode !== undefined ? faultResponse(result) : methodResponse(result ?? '');
            } catch (error) {
                body = faultResponse({faultCode: -1, faultString: error.message});
            }

            const buffer = Buffer.from(body, 'latin1');
            response.writeHead(200, {'Content-Type': 'text/xml', 'Content-Length': buffer.length});
            response.end(buffer);
        });
    }
}

module.exports = {
    XmlRpcServer, parseXml, parseMethodCall, methodResponse, faultResponse
};
