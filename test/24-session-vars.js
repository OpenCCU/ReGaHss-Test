/* global describe, step, before, after */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, unicorn/no-await-expression-member */

// Tests the session variables of the scripts: system.SetSessionVar(),
// GetSessionVar(), IsSessionVar(), DeleteSessionVar() and ListSessionVars()
// in the scripts of programs, in remote requests (/rega.exe, e.g. "Skript
// testen" of the WebUI) and in the pages of the WebUI, with
// ScriptVariableScope=global (default) and local.
// see https://github.com/OpenCCU/OpenCCU/issues/4485

const fs = require('fs');
const path = require('path');

const {
    regaLabel,
    workerDir,
    ReGaInstance,
    requireRegaVersion
} = require('../lib/helper.js');
const {programScript} = require('../lib/program-builder.js');

require('should');

const fixtureDir = path.join(__dirname, 'fixtures', 'www', 'session-vars');
const fixtureName = 'session-vars';

/**
 * Creates a document root for the web server of ReGaHss: the WebUI files of
 * the configured document root (rega.conf) as symbolic links plus the fixture
 * files of this test (a page executing the posted script).
 *
 * @param {string} dir - directory to create the document root in
 * @returns {string} the document root
 */
function createDocRoot(dir) {
    const conf = fs.readFileSync(path.join(__dirname, '..', 'rega.conf'), 'latin1');
    const webRoot = /^HttpDocPath=(.*)$/m.exec(conf)[1].trim();
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    for (const entry of fs.readdirSync(webRoot)) {
        fs.symlinkSync(path.join(webRoot, entry), path.join(dir, entry));
    }

    fs.symlinkSync(fixtureDir, path.join(dir, fixtureName));
    return dir;
}

const sleep = ms => new Promise(resolve => {
    setTimeout(resolve, ms);
});

