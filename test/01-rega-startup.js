/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, prefer-arrow-callback, max-nested-callbacks, capitalized-comments */

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

        describe('running tests', function () {
            // run tests
            it('should start TimerSchedulerThread', function (done) {
                this.timeout(30000);
                subscribe('rega', /TimerSchedulerThread started/, function () {
                    done();
                });
            });

            it('should start IseRTPrgThread', function (done) {
                this.timeout(30000);
                subscribe('rega', /RTPrgThread thread function started/, function () {
                    done();
                });
            });

            it('should init XmlRpcMethodListDevices', function (done) {
                this.timeout(30000);
                subscribe('rega', /Info: InitXmlRpcMethods: XmlRpcMethodListDevices/, function () {
                    done();
                });
            });

            it('should init XmlRpcMethodNewDevices', function (done) {
                this.timeout(30000);
                subscribe('rega', /Info: InitXmlRpcMethods: XmlRpcMethodNewDevices/, function () {
                    done();
                });
            });

            it('should init XmlRpcMethodDeleteDevices', function (done) {
                this.timeout(30000);
                subscribe('rega', /Info: InitXmlRpcMethods: XmlRpcMethodDeleteDevices/, function () {
                    done();
                });
            });

            it('should init XmlRpcMethodReportValueUsage', function (done) {
                this.timeout(30000);
                subscribe('rega', /Info: InitXmlRpcMethods: XmlRpcMethodReportValueUsage/, function () {
                    done();
                });
            });

            it('should init XmlRpcMethodUpdateDevice', function (done) {
                this.timeout(30000);
                subscribe('rega', /Info: InitXmlRpcMethods: XmlRpcMethodUpdateDevice/, function () {
                    done();
                });
            });

            it('should init XmlRpcMethodReplaceDevice', function (done) {
                this.timeout(30000);
                subscribe('rega', /Info: InitXmlRpcMethods: XmlRpcMethodReplaceDevice/, function () {
                    done();
                });
            });

            it('should init XmlRpcMethodSetReadyConfig', function (done) {
                this.timeout(30000);
                subscribe('rega', /Info: InitXmlRpcMethods: XmlRpcMethodSetReadyConfig/, function () {
                    done();
                });
            });

            it('should load /etc/config/homematic.regadom', function (done) {
                this.timeout(30000);
                subscribe('rega', /.*oaded .*homematic\.regadom/, function () {
                    done();
                });
            });

            it('should output build label', function (done) {
                this.timeout(30000);
                rega.exec(`
string build = dom.BuildLabel();
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.build.should.not.equal('undefined');
                        done();
                        console.log(indent(objects.build, 8));
                    }
                });
            });

            it('should execute /bin/hm_startup', function (done) {
                this.timeout(30000);
                subscribe('rega', /Executing \/bin\/hm_startup/, function () {
                    done();
                });
            });

            it('should allow to create >65535 objects', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = 0;
object lastsysvar = null;
system.MaxIterations(1000000);
while((i >= 0) && (i < 600000))
{
  object sysvar = dom.CreateObject(OT_VARDP, "XvarX" # i);
  if(!sysvar) {
    i = -1;
  } else {
    lastsysvar = sysvar;
    i = i + 1;
  }
}
WriteLine(i);
WriteLine(lastsysvar.Name());
if(i != -1)
{
  i = 0;
  integer j = 0;
  while((j < 600000))
  {
    object sysvar = dom.GetObject(i);
    if(sysvar) {
      if(sysvar.Name().StartsWith("XvarX")) {
        j = j + 1;
      }
    }
    i = i + 1;
  }
}
WriteLine(j);
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('600000\r\nXvarX599999\r\n600000\r\n');
                        done();
                        console.log(indent(objects.j, 8));
                    }
                });
            });
        });

        // cleanup Test environment
        cleanupTest(flavor);
    });
});
