/* eslint-disable capitalized-comments, unicorn/prefer-event-target */

// In-process simulation of the CCU interface processes ReGaHss talks to:
//
//   BidCos-RF       rfd (BIN-RPC)
//   HmIP-RF         HmIPServer (XML-RPC)
//   VirtualDevices  virtual devices of the HmIPServer (XML-RPC, path /groups)
//
// ReGaHss registers itself at each interface (init) with the URL of its own
// BIN-RPC server, the simulated interfaces then announce their devices
// (listDevices/newDevices), answer the requests of ReGaHss (setValue,
// getParamsetDescription, ...) and send events. Tests can change the
// devices at runtime (new/deleted/updated/replaced devices), send events,
// restart interfaces and wait for the calls of ReGaHss.
//
// Every call is written to a log in the format of the former hm-simulator,
// e.g. 'rpc rfd < init ["xmlrpc_bin://127.0.0.1:31999","1007"]' and
// 'setValue rfd BidCoS-RF:2 PRESS_LONG true'.

const EventEmitter = require('events');
const binrpc = require('binrpc');
const binrpcProtocol = require('binrpc/lib/protocol.js');

const {XmlRpcServer} = require('./xmlrpc-server.js');

const {LogWatcher} = require('./log-watcher.js');
const fixtures = require('../test/fixtures/devices.json');

// interfaces of the simulation: name, short name used in the log, protocol,
// port (key of the ports object) and URL path
const interfaceDefinitions = [
    {
        name: 'BidCos-RF', short: 'rfd', protocol: 'binrpc', port: 'rfd', path: ''
    },
    {
        name: 'HmIP-RF', short: 'hmip', protocol: 'xmlrpc', port: 'hmip', path: ''
    },
    {
        name: 'VirtualDevices', short: 'virtual', protocol: 'xmlrpc', port: 'virtual', path: '/groups'
    }
];

const clone = value => structuredClone(value);

function shortJson(value) {
    const json = JSON.stringify(value);
    return json && json.length > 300 ? json.slice(0, 297) + '...' : json;
}

class SimulatedInterface extends EventEmitter {
    /**
     * @param {CcuSimulator} simulator
     * @param {object} definition - see interfaceDefinitions
     * @param {number} port
     * @param {object[]} devices - device and channel descriptions
     */
    constructor(simulator, definition, port, devices) {
        super();
        Object.assign(this, definition);
        this.simulator = simulator;
        this.listenPort = port;
        this.devices = new Map();
        this.values = new Map();
        this.callbacks = new Map();
        this.server = null;
        // echo values set by ReGaHss as events (like real actors do)
        this.echo = true;
        for (const description of devices) {
            this._addDescription(description);
        }
    }

    get url() {
        return (this.protocol === 'binrpc' ? 'xmlrpc_bin' : 'xmlrpc') + '://127.0.0.1:' + this.listenPort + this.path;
    }

    /** @returns {Array<{url: string, id: string}>} the registrations of ReGaHss (init) */
    registrations() {
        return [...this.callbacks.values()].map(({url, id}) => ({url, id}));
    }

    // interface ID ReGaHss registered with (init), null if not registered
    get interfaceId() {
        const [first] = this.callbacks.values();
        return first ? first.id : null;
    }

    _addDescription(description) {
        this.devices.set(description.ADDRESS, clone(description));
        if (description.PARENT && description.PARAMSETS.includes('VALUES')) {
            const values = {};
            for (const [key, parameter] of Object.entries(this.paramsetDescription(description.ADDRESS, 'VALUES'))) {
                values[key] = parameter.TYPE === 'ENUM' && typeof parameter.DEFAULT === 'string'
                    ? parameter.VALUE_LIST.indexOf(parameter.DEFAULT)
                    : parameter.DEFAULT;
            }

            this.values.set(description.ADDRESS, values);
        }
    }

    /**
     * @param {string} address - channel address
     * @param {string} paramset - VALUES or MASTER
     * @returns {object} paramset description of the channel
     */
    paramsetDescription(address, paramset) {
        const description = this.devices.get(address);
        if (!description || !description.PARENT) {
            return {};
        }

        const key = [description.PARENT_TYPE, description.VERSION, description.TYPE].join('/');
        return (fixtures.paramsets[key] || {})[paramset] || {};
    }

    /**
     * @param {string} address
     * @param {string} key
     * @returns {*} the current value of a datapoint
     */
    value(address, key) {
        return (this.values.get(address) || {})[key];
    }

    log(line) {
        this.simulator.log.push(line);
    }