// scripts of the programs, executed by setting "SV Trigger" to their name;
// each one writes its result to "SV Out"
const programs = {
    set: 'system.SetSessionVar("prgVar", "from program"); integer prgLocal = 7; dom.GetObject("SV Out").State("done");',
    get: 'dom.GetObject("SV Out").State(system.IsSessionVar("prgVar") # "|" # system.GetSessionVar("prgVar") # "|" # system.IsSessionVar("remVar") # "|" # system.GetSessionVar("remVar"));',
    list: 'dom.GetObject("SV Out").State(">" # system.ListSessionVars());',
    delete: 'dom.GetObject("SV Out").State(system.DeleteSessionVar("prgVar") # "|" # system.DeleteSessionVar("prgVar") # "|" # system.DeleteSessionVar("prgLocal"));'
};

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // added in ReGaHss R1.00.0388.0271
    before(function () {
        requireRegaVersion(this, 'R1.00.0388.0271');
    });

    for (const scope of ['global', 'local']) {
        describe('ScriptVariableScope=' + scope, function () {
            let instance = null;
            let sid = null;

            // script of a remote request (/rega.exe)
            const remote = async script => (await instance.exec(script)).output;

            // executes a program (see programs) and returns its result
            const program = async name => {
                await remote('dom.GetObject("SV Out").State("");');
                await remote(`dom.GetObject("SV Trigger").State("${name}");`);
                const deadline = Date.now() + 10_000;
                let output = '';
                while (output === '' && Date.now() < deadline) {
                    await sleep(100);
                    output = await remote('Write(dom.GetObject("SV Out").Value());');
                }

                output.should.not.equal('', 'program ' + name + ' not executed');
                return output;
            };

            // script of a page of the WebUI (with the session of the login)
            const page = async script => {
                const response = await instance.client.request({
                    method: 'POST',
                    path: `/${fixtureName}/page.htm?sid=${sid}`,
                    body: script,
                    timeout: 30_000
                });
                response.statusCode.should.equal(200, response.text);
                return response.text;
            };

            describe('init', function () {
                step('should start ReGaHss [' + regaLabel + ']', async function () {
                    this.timeout(60_000);
                    instance = new ReGaInstance({
                        name: 'session-vars-' + scope,
                        httpDocPath: createDocRoot(path.join(workerDir(), 'www-session-vars-' + scope)),
                        config: {ScriptVariableScope: scope}
                    });
                    await instance.start({testFile: __filename});
                    await instance.ready();
                    await instance.waitFor(/ReGa entering normal operation/);
                });

                step('should create the programs', async function () {
                    this.timeout(30_000);
                    await remote(`
object list = dom.GetObject(ID_SYSTEM_VARIABLES);
object sv;
string name;
foreach (name, "SV Trigger\\tSV Out") {
  sv = dom.CreateObject(OT_VARDP, name);
  list.Add(sv.ID());
  sv.ValueType(ivtString);
  sv.ValueSubType(istChar8859);
  sv.State("");
}
dom.RTUpdate(0);
`);
                    for (const [name, script] of Object.entries(programs)) {
                        const id = await remote(programScript({
                            name: 'SV ' + name,
                            rules: [{
                                conditions: [[{
                                    sysvar: 'SV Trigger', compare: '==', value: name, trigger: 'update'
                                }]],
                                destinations: [{script}]
                            }]
                        }));
                        Number(id).should.be.above(0, 'program SV ' + name + ' not created: ' + id);
                    }
                });

                step('should log in to a session of the WebUI', async function () {
                    this.timeout(30_000);
                    const response = await instance.client.request({
                        method: 'POST',
                        path: '/login.htm',
                        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                        body: 'tbUsername=Admin&tbPassword='
                    });
                    response.statusCode.should.equal(302);
                    sid = /sid=(@[^@]+@)/.exec(response.headers.location || '')?.[1];
                    (sid === undefined).should.be.false('no session id in ' + response.headers.location);
                });
            });

            describe('session variables of the programs', function () {
                step('should share a session variable set by a program with a remote request', async function () {
                    this.timeout(30_000);
                    (await program('set')).should.equal('done');
                    (await remote('Write(system.IsSessionVar("prgVar") # "|" # system.GetSessionVar("prgVar"));')).should.equal('true|from program');
                    (await remote('Write(system.ListSessionVars());')).should.equal('prgVar');
                });

                step('should share a session variable set by a remote request with the programs', async function () {
                    this.timeout(30_000);
                    // (the remote request also has the variable itself, as before)
                    (await remote('Write(system.SetSessionVar("remVar", "from remote") # "|" # system.GetVar("remVar"));')).should.equal('true|from remote');
                    (await program('get')).should.equal('true|from program|true|from remote');
                });

                step('should list the session variables (sorted, separated by tabs)', async function () {
                    this.timeout(30_000);
                    (await program('list')).should.equal('>prgVar\tremVar');
                    (await remote('string n; foreach (n, system.ListSessionVars()) { Write(n # "=" # system.GetSessionVar(n) # ";"); }')).should.equal('prgVar=from program;remVar=from remote;');
                });

                step('should delete a session variable for a remote request', async function () {
                    this.timeout(30_000);
                    (await remote('Write(system.DeleteSessionVar("remVar") # "|" # system.DeleteSessionVar("remVar") # "|" # system.ListSessionVars());')).should.equal('true|false|prgVar');
                    (await program('get')).should.equal('true|from program|false|');
                });

                step('should delete a session variable for a program', async function () {
                    this.timeout(30_000);
                    // (prgLocal is no session variable)
                    (await program('delete')).should.equal('true|false|false');
                    (await remote('Write(system.IsSessionVar("prgVar") # "|" # system.ListSessionVars());')).should.equal('false|');
                    (await program('list')).should.equal('>');
                });

                if (scope === 'global') {
                    // (the scripts of the programs share all their variables, only
                    // the ones set with system.SetSessionVar() are session variables)
                    step('should not give a remote request the other variables of the programs', async function () {
                        this.timeout(30_000);
                        (await program('set')).should.equal('done');
                        (await remote('Write(system.IsSessionVar("prgLocal") # "|" # system.GetSessionVar("prgLocal") # "|" # system.DeleteSessionVar("prgLocal"));')).should.equal('false||false');
                        (await remote('Write(system.SetSessionVar("prgLocal", 99));')).should.equal('false');
                        (await remote('Write(system.ListSessionVars());')).should.equal('prgVar');
                        (await remote('Write(system.DeleteSessionVar("prgVar"));')).should.equal('true');
                    });
                }
            });

            describe('session variables of a page of the WebUI', function () {
                step('should not give a page the session variables of the programs', async function () {
                    this.timeout(30_000);
                    await remote('system.SetSessionVar("sessionRemote", "R"); system.SetSessionVar("remVar", "R");');
                    (await page('Write(system.IsSessionVar("sessionRemote") # "|" # system.IsSessionVar("remVar") # "|" # system.GetSessionVar("remVar"));')).should.equal('false|false|');
                });

                step('should keep the session variables of a page with its session', async function () {
                    this.timeout(30_000);
                    (await page('Write(system.SetSessionVar("sessionFoo", "F"));')).should.equal('true');
                    (await page('Write(system.GetSessionVar("sessionFoo") # "|" # system.ListSessionVars());')).should.match(/^F\|(session\w+\t)*sessionFoo(\tsession\w+)*$/);
                    // (the remote requests and programs do not get them)
                    (await remote('Write(system.IsSessionVar("sessionFoo") # "|" # system.ListSessionVars());')).should.equal('false|remVar\tsessionRemote');
                });

                step('should delete a session variable of a page from its session', async function () {
                    this.timeout(30_000);
                    // (the variables of ReGaHss identifying the session are not deleted)
                    (await page('Write(system.DeleteSessionVar("sessionFoo") # "|" # system.DeleteSessionVar("sessionUserID"));')).should.equal('true|false');
                    const output = await page('Write(system.IsSessionVar("sessionFoo") # "|" # system.GetSessionVar("sessionUserID") # "|" # system.ListSessionVars());');
                    output.should.match(/^false\|\d+\|/);
                    output.should.not.match(/sessionFoo/);
                    output.should.match(/sessionUserID/);
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
    }
});
