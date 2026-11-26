/* global describe, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop */

// Tests the login of the WebUI when all sessions (SessionMaxCount) are used:
// ReGaHss answers with a single page (status 503 with Retry-After) in German
// or English according to the Accept-Language header of the request. Before,
// it sent three responses on the connection: "Zuviele gleichzeitige
// Verbindungen!!", the page of an invalid session and a redirect.

const net = require('net');

const {
    regaLabel,
    ReGaInstance,
    requireRegaVersion
} = require('../lib/helper.js');

require('should');

/**
 * Sends a login of the WebUI (POST /login.htm) as HTTP/1.0 request, so that
 * ReGaHss closes the connection after its response, and returns all data
 * received on the connection.
 *
 * @param {number} port
 * @param {string} [acceptLanguage] - Accept-Language header
 * @returns {Promise<string>}
 */
function login(port, acceptLanguage) {
    const body = 'tbUsername=Admin&tbPassword=';
    const request = [
        'POST /login.htm HTTP/1.0',
        'Host: 127.0.0.1',
        'Content-Type: application/x-www-form-urlencoded',
        'Content-Length: ' + body.length,
        ...(acceptLanguage === undefined ? [] : ['Accept-Language: ' + acceptLanguage]),
        '',
        body
    ].join('\r\n');

    return new Promise((resolve, reject) => {
        const chunks = [];
        const socket = net.connect(port, '127.0.0.1', () => socket.end(request));
        socket.setTimeout(10_000, () => socket.destroy(new Error('timeout of the login')));
        socket.on('data', chunk => chunks.push(chunk));
        socket.on('error', reject);
        socket.on('close', () => resolve(Buffer.concat(chunks).toString('latin1')));
    });
}

const germanPage = '<html lang="de"><head></head><body><div id="tooManySessions" role="alert"><p>'
    + 'Es sind zu viele Sitzungen gleichzeitig angemeldet. Bitte später erneut versuchen.'
    + '<br><a href="/index.htm">Erneut versuchen</a></p></div></body></html>';
const englishPage = '<html lang="en"><head></head><body><div id="tooManySessions" role="alert"><p>'
    + 'Too many sessions are logged in at the same time. Please try again later.'
    + '<br><a href="/index.htm">Try again</a></p></div></body></html>';

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    let instance = null;

    // fixed in ReGaHss R1.00.0388.0272
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0272');
    });

    describe('init', function () {
        step('should start ReGaHss [' + regaLabel + ']', async function () {
            this.timeout(60_000);
            instance = new ReGaInstance({
                name: 'session-limit',
                config: {SessionMaxCount: '2', SessionTimeout: '600'}
            });
            await instance.start({testFile: __filename});
            await instance.ready();
            await instance.waitFor(/ReGa entering normal operation/);
        });
    });

    describe('login with all sessions used', function () {
        step('should log in while sessions are free', async function () {
            this.timeout(30_000);
            for (let i = 0; i < 2; i++) {
                const response = await login(instance.ports.http);
                response.should.match(/^HTTP\/1\.1 302 Found\r\n/);
                response.should.match(/\r\nLocation: \/pages\/index\.htm\?sid=@\w+@\r\n/);
            }
        });

        step('should send a single page with status 503 and Retry-After', async function () {
            this.timeout(30_000);
            const logged = instance.waitFor(/WARNING: Cannot create session: too many sessions/, {buffered: false, timeout: 10_000});
            const response = await login(instance.ports.http);
            response.match(/HTTP\/1\.1 /g).should.have.length(1, 'responses: ' + response);
            response.should.startWith('HTTP/1.1 503 Service Unavailable\r\n');
            response.should.match(/\r\nRetry-After: 60\r\n/);
            response.should.match(new RegExp(String.raw`\r\nContent-Length: ${germanPage.length}\r\n`));
            response.should.endWith('\r\n\r\n' + germanPage);
            await logged;
        });

        step('should send the page in the language of the browser', async function () {
            this.timeout(30_000);
            for (const [acceptLanguage, page] of [
                ['de-DE,de;q=0.9,en;q=0.8', germanPage],
                ['en-US,en;q=0.9,de;q=0.8', englishPage],
                ['en;q=0.5,de;q=0.9', germanPage],
                ['fr-FR,fr;q=0.9', englishPage],
                ['de;q=0,en', englishPage]
            ]) {
                const response = await login(instance.ports.http, acceptLanguage);
                response.match(/HTTP\/1\.1 /g).should.have.length(1, acceptLanguage + ': ' + response);
                response.should.endWith('\r\n\r\n' + page, acceptLanguage);
            }
        });
    });

    describe('cleanup', function () {
        step('should still run ReGaHss [' + regaLabel + ']', function () {
            instance.running.should.be.true('ReGaHss is not running anymore, last log lines:\n' + instance.tail(20));
        });
    });

    after(async function () {
        this.timeout(30_000);
        if (instance) {
            await instance.stop();
        }
    });
});
