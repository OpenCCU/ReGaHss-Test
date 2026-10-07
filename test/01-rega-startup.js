/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

const {
    rega,
    regaLabel,
    regaEmulator,
    indent,
    initTest,
    cleanupTest,
    waitForRega
} = require('../lib/helper.js');

require('should');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest();

    describe('running tests', function () {
        // run tests
        it('should start TimerSchedulerThread', async function () {
            this.timeout(30000);
            await waitForRega(/TimerSchedulerThread started/);
        });

        it('should start IseRTPrgThread', async function () {
            this.timeout(30000);
            await waitForRega(/RTPrgThread thread function started/);
        });

        it('should init XmlRpcMethodListDevices', async function () {
            this.timeout(30000);
            await waitForRega(/Info: InitXmlRpcMethods: XmlRpcMethodListDevices/);
        });

        it('should init XmlRpcMethodNewDevices', async function () {
            this.timeout(30000);
            await waitForRega(/Info: InitXmlRpcMethods: XmlRpcMethodNewDevices/);
        });

        it('should init XmlRpcMethodDeleteDevices', async function () {
            this.timeout(30000);
            await waitForRega(/Info: InitXmlRpcMethods: XmlRpcMethodDeleteDevices/);
        });

        it('should init XmlRpcMethodReportValueUsage', async function () {
            this.timeout(30000);
            await waitForRega(/Info: InitXmlRpcMethods: XmlRpcMethodReportValueUsage/);
        });

        it('should init XmlRpcMethodUpdateDevice', async function () {
            this.timeout(30000);
            await waitForRega(/Info: InitXmlRpcMethods: XmlRpcMethodUpdateDevice/);
        });

        it('should init XmlRpcMethodReplaceDevice', async function () {
            this.timeout(30000);
            await waitForRega(/Info: InitXmlRpcMethods: XmlRpcMethodReplaceDevice/);
        });

        it('should init XmlRpcMethodSetReadyConfig', async function () {
            this.timeout(30000);
            await waitForRega(/Info: InitXmlRpcMethods: XmlRpcMethodSetReadyConfig/);
        });

        it('should load homematic.regadom', async function () {
            this.timeout(30000);
            await waitForRega(/.*oaded .*homematic\.regadom/);
        });

        it('should output build label', async function () {
            this.timeout(30000);
            const {objects} = await rega.exec(`
string build = dom.BuildLabel();
                `);
            objects.build.should.not.equal('undefined');
            console.log(indent(objects.build, 8));
        });

        it('should execute /bin/hm_startup', async function () {
            this.timeout(30000);
            // (ReGaHss writes its own "Executing /bin/hm_startup in forked child"
            // line in several pieces, which other log output can interleave with,
            // whereas the output of the hook script is written at once)
            await waitForRega(/\/bin\/hm_startup executed/);
        });

        it('should allow to create >65535 objects', async function () {
            // (CPU bound: takes a multiple of the time when ReGaHss is emulated)
            this.timeout(regaEmulator ? 300_000 : 30_000);
            const {output, objects} = await rega.exec(`
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
                `);
            output.should.equal('600000\r\nXvarX599999\r\n600000\r\n');
            console.log(indent(objects.j, 8));
        });
    });

    // cleanup Test environment
    cleanupTest();
});
