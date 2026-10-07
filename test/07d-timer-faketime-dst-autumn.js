/* global describe */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Timer tests (fixed and periodic timers around the end of DST (summer->winter)) with faked date/time (see lib/timer-test.js)

const {regaLabel} = require('../lib/helper.js');
const {timerTest} = require('../lib/timer-test.js');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // -> end of DST (summer->winter) in leap year
    timerTest('2020-10-24 23:58:48 CEST', 'TimeEveryMinute', 'TimerPeriodic (1m) during day change one day before Summer->Winter DST change', ['2020-10-24 23:59:00 CEST', '2020-10-25 00:00:00 CEST', '2020-10-25 00:01:00 CEST'], 70000); // day switch before DST switchdate
    timerTest('2020-10-25 00:59:48 CEST', 'Time0100',        'TimerFixed @ 01:00 before Summer->Winter DST change', ['2020-10-25 01:00:00 CEST']);
    timerTest('2020-10-25 01:29:48 CEST', 'Time0130',        'TimerFixed @ 01:30 before Summer->Winter DST change', ['2020-10-25 01:30:00 CEST']);
    timerTest('2020-10-25 01:54:48 CEST', 'Time0155',        'TimerFixed @ 01:55 before Summer->Winter DST change', ['2020-10-25 01:55:00 CEST']);
    timerTest('2020-10-25 01:59:48 CEST', 'Time0200',        'TimerFixed @ 02:00 before Summer->Winter DST change', ['2020-10-25 02:00:00 CEST']);
    timerTest('2020-10-25 02:04:48 CEST', 'Time0205',        'TimerFixed @ 02:05 before Summer->Winter DST change', ['2020-10-25 02:05:00 CEST']);
    timerTest('2020-10-25 02:29:48 CEST', 'Time0230',        'TimerFixed @ 02:30 before Summer->Winter DST change', ['2020-10-25 02:30:00 CEST']);
    timerTest('2020-10-25 02:54:48 CEST', 'Time0255',        'TimerFixed @ 02:55 before Summer->Winter DST change', ['2020-10-25 02:55:00 CEST']);
    // timerTest('2020-10-25 02:59:48 CEST', 'Time0200',        'TimerFixed @ 02:00 between Summer->Winter DST change'); // @ 03:00 (CEST) time will be switch to 02:00 (CET), thus Time0200 should usually trigger (but this is not possible)
    // timerTest('2020-10-25 02:04:48 CET', 'Time0205',         'TimerFixed @ 02:05 after Summer->Winter DST change'); // @ 02:05 (CET) is not possible in ReGaHss
    timerTest('2020-10-25 02:59:48 CET', 'Time0300',         'TimerFixed @ 03:00 after Summer->Winter DST change', ['2020-10-25 03:00:00 CET']);
    timerTest('2020-10-25 03:04:48 CET', 'Time0305',         'TimerFixed @ 03:05 after Summer->Winter DST change', ['2020-10-25 03:05:00 CET']);
    timerTest('2020-10-25 03:29:48 CET', 'Time0330',         'TimerFixed @ 03:30 after Summer->Winter DST change', ['2020-10-25 03:30:00 CET']);
    timerTest('2020-10-25 23:58:48 CET', 'TimeEveryMinute',  'TimerPeriodic (1m) during day change one day after Summer->Winter DST change', ['2020-10-25 23:59:00 CET', '2020-10-26 00:00:00 CET', '2020-10-26 00:01:00 CET'], 70000); // day switch after DST switchdate
});