    // ----- server: methods called by ReGaHss -----

    _methods() {
        return {
            'system.listMethods': () => Object.keys(this._methods()),
            'system.multicall': ([calls]) => calls.map(call => {
                const method = this._methods()[call.methodName];
                return method ? [method(call.params)] : {faultCode: -1, faultString: call.methodName + ': unknown method name'};
            }),
            init: ([url, id]) => {
                if (id === undefined || id === '') {
                    this.callbacks.delete(url);
                } else {
                    this.register(url, id);
                    // (announce the devices once ReGaHss received the response)
                    setImmediate(() => this.syncDevices().catch(error => this.log(`${this.short} sync failed: ${error.message}`)));
                }

                this.emit('init', {url, id});
                return '';
            },
            ping: ([id]) => {
                setImmediate(() => this.event('CENTRAL', 'PONG', id).catch(() => undefined));
                return true;
            },
            listDevices: () => [...this.devices.values()],
            getDeviceDescription: ([address]) => this.devices.get(address) || {faultCode: -2, faultString: 'Unknown instance'},
            getParamsetDescription: ([address, paramset]) => this.paramsetDescription(address, paramset),
            getParamset: ([address, paramset]) => (paramset === 'VALUES' ? clone(this.values.get(address) || {}) : {}),
            getValue: ([address, key]) => this.value(address, key) ?? '',
            setValue: ([address, key, value]) => {
                this.log(`setValue ${this.short} ${address} ${key} ${value}`);
                this.setDeviceValue(address, key, value, this.echo);
                return '';
            },
            putParamset: ([address, paramset, values]) => {
                if (paramset === 'VALUES') {
                    for (const [key, value] of Object.entries(values)) {
                        this.setDeviceValue(address, key, value, this.echo);
                    }
                }

                return '';
            },
            reportValueUsage: () => true,
            getLinks: () => [],
            getLinkPeers: () => [],
            getServiceMessages: () => [],
            getInstallMode: () => 0,
            listBidcosInterfaces: () => [{
                ADDRESS: 'SIM0000001', DESCRIPTION: 'simulated', CONNECTED: true, DEFAULT: true
            }]
        };
    }

    _handle(method, parameters) {
        this.log(`rpc ${this.short} < ${method} ${shortJson(parameters)}`);
        this.simulator.emit('call', {interface: this.name, method, params: parameters});
        const handler = this._methods()[method];
        if (!handler) {
            this.log(`rpc ${this.short} < unknown method ${method}`);
            return {faultCode: -1, faultString: method + ': unknown method name'};
        }

        try {
            return handler(parameters || []);
        } catch (error) {
            this.log(`rpc ${this.short} ${method} failed: ${error.message}`);
            return {faultCode: -1, faultString: error.message};
        }
    }

    async start() {
        this.sockets = new Set();
        if (this.protocol === 'binrpc') {
            await new Promise((resolve, reject) => {
                this.server = binrpc.createServer({host: '127.0.0.1', port: this.listenPort}, resolve);
                this.server.server.once('error', reject);
                this.server.server.on('connection', socket => this._track(socket));
                // (dispatch all methods, the binrpc module does not answer unknown ones)
                this.server.handleCall = (request, socket) => {
                    const result = this._handle(request.method, request.params);
                    // (BIN-RPC faults are not supported by the binrpc module)
                    socket.write(binrpcProtocol.encodeResponse(result && result.faultCode !== undefined ? '' : (result ?? '')));
                };
            });
        } else {
            this.server = new XmlRpcServer({host: '127.0.0.1', port: this.listenPort}, (method, parameters) => this._handle(method, parameters));
            this.server.httpServer.on('connection', socket => this._track(socket));
            await this.server.listen();
        }

        this.log(`${this.short} ${this.protocol} server listening on ${this.listenPort}`);
    }

    _track(socket) {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
    }

    async stop() {
        for (const callback of this.callbacks.values()) {
            this._closeClient(callback.client);
        }

        this.callbacks.clear();
        if (!this.server) {
            return;
        }

        const server = this.protocol === 'binrpc' ? this.server.server : this.server.httpServer;
        this.server = null;
        const closed = new Promise(resolve => {
            server.close(() => resolve());
        });
        // (close the open connections of ReGaHss)
        for (const socket of this.sockets) {
            socket.destroy();
        }

        await closed;
        this.log(`${this.short} server stopped`);
    }

