/* global describe */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Timer tests (fixed and periodic timers around the start of DST (winter->summer)) with faked date/time (see lib/timer-test.js)

const {regaLabel} = require('../lib/helper.js');
const {timerTest} = require('../lib/timer-test.js');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // -> start of DST (winter->summer) in leap year
    timerTest('2020-03-28 23:58:48 CET',  'TimeEveryMinute', 'TimerPeriodic (1m) during day change one day before Winter->Summer DST change', ['2020-03-28 23:59:00 CET', '2020-03-29 00:00:00 CET', '2020-03-29 00:01:00 CET'], 70000); // day switch before DST switchdate
    timerTest('2020-03-29 00:59:48 CET',  'Time0100',        'TimerFixed @ 01:00 before Winter->Summer DST change', ['2020-03-29 01:00:00 CET']);
    timerTest('2020-03-29 01:29:48 CET',  'Time0130',        'TimerFixed @ 01:30 before Winter->Summer DST change', ['2020-03-29 01:30:00 CET']);
    timerTest('2020-03-29 01:54:48 CET',  'Time0155',        'TimerFixed @ 01:55 before Winter->Summer DST change', ['2020-03-29 01:55:00 CET']);
    timerTest('2020-03-29 01:59:48 CET',  'Time0200',        'TimerFixed @ 02:00 between Winter->Summer DST change', ['2020-03-29 03:00:00 CEST']);
    // timerTest('2020-03-29 02:04:48 CET', 'Time0205'); // not in DST
    // timerTest('2020-03-29 02:29:48 CET', 'Time0230'); // not in DST
    // timerTest('2020-03-29 02:54:48 CET', 'Time0255'); // not in DST
    // timerTest('2020-03-29 02:59:48 CET', 'Time0300'); // not in DST
    timerTest('2020-03-29 03:04:48 CEST', 'Time0305',        'TimerFixed @ 03:05 after Winter->Summer DST change', ['2020-03-29 03:05:00 CEST']);
    timerTest('2020-03-29 03:29:48 CEST', 'Time0330',        'TimerFixed @ 03:30 after Winter->Summer DST change', ['2020-03-29 03:30:00 CEST']);
    timerTest('2020-03-29 23:58:48 CEST', 'TimeEveryMinute', 'TimerPeriodic (1m) during day change one day after Winter->Summer DST change', ['2020-03-29 23:59:00 CEST', '2020-03-30 00:00:00 CEST', '2020-03-30 00:01:00 CEST'], 70000); // day switch after DST switchdate
});
