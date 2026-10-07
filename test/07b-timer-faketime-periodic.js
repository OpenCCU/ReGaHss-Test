/* global describe */
/* eslint-disable prefer-arrow-callback */

// Timer tests (periodic timers at DST changes and leap/non-leap years) with faked date/time (see lib/timer-test.js)

const {regaLabel} = require('../lib/helper.js');
const {timerTest} = require('../lib/timer-test.js');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // Perform long running regular timer test at DST boundaries
    timerTest('2020-03-29 01:58:40 CET',  'TimeEveryMinute', 'TimerPeriodic (1m) during Winter->Summer DST change', ['2020-03-29 01:59:00 CET', '2020-03-29 03:00:00 CEST', '2020-03-29 03:01:00 CEST'], 70000);
    timerTest('2020-10-25 02:58:40 CEST', 'TimeEveryMinute', 'TimerPeriodic (1m) during Summer->Winter DST change', ['2020-10-25 02:59:00 CEST', '2020-10-25 02:00:00 CET', '2020-10-25 02:01:00 CET'], 70000);

    // Leap/non-leap year tests (Feb, 29. 2020, Feb, 28. 2021)
    timerTest('2020-02-29 01:59:48 CET',  'Time0200',        'TimerFixed @ 02:00 last feb day (leap year)', ['2020-02-29 02:00:00 CET']);
    timerTest('2020-02-29 23:58:48 CET',  'TimeEveryMinute', 'TimerPeriodic (1m) feb month change (leap year)', ['2020-02-29 23:59:00 CET', '2020-03-01 00:00:00 CET'], 70000);
    timerTest('2021-02-28 23:58:48 CET',  'TimeEveryMinute', 'TimerPeriodic (1m) feb month change (non-leap year)', ['2021-02-28 23:59:00 CET', '2021-03-01 00:00:00 CET'], 70000);
});
