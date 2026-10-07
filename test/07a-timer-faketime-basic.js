/* global describe */
/* eslint-disable prefer-arrow-callback */

// Timer tests (fixed and periodic timers, astro (day/night) switches and year change) with faked date/time (see lib/timer-test.js)

const {regaLabel} = require('../lib/helper.js');
const {timerTest} = require('../lib/timer-test.js');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // Perform normal timer test for single execution
    timerTest('2020-01-01 23:59:48 CET',  'Time0000', 'TimerFixed @ 00:00', ['2020-01-02 00:00:00 CET']);
    timerTest('2020-01-01 00:29:48 CET',  'Time0030', 'TimerFixed @ 00:30', ['2020-01-01 00:30:00 CET']);
    timerTest('2020-01-01 00:59:48 CET',  'Time0100', 'TimerFixed @ 01:00', ['2020-01-01 01:00:00 CET']);

    // Perform test of the short 10s timers
    timerTest('2020-01-01 00:00:00 CET',  'TimeEvery10s', 'TimerPeriodic (10s) on new year', ['2020-01-01 00:00:10 CET', '2020-01-01 00:00:20 CET'], 30000);
    timerTest('2020-03-29 01:59:49 CET',  'TimeEvery10s', 'TimerPeriodic (10s) during Winter->Summer DST change', ['2020-03-29 03:00:00 CEST', '2020-03-29 03:00:10 CEST', '2020-03-29 03:00:20 CEST', '2020-03-29 03:00:30 CEST'], 30000);
    timerTest('2020-10-25 02:59:49 CEST', 'TimeEvery10s', 'TimerPeriodic (10s) during Summer->Winter DST change', ['2020-10-25 02:00:00 CET', '2020-10-25 02:00:10 CET', '2020-10-25 02:00:20 CET', '2020-10-25 02:00:30 CET'], 30000);

    // Perform test of day/night astro switches (Europe/Berlin) in DST and
    // and non-DST times
    timerTest('2017-12-01 07:55:48 CET',  'TimeSpanDay',   'TimeSpanDay switch @ 07:56 (CET)', ['2017-12-01 07:56:00 CET']);
    timerTest('2017-12-01 15:55:48 CET',  'TimeSpanNight', 'TimeSpanNight switch @ 15:56 (CET)', ['2017-12-01 15:56:00 CET']);
    timerTest('2019-03-31 06:41:48 CEST', 'TimeSpanDay',   'TimeSpanDay switch @ 06:42 on winter->summer day', ['2019-03-31 06:42:00 CEST']);
    timerTest('2019-03-31 19:35:48 CEST', 'TimeSpanNight', 'TimeSpanNight switch @ 19:36 on winter->summer day', ['2019-03-31 19:36:00 CEST']);
    timerTest('2019-04-01 06:38:48 CEST', 'TimeSpanDay',   'TimeSpanDay switch @ 06:39 (CEST)', ['2019-04-01 06:39:00 CEST']);
    timerTest('2019-04-01 19:38:48 CEST', 'TimeSpanNight', 'TimeSpanNight switch @ 19:39 (CEST)', ['2019-04-01 19:39:00 CEST']);
    timerTest('2019-10-27 06:59:48 CET',  'TimeSpanDay',   'TimeSpanDay switch @ 07:00 on summer->winter day', ['2019-10-27 07:00:00 CET']);
    timerTest('2019-10-27 16:39:48 CET',  'TimeSpanNight', 'TimeSpanNight switch @ 16:40 on summer->winter day', ['2019-10-27 16:40:00 CET']);

    // Perform long running timer test for year switch
    timerTest('2019-12-31 23:58:48 CET',  'TimeEveryMinute', 'TimerPeriodic (1m) during year change', ['2019-12-31 23:59:00 CET', '2020-01-01 00:00:00 CET', '2020-01-01 00:01:00 CET'], 65000);
});