    register(url, id) {
        const [, host, port] = /^\w+:\/\/([^:/]+):(\d+)/.exec(url) || [];
        this.callbacks.set(url, {url, id, client: binrpc.createClient({host, port: Number(port), reconnectTimeout: 0})});
    }

    _closeClient(client) {
        try {
            client.reconnectTimeout = 0;
            client.socket?.destroy();
        } catch {
            // Already closed
        }
    }

    /**
     * Simulates a restart of the interface process: the server is stopped and
     * started again.
     *
     * @param {object} [options]
     * @param {number} [options.downtime=0] - time in ms the interface is not reachable
     * @param {boolean} [options.keepRegistration=true] - keep the registration of
     *     ReGaHss (init) like a persisted client list, otherwise it is lost
     */
    async restart({downtime = 0, keepRegistration = true} = {}) {
        const registrations = [...this.callbacks.values()].map(({url, id}) => ({url, id}));
        await this.stop();
        await new Promise(resolve => {
            setTimeout(resolve, downtime);
        });
        await this.start();
        if (keepRegistration) {
            for (const {url, id} of registrations) {
                this.register(url, id);
            }
        }
    }

    // ----- client: calls to ReGaHss -----

    /**
     * Calls a method of ReGaHss (at all registered callback URLs).
     *
     * @param {string} method
     * @param {Array} parameters - without the interface ID, which is added
     * @returns {Promise<*>} result of the (first) callback
     */
    async call(method, parameters = []) {
        if (this.callbacks.size === 0) {
            throw new Error(this.name + ': ReGaHss is not registered (init)');
        }

        const results = await Promise.all([...this.callbacks.values()].map(callback => this._methodCall(callback, method, [callback.id, ...parameters])));
        return results[0];
    }

    /**
     * Calls a method of ReGaHss with the given parameters (without adding the
     * interface ID).
     *
     * @param {string} method
     * @param {Array} parameters
     * @returns {Promise<*>}
     */
    rawCall(method, parameters = []) {
        const [callback] = this.callbacks.values();
        if (!callback) {
            return Promise.reject(new Error(this.name + ': ReGaHss is not registered (init)'));
        }

        return this._methodCall(callback, method, parameters);
    }

