/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, camelcase, max-nested-callbacks, prefer-arrow-callback, capitalized-comments */

const {
    cp,
    rega,
    subscribe,
    procs,
    simSubscriptions,
    simBuffer,
    regaSubscriptions,
    regaBuffer,
    flavors,
    indent,
    initTest,
    cleanupTest
} = require('../lib/helper.js');

require('should');

flavors.forEach(function (flavor) {
    describe('Running ' + __filename.split('/').reverse()[0] + ' [' + flavor + ']', function () {
        // initialize test environment
        initTest(flavor, false, '2017-12-01 12:00:00 CET');

        describe('running examples from https://www.homematic-inside.de/tecbase/homematic/scriptlibrary', function () {
            it('testing "tageszeit-in-abschnitte-unterteilen"', function (done) {
                if (!procs.rega) {
                    return this.skip();
                }

                this.timeout(30000);
                rega.exec(`
! Tageszeiten
! Tagesbeginn - 2 Nacht
! Tagesbeginn - 2 Tagesbeginn - 1 frühmorgens
! Tagesbeginn - 1 Tagesbeginn Morgengrauen
! Tagesbeginn Mittag - 1 Vormittag
! Mittag - 1 Mittag + 1 Mittag
! Mittag + 1 Tagesende Nachmittag
! Tagesende Tagesende + 1 Dämmerung
! Tagesende + 1 Tagesende + 2 Abend
! Tagesende + 2 Nacht

real c_zeit = (0.01 * system.Date("%M").ToInteger()) + system.Date("%H").ToInteger();
real c_tagesbeginn = (0.01 * system.SunriseTime("%M").ToInteger()) + system.SunriseTime("%H").ToInteger();
real c_tagesende = (0.01 * system.SunsetTime("%M").ToInteger()) + system.SunsetTime("%H").ToInteger();
real c_mittag = 13.00; ! Mittagszeit

integer v_tageszeit = 0; ! Nacht

if (c_zeit < c_tagesende + 2) {
    v_tageszeit = 7; ! Abend
}

if (c_zeit < c_tagesende + 1) {
    v_tageszeit = 6; ! Abenddaemmerung
}

if (c_zeit < c_tagesende) {
    v_tageszeit = 5; ! Nachmittag
}

if (c_zeit < c_mittag + 1) {
    v_tageszeit = 4; ! Mittag
}

if (c_zeit < c_mittag - 1) {
    v_tageszeit = 3; ! Vormittag
}

if (c_zeit < c_tagesbeginn) {
    v_tageszeit = 2; ! Morgengrauen
}

if (c_zeit < c_tagesbeginn - 1) {
    v_tageszeit = 1; ! fruemorgens;
}

if (c_zeit < c_tagesbeginn - 2) {
    v_tageszeit = 0; ! Nacht
}

! dom.GetObject("Tageszeit").State(v_tageszeit);
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.should.containEql({
                            c_zeit: '12.000000',
                            c_tagesbeginn: '7.560000',
                            c_tagesende: '15.560000',
                            c_mittag: '13.000000',
                            v_tageszeit: '4'
                        });
                        done();
                    }
                });
            });
        });

        // cleanup test environment
        cleanupTest(flavor);
    });
});
