/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, max-nested-callbacks, prefer-arrow-callback, capitalized-comments */

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
        initTest(flavor);

        // run tests
        describe('running examples from HM_Script_Teil_2_Objektmodell...', function () {
            it('3.1.3 should return date and time', function (done) {
                this.timeout(30000);
                rega.exec(`
string sDate = system.Date("%d.%m.%Y"); ! sDate = "24.12.2008";
string sTime = system.Date("%H:%M:%S"); ! sTime = "18:30:00";
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.sDate.should.match(/(?:\d{2}\.){2}\d{4}/);
                        objects.sTime.should.match(/\d{2}:\d{2}:\d{2}/);
                        done();
                    }
                });
            });

            it('3.2.3 should return true on system.IsVar()', function (done) {
                this.timeout(30000);
                rega.exec(`
var MY_DEFINE = 1;

if (system.IsVar("MY_DEFINE"))
{
    Write('OK');
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('OK');
                        done();
                    }
                });
            });

            it('3.3.3 should utilize system.GetVar()', function (done) {
                this.timeout(30000);
                rega.exec(`
var myVar = 1;

if (system.IsVar("myVar"))
{
 var x = system.GetVar("myVar");
 x = x + 1;
}

! myVar = 1
! x = 2          
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.myVar.should.equal('1');
                        objects.x.should.equal('2');
                        done();
                    }
                });
            });

            it('4.2 (VarBool1) should do dom.GetObject()', function (done) {
                this.timeout(30000);
                rega.exec(`
var myObject = dom.GetObject("VarBool1");
if (myObject)
{
    Write("OK");
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('OK');
                        done();
                    }
                });
            });

            it('4.3 (VarBool1) should do .ID()', function (done) {
                this.timeout(30000);
                rega.exec(`
var myObject = dom.GetObject("VarBool1");
if (myObject)
{
    Write(myObject.ID());
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('1237');
                        done();
                    }
                });
            });

            it('4.4 (VarBool1) should do .Name()', function (done) {
                this.timeout(30000);
                rega.exec(`
var myObject = dom.GetObject("VarBool1");
if (myObject)
{
    Write(myObject.Name());
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('VarBool1');
                        done();
                    }
                });
            });

            it('4.5 (VarBool1) should do .Type()', function (done) {
                this.timeout(30000);
                rega.exec(`
var myObject = dom.GetObject("VarBool1");
if (myObject)
{
    Write(myObject.Type() == OT_VARDP);
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('true');
                        done();
                    }
                });
            });

            it('4.6 (VarBool1) should do .TypeName()', function (done) {
                this.timeout(30000);
                rega.exec(`
var myObject = dom.GetObject("VarBool1");
if (myObject)
{
    Write(myObject.TypeName());
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('VARDP');
                        done();
                    }
                });
            });

            it('4.7 (VarBool1) should do .IsTypeOf()', function (done) {
                this.timeout(30000);
                rega.exec(`
var myObject = dom.GetObject("VarBool1");
if (myObject.IsTypeOf(OT_VARDP))
{
    Write("OK");
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('OK');
                        done();
                    }
                });
            });
        });

        // cleanup test environment
        cleanupTest(flavor);
    });
});