    _methodCall(callback, method, parameters) {
        this.log(`rpc ${this.short} > ${method} ${shortJson(parameters)}`);
        return new Promise((resolve, reject) => {
            callback.client.methodCall(method, parameters, (error, result) => {
                this.log(`rpc ${this.short} > ${method} result ${shortJson(error ? String(error) : result)}`);
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * Compares the devices known by ReGaHss (listDevices) with the devices of
     * the interface and announces the unknown ones (newDevices).
     */
    async syncDevices() {
        const known = await this.call('listDevices');
        const knownVersions = new Map((known || []).map(device => [device.ADDRESS, device.VERSION]));
        const unknown = [...this.devices.values()].filter(device => knownVersions.get(device.ADDRESS) !== device.VERSION);
        if (unknown.length > 0) {
            await this.call('newDevices', [unknown]);
        }

        this.emit('synced', {known: knownVersions.size, announced: unknown.length});
        this.log(`${this.short} devices synced: ReGaHss knows ${knownVersions.size}, announced ${unknown.length}`);
    }

    /**
     * Sends an event (value change of a datapoint) to ReGaHss.
     *
     * @param {string} address
     * @param {string} key
     * @param {*} value
     */
    event(address, key, value) {
        if (this.values.has(address)) {
            this.values.get(address)[key] = value;
        }

        return this.call('event', [address, key, value]);
    }

    /**
     * Sends several events in one system.multicall to ReGaHss.
     *
     * @param {Array<[string, string, *]>} events - [address, key, value]
     */
    multicallEvents(events) {
        if (this.callbacks.size === 0) {
            return Promise.reject(new Error(this.name + ': ReGaHss is not registered (init)'));
        }

        return Promise.all([...this.callbacks.values()].map(callback => this._methodCall(callback, 'system.multicall', [
            events.map(([address, key, value]) => ({methodName: 'event', params: [callback.id, address, key, value]}))
        ])));
    }

    /**
     * Sets a datapoint value of a simulated device (and sends an event, if
     * the datapoint supports events).
     */
    setDeviceValue(address, key, value, sendEvent = true) {
        const values = this.values.get(address);
        if (values) {
            values[key] = value;
        }

        const parameter = this.paramsetDescription(address, 'VALUES')[key];
        // eslint-disable-next-line no-bitwise
        if (sendEvent && parameter && (parameter.OPERATIONS & 4)) {
            setImmediate(() => this.event(address, key, value).catch(error => this.log(`${this.short} event failed: ${error.message}`)));
        }
    }

    /**
     * Adds devices (device and channel descriptions) and announces them to
     * ReGaHss.
     *
     * @param {object[]} descriptions
     */
    async addDevices(descriptions) {
        for (const description of descriptions) {
            this._addDescription(description);
        }

        if (this.callbacks.size > 0) {
            return this.call('newDevices', [descriptions]);
        }
    }

    /**
     * Removes devices and tells ReGaHss to delete them.
     *
     * @param {string[]} addresses - device addresses
     */
    async deleteDevices(addresses) {
        const all = [];
        for (const address of addresses) {
            for (const key of this.devices.keys()) {
                if (key === address || key.startsWith(address + ':')) {
                    this.devices.delete(key);
                    this.values.delete(key);
                    all.push(key);
                }
            }
        }

        return this.call('deleteDevices', [all]);
    }
}

class CcuSimulator extends EventEmitter {
    /**
     * @param {object} options
     * @param {{rfd: number, hmip: number, virtual: number}} options.ports
     * @param {Object<string, object[]>} [options.devices] - devices per interface (default: the
     *     HM-RCV-50 of BidCos-RF, which the test regadom knows)
     * @param {boolean} [options.output] - print the log (SIM_OUTPUT=1)
     */
    constructor({ports, devices = {'BidCos-RF': fixtures.devices['BidCos-RF']}, output = process.env.SIM_OUTPUT === '1'}) {
        super();
        this.output = output;
        this.log = new LogWatcher({name: 'simulator'});
        const push = this.log.push.bind(this.log);
        this.log.push = line => {
            if (this.output) {
                console.log('sim', line);
            }

            push(line);
        };

        this.interfaces = new Map(interfaceDefinitions.map(definition => [
            definition.name,
            new SimulatedInterface(this, definition, ports[definition.port], devices[definition.name] || [])
        ]));
        this.running = false;
    }

    /**
     * @param {string} name - BidCos-RF, HmIP-RF or VirtualDevices (or the short name rfd, hmip, virtual)
     * @returns {SimulatedInterface}
     */
    interface(name) {
        const simulatedInterface = this.interfaces.get(name) || [...this.interfaces.values()].find(item => item.short === name);
        if (!simulatedInterface) {
            throw new Error('unknown interface ' + name);
        }

        return simulatedInterface;
    }

    async start() {
        await Promise.all([...this.interfaces.values()].map(item => item.start()));
        this.running = true;
        CcuSimulator.running.add(this);
        return this;
    }

    async stop() {
        this.running = false;
        CcuSimulator.running.delete(this);
        await Promise.all([...this.interfaces.values()].map(item => item.stop()));
        this.log.fail(new Error('simulator stopped'));
    }

    waitFor(rx, options) {
        return this.log.waitFor(rx, options);
    }

    /**
     * Waits for a call of ReGaHss.
     *
     * @param {string} method
     * @param {object} [options]
     * @param {string} [options.interface] - only calls to this interface
     * @param {function(Array): boolean} [options.match] - filter on the parameters
     * @param {number} [options.timeout=0]
     * @returns {Promise<{interface: string, method: string, params: Array}>}
     */
    waitForCall(method, {interface: name, match = () => true, timeout = 0} = {}) {
        return new Promise((resolve, reject) => {
            let timer = null;
            const listener = call => {
                if (call.method === method && (!name || call.interface === name || this.interface(name).name === call.interface) && match(call.params || [])) {
                    this.off('call', listener);
                    clearTimeout(timer);
                    resolve(call);
                }
            };

            this.on('call', listener);
            if (timeout > 0) {
                timer = setTimeout(() => {
                    this.off('call', listener);
                    reject(new Error('no call of ' + method + (name ? ' on ' + name : '') + ' within ' + timeout + 'ms'));
                }, timeout);
            }
        });
    }
}

CcuSimulator.running = new Set();

/**
 * @param {string} interfaceName
 * @param {string} address - device address
 * @returns {object[]} device and channel descriptions of a fixture device
 */
function fixtureDevice(interfaceName, address) {
    const descriptions = (fixtures.devices[interfaceName] || []).filter(description => description.ADDRESS === address || description.PARENT === address);
    if (descriptions.length === 0) {
        throw new Error('no fixture device ' + address + ' for ' + interfaceName);
    }

    return clone(descriptions);
}

module.exports = {
    CcuSimulator, SimulatedInterface, fixtures, fixtureDevice
};
