/* global describe  */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {
    regaLabel,
    initTest,
    cleanupTest
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest();

    // cleanup test environment
    cleanupTest();
});
