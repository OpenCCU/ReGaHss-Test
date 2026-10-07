/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments, no-await-in-loop, max-nested-callbacks */

// Tests of the communication of ReGaHss with the interface processes
// (BidCos-RF, HmIP-RF, VirtualDevices) using the interface simulator
// (lib/ccu-simulator.js): registration, device lifecycle, events, values
// sent to devices, the XML-RPC methods of ReGaHss and restarts of both sides.

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    simulator,
    regaInstance,
    waitForSim,
    fixtureDevice
} = require('../lib/helper.js');
const {programScript} = require('../lib/program-builder.js');

require('should');

const contact = '0000D3C98C9233';
const actor = '000213C990986A';
const virtualSwitch = 'INT0000001';

const sleep = ms => new Promise(resolve => {
    setTimeout(resolve, ms);
});

// repeats fn until it returns the expected value (or the timeout expires)
async function until(fn, expected, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    let actual = await fn();
    while (actual !== expected && Date.now() < deadline) {
        await sleep(100);
        actual = await fn();
    }

    actual.should.equal(expected);
}

// device of an interface: id, name, ready flag, number of channels
async function device(address) {
    const {output} = await rega.exec(`
string id;
foreach (id, dom.GetObject(ID_DEVICES).EnumUsedIDs()) {
  object d = dom.GetObject(id);
  if (d.Address() == "${address}") {
    integer ifaceId = d.Interface();
    object iface = dom.GetObject(ifaceId);
    Write(iface.Name() # "|" # d.Name() # "|" # d.HssType() # "|" # d.ReadyConfig() # "|" # d.Channels().Count());
  }
}`);
    return output;
}

async function datapoint(name) {
    const {output} = await rega.exec(`
object dp = dom.GetObject("${name}");
if (dp) { Write(dp.Value()); } else { Write("missing"); }`);
    return output;
}

const hmip = () => simulator().interface('HmIP-RF');

