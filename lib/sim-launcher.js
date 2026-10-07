#!/usr/bin/env node

// Starts hm-simulator (simulated rfd/hmipserver) on the ports given by the
// environment variables SIM_BINRPC_PORT and SIM_XMLRPC_PORT instead of the
// ports hard coded in its config.js.

const path = require('path');

const simMain = require.resolve('hm-simulator');
const configFile = path.join(path.dirname(simMain), 'config.js');

require.cache[configFile] = {
    id: configFile,
    filename: configFile,
    loaded: true,
    exports: {
        listenAddress: '127.0.0.1',
        binrpcListenPort: Number(process.env.SIM_BINRPC_PORT || 2001),
        xmlrpcListenPort: Number(process.env.SIM_XMLRPC_PORT || 2010)
    }
};

require(simMain);