// registration of ReGaHss lost by the restart of the HmIP-RF interface
let lostRegistration = null;

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    describe('interfaces and devices', function () {
        initTest({sim: true});

        describe('registration', function () {
            it('should register at all interfaces with its BIN-RPC callback (init)', async function () {
                this.timeout(30_000);
                for (const name of ['BidCos-RF', 'HmIP-RF', 'VirtualDevices']) {
                    await until(() => simulator().interface(name).registrations().map(({url}) => url).join(','), 'xmlrpc_bin://127.0.0.1:' + regaInstance().ports.xmlrpc);
                }
            });

            it('should use the IDs of its interface objects', async function () {
                const {output} = await rega.exec(`
string id;
foreach (id, dom.GetObject(ID_INTERFACES).EnumUsedIDs()) {
  object i = dom.GetObject(id);
  WriteLine(i.Name() # "=" # i.ID());
}`);
                const ids = Object.fromEntries(output.trim().split('\r\n').map(line => line.split('=')));
                for (const name of ['BidCos-RF', 'HmIP-RF', 'VirtualDevices']) {
                    simulator().interface(name).interfaceId.should.equal(ids[name], name);
                }
            });

            it('should report the devices it knows (listDevices)', async function () {
                this.timeout(30_000);
                await waitForSim(/rfd devices synced: ReGaHss knows 52, announced 0/);
                await waitForSim(/hmip devices synced: ReGaHss knows 52, announced 0/);
                await waitForSim(/virtual devices synced: ReGaHss knows 0, announced 0/);
            });

            it('should list its XML-RPC methods (system.listMethods)', async function () {
                const methods = await hmip().rawCall('system.listMethods');
                methods.should.containDeep(['deleteDevices', 'event', 'listDevices', 'newDevices', 'replaceDevice', 'reportValueUsage', 'setReadyConfig', 'system.listMethods', 'system.methodHelp', 'system.multicall', 'updateDevice']);
            });

            it('should reject unknown methods with a fault', async function () {
                const result = await hmip().rawCall('doesNotExist', []);
                result.should.deepEqual({faultCode: -1, faultString: 'doesNotExist: unknown method name'});
            });
        });

        describe('device lifecycle', function () {
            it('should create announced devices (newDevices)', async function () {
                this.timeout(30_000);
                const queried = simulator().waitForCall('getParamsetDescription', {interface: 'HmIP-RF', match: ([address, paramset]) => address === contact + ':1' && paramset === 'VALUES', timeout: 20_000});
                const result = await hmip().addDevices(fixtureDevice('HmIP-RF', contact));
                result.should.equal('');
                await queried;
                await until(() => device(contact), 'HmIP-RF|HMIP-SWDO ' + contact + '|HMIP-SWDO|false|2');
            });

            it('should create the datapoints of the channels', async function () {
                const {output} = await rega.exec(`
object ch = dom.GetObject("HMIP-SWDO ${contact}:1");
string id;
foreach (id, ch.DPs().EnumUsedIDs()) {
  object dp = dom.GetObject(id);
  WriteLine(dp.Name() # " " # dp.ValueType() # " " # dp.Operations());
}`);
                output.should.containEql('HmIP-RF.' + contact + ':1.STATE ');
            });

            it('should create devices of the VirtualDevices interface', async function () {
                this.timeout(30_000);
                await simulator().interface('VirtualDevices').addDevices(fixtureDevice('VirtualDevices', virtualSwitch));
                await until(() => device(virtualSwitch), 'VirtualDevices|VD-SWITCH ' + virtualSwitch + '|VD-SWITCH|false|2');
            });

            it('should accept updateDevice', async function () {
                const result = await hmip().call('updateDevice', [contact, 0]);
                result.should.equal('');
            });

            it('should accept setReadyConfig (without changing the ready flag)', async function () {
                const result = await hmip().call('setReadyConfig', [contact, true]);
                result.should.equal('');
                const description = await device(contact);
                description.should.equal('HmIP-RF|HMIP-SWDO ' + contact + '|HMIP-SWDO|false|2');
            });

            it('should answer reportValueUsage', async function () {
                const result = await hmip().call('reportValueUsage', [contact + ':1', 'STATE', 1]);
                result.should.equal(false);
            });

            it('should not know readdedDevice', async function () {
                const result = await hmip().call('readdedDevice', [[contact]]);
                result.should.deepEqual({faultCode: -1, faultString: 'readdedDevice: unknown method name'});
            });
        });

        describe('events', function () {
            it('should update datapoints on events', async function () {
                this.timeout(30_000);
                await hmip().event(contact + ':1', 'STATE', 1);
                await until(() => datapoint('HmIP-RF.' + contact + ':1.STATE'), '1');
                await hmip().event(contact + ':1', 'STATE', 0);
                await until(() => datapoint('HmIP-RF.' + contact + ':1.STATE'), '0');
            });

            it('should process events sent via system.multicall', async function () {
                this.timeout(30_000);
                const results = await hmip().multicallEvents([
                    [contact + ':1', 'STATE', 1],
                    [contact + ':0', 'LOW_BAT', true]
                ]);
                results[0].should.deepEqual([[''], ['']]);
                await until(() => datapoint('HmIP-RF.' + contact + ':1.STATE'), '1');
                await until(() => datapoint('HmIP-RF.' + contact + ':0.LOW_BAT'), 'true');
            });

            it('should ignore events of unknown devices', async function () {
                const result = await hmip().event('UNKNOWN0000000:1', 'STATE', 1);
                result.should.equal('');
                const value = await datapoint('HmIP-RF.UNKNOWN0000000:1.STATE');
                value.should.equal('missing');
            });

            it('should execute a program triggered by a device event', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(programScript({
                    name: 'Contact program',
                    rules: [{
                        conditions: [[{datapoint: 'HmIP-RF.' + contact + ':1.STATE', value: 1, trigger: 'update'}]],
                        destinations: [{sysvar: 'VarString1', value: 'window open'}]
                    }]
                }));
                Number(output).should.be.above(0);
                await hmip().event(contact + ':1', 'STATE', 1);
                await until(async () => {
                    const result = await rega.exec('Write(dom.GetObject("VarString1").Value());');
                    return result.output;
                }, 'window open');
            });
        });

        describe('values sent to devices', function () {
            it('should send values to devices (setValue) and process the event of the actor', async function () {
                this.timeout(30_000);
                await hmip().addDevices(fixtureDevice('HmIP-RF', actor));
                await until(async () => {
                    const description = await device(actor);
                    return description.split('|')[1];
                }, 'HMIP-PS ' + actor);
                const set = simulator().waitForCall('setValue', {interface: 'HmIP-RF', match: ([address, key, value]) => address === actor + ':3' && key === 'STATE' && value === true, timeout: 20_000});
                await rega.exec('dom.GetObject("HmIP-RF.' + actor + ':3.STATE").State(true);');
                await set;
                hmip().value(actor + ':3', 'STATE').should.equal(true);
                await until(() => datapoint('HmIP-RF.' + actor + ':3.STATE'), 'true');
            });

            it('should send values to VirtualDevices', async function () {
                this.timeout(30_000);
                const set = simulator().waitForCall('setValue', {interface: 'VirtualDevices', match: ([address, key]) => address === virtualSwitch + ':1' && key === 'STATE', timeout: 20_000});
                await rega.exec('dom.GetObject("VirtualDevices.' + virtualSwitch + ':1.STATE").State(true);');
                const call = await set;
                call.params[2].should.equal(true);
                await until(() => datapoint('VirtualDevices.' + virtualSwitch + ':1.STATE'), 'true');
            });

            it('should press virtual keys of BidCos-RF', async function () {
                this.timeout(30_000);
                await Promise.all([
                    waitForSim(/setValue rfd BidCoS-RF:5 PRESS_SHORT true/, {buffered: false}),
                    rega.exec('dom.GetObject("BidCos-RF.BidCoS-RF:5.PRESS_SHORT").State(true);')
                ]);
            });
        });

        describe('interface restart', function () {
            it('should send values to a restarted interface', async function () {
                this.timeout(30_000);
                await simulator().interface('BidCos-RF').restart({downtime: 1000});
                await Promise.all([
                    waitForSim(/setValue rfd BidCoS-RF:6 PRESS_SHORT true/, {buffered: false}),
                    rega.exec('dom.GetObject("BidCos-RF.BidCoS-RF:6.PRESS_SHORT").State(true);')
                ]);
            });

            it('should accept events of the restarted interface (with kept registration)', async function () {
                this.timeout(30_000);
                // (program Key1: PRESS_SHORT of BidCoS-RF:1 presses BidCoS-RF:2 long)
                await Promise.all([
                    waitForSim(/setValue rfd BidCoS-RF:2 PRESS_LONG true/, {buffered: false}),
                    simulator().interface('BidCos-RF').event('BidCoS-RF:1', 'PRESS_SHORT', true)
                ]);
            });

            it('should not register again at a restarted interface which lost the registration', async function () {
                this.timeout(30_000);
                [lostRegistration] = hmip().callbacks.values();
                // (ReGaHss neither pings the interfaces nor calls init again)
                await simulator().interface('HmIP-RF').restart({keepRegistration: false});
                await sleep(5000);
                (simulator().interface('HmIP-RF').interfaceId === null).should.be.true();
                await hmip().event(contact + ':1', 'STATE', 0).should.be.rejectedWith(/not registered/);
            });
        });

        describe('deleting devices', function () {
            it('should delete devices (deleteDevices)', async function () {
                this.timeout(30_000);
                // (restores the registration lost above)
                hmip().register(lostRegistration.url, lostRegistration.id);
                const result = await hmip().deleteDevices([actor]);
                result.should.equal('');
                await until(() => device(actor), '');
                const value = await datapoint('HmIP-RF.' + actor + ':3.STATE');
                value.should.equal('missing');
            });

            it('should save the devices', async function () {
                const {output} = await rega.exec('Write(system.Save());');
                output.should.equal('true');
            });
        });

        cleanupTest();
    });

    describe('restart of ReGaHss with known devices', function () {
        initTest({sim: true, nocopy: true});

        describe('registration', function () {
            it('should report the previously created devices (listDevices)', async function () {
                this.timeout(30_000);
                // (52 devices/channels of the HmIP-RCV-50, 3 of the contact)
                await waitForSim(/hmip devices synced: ReGaHss knows 55, announced 0/);
                await waitForSim(/virtual devices synced: ReGaHss knows 3, announced 0/);
            });

            it('should have kept the devices (without their device type)', async function () {
                // (records the behaviour: HssType() of devices created via newDevices
                // is empty after a restart, like for the devices of the test regadom)
                const descriptions = [await device(contact), await device(virtualSwitch), await device(actor)];
                descriptions.should.deepEqual([
                    'HmIP-RF|HMIP-SWDO ' + contact + '||false|2',
                    'VirtualDevices|VD-SWITCH ' + virtualSwitch + '||false|2',
                    ''
                ]);
            });
        });

        cleanupTest();
    });
});
