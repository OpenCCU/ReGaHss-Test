/* global describe, it, before, after */
/* eslint-disable no-unused-vars, max-nested-callbacks, prefer-arrow-callback, capitalized-comments */

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    waitForRega,
    regaInstance,
    requireRegaVersion
} = require('../lib/helper.js');
const {createSysvars, createProgram, set, value} = require('../lib/script-helpers.js');

require('should');

const net = require('net');

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    // initialize test environment
    initTest(false);

    describe('running bug fix tests...', function () {
        it('correct date/time output at DST boundaries', function (done) {
            this.timeout(30000);
            rega.exec(`
var t0=@2016-10-30 01:59:57@;
var x0=t0.ToInteger();
var j=0;

WriteLine("");
while (j<3)
{
  var i=0;
  while(i<6)
  {
    var x1=x0+i+(j*3600);
    var t1=x1.ToTime();
    var lt=t1.IsLocalTime();
    var sz=t1.IsDST();
    var ts=t1.Format('%F %T %z %Z');
    WriteLine(x1#" "#lt#" "#sz#" "#ts);
    i=i+1;
  }
  j=j+1;
}
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal(`\r
1477785597 1 1 2016-10-30 01:59:57 +0200 CEST\r
1477785598 1 1 2016-10-30 01:59:58 +0200 CEST\r
1477785599 1 1 2016-10-30 01:59:59 +0200 CEST\r
1477785600 1 1 2016-10-30 02:00:00 +0200 CEST\r
1477785601 1 1 2016-10-30 02:00:01 +0200 CEST\r
1477785602 1 1 2016-10-30 02:00:02 +0200 CEST\r
1477789197 1 1 2016-10-30 02:59:57 +0200 CEST\r
1477789198 1 1 2016-10-30 02:59:58 +0200 CEST\r
1477789199 1 1 2016-10-30 02:59:59 +0200 CEST\r
1477789200 1 0 2016-10-30 02:00:00 +0100 CET\r
1477789201 1 0 2016-10-30 02:00:01 +0100 CET\r
1477789202 1 0 2016-10-30 02:00:02 +0100 CET\r
1477792797 1 0 2016-10-30 02:59:57 +0100 CET\r
1477792798 1 0 2016-10-30 02:59:58 +0100 CET\r
1477792799 1 0 2016-10-30 02:59:59 +0100 CET\r
1477792800 1 0 2016-10-30 03:00:00 +0100 CET\r
1477792801 1 0 2016-10-30 03:00:01 +0100 CET\r
1477792802 1 0 2016-10-30 03:00:02 +0100 CET\r
`);
                    done();
                }
            });
        });

        it('empty line comment', function (done) {
            this.timeout(30000);
            rega.exec(`
! Die nächste Zeile ist ein leerer Kommentar
!
string MyString = "Hallo Welt!"; ! Dies ist ebenfalls ein Kommentar
               `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    objects.MyString.should.equal('Hallo Welt!');
                    done();
                }
            });
        });

        it('can deal with unclosed <html tags', function (done) {
            this.timeout(30000);
            rega.exec(`
string a = "Das ist ein <html & Test";
               `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    objects.a.should.equal('Das ist ein <html & Test');
                    done();
                }
            });
        });

        it('should handle special chars in method call', function (done) {
            this.timeout(30000);
            rega.exec(`
string a = "Hallo\\tWelt";
integer b = a.Find("\\t");
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    objects.a.should.equal('Hallo\tWelt');
                    objects.b.should.equal('5');
                    done();
                }
            });
        });

        it('should be able to handle more than 200 variables', function (done) {
            this.timeout(30000);
            let prg = '';
            let result = '';
            for (let i = 1; i <= 1000; i++) {
                prg = prg + 'var i' + i + '=' + i + '; if(i' + i + '==' + i + ') { WriteLine(i' + i + '); }\n';
                result = result + i + '\r\n';
            }

            rega.exec(prg, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    objects.i876.should.equal('876');
                    output.should.equal(result);
                    done();
                }
            });
        });

        it('floating-point accuracy test', function (done) {
            this.timeout(30000);
            rega.exec(`
real lReal1 = 0.7;
real lReal2 = 0.4;
real lReal3 = lReal1 - lReal2;
boolean diff1 = (lReal3 == 0.3);

real lReal4 = "1.1920928955078125E-07".ToFloat();
real lReal5 = lReal2 + lReal4;
boolean diff2 = (lReal2 != lReal5);

real lReal6 = "2.2204460492503131e-16".ToFloat();
real lReal7 = lReal2 + lReal6;
boolean diff3 = (lReal2 == lReal7);

boolean diff4 = (lReal3.ToString(20) == (0.3).ToString(30));
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    objects.diff1.should.equal('true');
                    objects.diff2.should.equal('true');
                    objects.diff3.should.equal('true');
                    objects.diff4.should.equal('true');
                    done();
                }
            });
        });

        it('should allow object names starting with number', function (done) {
            this.timeout(30000);
            rega.exec(`
object obj = dom.GetObject("2Light");
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    objects.obj.should.equal('null');
                    done();
                }
            });
        });

        it('should handle umlauts in ToUTF8().UriEncode()/UriDecode()', function (done) {
            this.timeout(30000);
            rega.exec(`
string str = " !\\"#$%&'()öäüÖÄÜß";
string kodiert = str.ToUTF8().UriEncode(); ! kodiert = %20%21%22%23%24%25%26%27%28%29%C3%B6%C3%A4%C3%BC%C3%96%C3%84%C3%9C%C3%9F
string dekodiert = kodiert.UriDecode().ToLatin(); ! dekodiert = !"#$%&\\'()öäüÖÄÜß
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    objects.kodiert.should.equal('%20%21%22%23%24%25%26%27%28%29%C3%B6%C3%A4%C3%BC%C3%96%C3%84%C3%9C%C3%9F');
                    objects.dekodiert.should.equal(' !"#$%&\'()öäüÖÄÜß');
                    done();
                }
            });
        });

        // see https://github.com/jens-maus/RaspberryMatic/issues/870
        it('should have xml response overflow fixed', function (done) {
            this.timeout(30000);
            rega.exec(`
var aaaaaaaaaaaaa = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
WriteLine("SUCCESS");
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal('SUCCESS\r\n');
                    done();
                }
            });
        });

        // see https://github.com/jens-maus/RaspberryMatic/issues/847
        it('should have system.Exec() stdin blocking fixed', function (done) {
            this.timeout(30000);
            rega.exec(`
string stdout;
string stderr;
system.Exec("cat", &stdout, &stderr);
WriteLine("SUCCESS");
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal('SUCCESS\r\n');
                    done();
                }
            });
        });

        // see https://github.com/jens-maus/RaspberryMatic/issues/847
        it('allows a 4th stdin parameter with system.Exec()', function (done) {
            this.timeout(30000);
            rega.exec(`
string stdout;
string stderr;
string stdin="SUCCESS";
system.Exec("cat", &stdout, &stderr, stdin);
WriteLine(stdout);
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal('SUCCESS\r\n');
                    done();
                }
            });
        });

        // see https://github.com/jens-maus/RaspberryMatic/issues/876
        it('allows a 2nd parameter with dom.GetObject()', function (done) {
            this.timeout(30000);
            rega.exec(`
object obj = dom.GetObject("VarString1", OT_VARDP);
WriteLine(obj.Name());
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal('VarString1\r\n');
                    done();
                }
            });
        });

        // see https://github.com/jens-maus/RaspberryMatic/issues/878
        it('should have nested break/continue fixed', function (done) {
            this.timeout(30000);
            rega.exec(`
Write("START");
string LISTE1 = ("A\\tB\\tC\\tD");
string ELEMENT1;
string LISTE2 = ("1\\t2\\t3\\t4");
string ELEMENT2;
boolean GEFUNDEN = false;
foreach(ELEMENT1, LISTE1)
{
  Write("-");
  if(GEFUNDEN) { Write("break1"); break; }

  foreach(ELEMENT2, LISTE2)
  {
    Write(".");
    if((ELEMENT2 == 3) && (ELEMENT1 == "C")) { GEFUNDEN = true; }
  }

  Write("x");
  if(GEFUNDEN) { Write("break2"); break; }
}
WriteLine("END");
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal('START-....x-....x-....xbreak2END\r\n');
                    done();
                }
            });
        });

        // see https://github.com/jens-maus/RaspberryMatic/issues/883
        it('should allow .ToFloat() also on real/integer variables', function (done) {
            this.timeout(30000);
            rega.exec(`
var Test = 2;
var Test2;
Test2 = Test.ToFloat();
WriteLine(":"#Test2);
var Test3;
Test3 = Test.ToInteger();
WriteLine(":"#Test3);
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal(':2.000000\r\n:2\r\n');
                    done();
                }
            });
        });

        // see https://github.com/jens-maus/RaspberryMatic/issues/922
        it('should have nested method calls fixed', function (done) {
            this.timeout(30000);
            rega.exec(`
string stdout;
string stderr;
string str="XXecho -n hallo";
system.Exec(str.Substr(2), &stdout, &stderr);
WriteLine(stdout);
WriteLine("SUCCESS");
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal('hallo\r\nSUCCESS\r\n');
                    done();
                }
            });
        });

        it('operand tests', function (done) {
            this.timeout(30000);
            rega.exec(`
WriteLine("");
Write("01: ");WriteLine("1" + 2);
Write("02: ");WriteLine(1 + 2);
Write("03: ");WriteLine(1 + "2");
Write("04: ");WriteLine(1 + "2" + 3);
Write("05: ");WriteLine(1 + 2 + "3");
Write("06: ");WriteLine(1 + "2" + "3");
Write("07: ");WriteLine("1" + 2 + 3);
Write("08: ");WriteLine("1" + 2 + "3");
Write("09: ");WriteLine("1" + "2" + 3);
Write("10: ");WriteLine("1" + "2" + "3");
                `, function (error, output, objects) {
                if (error) {
                    done(error);
                } else {
                    output.should.equal(`\r
01: 12\r
02: 3\r
03: 3\r
04: 24\r
05: 6\r
06: 24\r
07: 15\r
08: 15\r
09: 123\r
10: 123\r
`);
                    done();
                }
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/3048
        describe('IP data point State() tests', function () {
            // TCP server receiving the texts sent by the IP data point (one
            // connection per text)
            const received = [];
            let server = null;
            let dpId = null;

            // waits until the TCP server received count texts
            async function receivedTexts(count) {
                const deadline = Date.now() + 10_000;
                while (received.length < count && Date.now() < deadline) {
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise(resolve => {
                        setTimeout(resolve, 50);
                    });
                }

                return received;
            }

            // fixed in ReGaHss R1.00.0388.0257
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0257');
            });

            before(async function () {
                server = net.createServer(socket => {
                    const chunks = [];
                    socket.on('data', chunk => chunks.push(chunk));
                    socket.on('close', () => received.push(Buffer.concat(chunks).toString('latin1')));
                    socket.on('error', () => undefined);
                });
                await new Promise(resolve => {
                    server.listen(0, '127.0.0.1', resolve);
                });
            });

            after(function () {
                // (not created if the tests were skipped)
                server?.close();
            });

            it('should create an IP data point', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
object o = dom.CreateObject(OT_IPDP, "IPDP State Test");
o.IpAddress("127.0.0.1");
o.IpPort(${server.address().port});
Write(o.ID());
                `);
                dpId = Number(output);
                dpId.should.be.above(0);
            });

            it('should send the text of State() unchanged', async function () {
                this.timeout(60_000);
                // (texts which were rejected or converted because of the
                // value type guessed from the text)
                const texts = ['x<y', '<empty>', 'test', 'nachricht', 'dim 50%', '1,5', '12:00', 'Wert 2025-03-06'];
                for (const [index, text] of texts.entries()) {
                    // eslint-disable-next-line no-await-in-loop
                    const {output} = await rega.exec(`Write(dom.GetObject(${dpId}).State("${text}"));`);
                    output.should.equal('true', 'State("' + text + '")');
                    // eslint-disable-next-line no-await-in-loop
                    await receivedTexts(index + 1);
                }

                received.should.deepEqual(texts);
            });

            it('should send the text of a delayed State() unchanged', async function () {
                this.timeout(30_000);
                const count = received.length;
                const {output} = await rega.exec(`Write(dom.GetObject(${dpId}).State("delayed <x>", 300));`);
                output.should.equal('true');
                const texts = await receivedTexts(count + 1);
                texts.slice(count).should.deepEqual(['delayed <x>']);
            });

            it('should delete the IP data point', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`Write(dom.DeleteObject(dom.GetObject(${dpId})));`);
                output.should.equal('true');
            });
        });

        describe('UserSharedObjects() tests', function (done) {
            it('should add fake objects', function (done) {
                this.timeout(30000);
                rega.exec(`
object sysvar1 = dom.CreateObject(OT_VARDP, "Real-SysVarDP");
object sysvar2 = dom.CreateObject(OT_ALARMDP, "Real-AlarmDP");
object sysvar3 = dom.CreateObject(OT_DP, "Removed-DP");
dom.GetObject(ID_SYSTEM_VARIABLES).Add(sysvar1.ID());
dom.GetObject(ID_SYSTEM_VARIABLES).Add(sysvar2.ID());
dom.GetObject(ID_SYSTEM_VARIABLES).Add(sysvar3.ID());
object user = dom.GetObject(ID_USERS).Get("Admin");
user.UserSharedObjects().Add(sysvar1.ID());
user.UserSharedObjects().Add(sysvar2.ID());
user.UserSharedObjects().Add(sysvar3.ID());
user.UserSharedObjects().Add("33333");
user.UserSharedObjects().Add("33334");
user.UserSharedObjects().Add("33335");
user.UserSharedObjects().Add("33336");
dom.DeleteObject(sysvar3);
                    `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.should.containEql({
                            sysvar1: 'Real-SysVarDP',
                            sysvar2: 'Real-AlarmDP',
                            sysvar3: 'null',
                            user: 'Admin'
                        });
                        done();
                    }
                });
            });

            it('should have removed DP cleared immediately', function (done) {
                this.timeout(30000);
                rega.exec(`
object user = dom.GetObject('Admin');
string objID;
foreach(objID, user.UserSharedObjects())
{
  object obj = dom.GetObject(objID);
  object sysVarObj = dom.GetObject(ID_SYSTEM_VARIABLES).Get(objID);
  if((!obj) || (!sysVarObj) || ((obj.Type() != OT_VARDP) && (obj.Type() != OT_ALARMDP)))
  {
    WriteLine(objID);
  }
}
                    `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('33333\r\n33334\r\n33335\r\n33336\r\n');
                        done();
                    }
                });
            });

            describe('should have invalid DP cleared upon ReGa start', function (done) {
                it('saving regadom', function (done) {
                    this.timeout(30000);

                    // save regadom as is.
                    rega.exec('system.Save();', function (error, output, objects) {
                        if (error) {
                            done(error);
                        } else {
                            done();
                        }
                    });
                });

                // cleanup test environment (stop ReGaHss)
                cleanupTest();

                // init test environment (start ReGa)
                initTest(false, null, null, true);

                describe('running test', function (done) {
                    it('should have cleared invalid DP', function (done) {
                        this.timeout(30000);
                        rega.exec(`
object user = dom.GetObject('Admin');
string objID;
foreach(objID, user.UserSharedObjects())
{
  object obj = dom.GetObject(objID);
  object sysVarObj = dom.GetObject(ID_SYSTEM_VARIABLES).Get(objID);
  if((!obj) || (!sysVarObj) || ((obj.Type() != OT_VARDP) && (obj.Type() != OT_ALARMDP)))
  {
    WriteLine(objID);
  }
}
WriteLine("done");
                            `, function (error, output, objects) {
                            if (error) {
                                done(error);
                            } else {
                                output.should.equal('done\r\n');
                                done();
                            }
                        });
                    });
                });
            });
        });

        describe('Channel() removal tests', function (done) {
            it('should add fake objects', function (done) {
                this.timeout(30000);
                rega.exec(`
object channel = dom.CreateObject(OT_CHANNEL, "Testchannel");
dom.GetObject(ID_DATAPOINTS).Add(channel.ID());
object sysvar = dom.CreateObject(OT_VARDP, "Test-SysVar");
sysvar.Channel(channel.ID());
object alarmvar = dom.CreateObject(OT_ALARMDP, "Test-AlarmVar");
alarmvar.Channel(channel.ID());
dom.GetObject(ID_SYSTEM_VARIABLES).Add(sysvar.ID());
dom.GetObject(ID_SYSTEM_VARIABLES).Add(alarmvar.ID());
dom.DeleteObject(channel);
                    `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.should.containEql({
                            sysvar: 'Test-SysVar',
                            alarmvar: 'Test-AlarmVar',
                            channel: 'null'
                        });
                        done();
                    }
                });
            });

            it('should have removed Channel-DP immediately', function (done) {
                this.timeout(30000);
                rega.exec(`
object sysVarObj = dom.GetObject(ID_SYSTEM_VARIABLES).Get("Test-SysVar");
object alarmVarObj = dom.GetObject(ID_SYSTEM_VARIABLES).Get("Test-AlarmVar");
WriteLine(sysVarObj.Channel());
WriteLine(alarmVarObj.Channel());
                    `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('65535\r\n65535\r\n');
                        done();
                    }
                });
            });

            describe('should have invalid DP cleared upon ReGa start', function (done) {
                it('saving regadom', function (done) {
                    this.timeout(30000);

                    // save regadom as is.
                    rega.exec('system.Save();', function (error, output, objects) {
                        if (error) {
                            done(error);
                        } else {
                            done();
                        }
                    });
                });

                // cleanup test environment (stop ReGaHss)
                cleanupTest();

                // init test environment (start ReGa)
                initTest(false, null, null, true);

                describe('running test', function (done) {
                    it('should have cleared invalid DP', function (done) {
                        this.timeout(30000);
                        rega.exec(`
object sysVarObj = dom.GetObject(ID_SYSTEM_VARIABLES).Get("Test-SysVar");
object alarmVarObj = dom.GetObject(ID_SYSTEM_VARIABLES).Get("Test-AlarmVar");
WriteLine(sysVarObj.Channel());
WriteLine(alarmVarObj.Channel());
                            `, function (error, output, objects) {
                            if (error) {
                                done(error);
                            } else {
                                output.should.equal('65535\r\n65535\r\n');
                                done();
                            }
                        });
                    });
                });
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/3179
        describe('DayProfileEntry() index range tests', function () {
            // (only the entries 0..23 of a day profile are persisted, thus
            // DayProfileEntry() only accepts these indices)
            const getProgram = 'object prg = dom.GetObject(ID_PROGRAMS).Get("DayProfileTest");';

            // fixed in ReGaHss R1.00.0388.0257
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0257');
            });

            it('should create a program', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
object prg = dom.CreateObject(OT_PROGRAM, "DayProfileTest");
dom.GetObject(ID_PROGRAMS).Add(prg.ID());
prg.PrgInfo("DayProfileInfo");
WriteLine(prg.DayTypeProgId());
                `);
                output.should.equal('65535\r\n');
            });

            it('should read/write the valid indices 0..23', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
${getProgram}
integer i = 0;
while (i < 24) {
  prg.DayProfileEntry(i, (i + 1) * 100);
  i = i + 1;
}
WriteLine(prg.DayProfileEntry(0) # " " # prg.DayProfileEntry(5) # " " # prg.DayProfileEntry(23));
WriteLine(prg.DayProfileEntry(1, -5) # " " # prg.DayProfileEntry(1));
                `);
                output.should.equal('100 600 2400\r\ntrue -5\r\n');
            });

            it('should reject out-of-range indices without touching other program properties', async function () {
                this.timeout(30_000);
                // (49/51 accessed DayTypeProgId()/PrgInfo(), -1 the array
                // header and 4294967301 was truncated to the index 5 before)
                const warning = waitForRega(/WARNING: incorrect use of DayProfileEntry\(\): index must be >= 0 and < 24 \(49\)/, {buffered: false});
                // (no unhandled rejection if ReGaHss crashes after the output check failed)
                warning.catch(() => undefined);
                const {output} = await rega.exec(`
${getProgram}
WriteLine(prg.DayProfileEntry(-1, 4711) # " " # prg.DayProfileEntry(-1));
WriteLine(prg.DayProfileEntry(24, 4711) # " " # prg.DayProfileEntry(24));
WriteLine(prg.DayProfileEntry(47, 4711) # " " # prg.DayProfileEntry(47));
WriteLine(prg.DayProfileEntry(49, 4711) # " " # prg.DayProfileEntry(49));
WriteLine(prg.DayProfileEntry(51, 4711) # " " # prg.DayProfileEntry(51));
WriteLine(prg.DayProfileEntry(4294967301, 4711) # " " # prg.DayProfileEntry(4294967301) # " " # prg.DayProfileEntry(5));
WriteLine(prg.DayTypeProgId() # " " # prg.PrgInfo());
                `);
                output.should.equal('false 0\r\nfalse 0\r\nfalse 0\r\nfalse 0\r\nfalse 0\r\nfalse 0 600\r\n65535 DayProfileInfo\r\n');
                await warning;
            });

            it('should not crash on a huge index', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
${getProgram}
WriteLine(prg.DayProfileEntry(21738156, 4711) # " " # prg.DayProfileEntry(21738156));
integer i = 0;
integer sum = 0;
while (i < 100) {
  sum = sum + prg.DayProfileEntry(i);
  i = i + 1;
}
WriteLine(sum);
                `);
                output.should.equal('false 0\r\n29795\r\n');
            });

            describe('should persist the valid entries', function () {
                it('saving regadom', async function () {
                    this.timeout(30_000);
                    await rega.exec('system.Save();');
                });

                // cleanup test environment (stop ReGaHss)
                cleanupTest();

                // init test environment (start ReGa)
                initTest(false, null, null, true);

                describe('running test', function () {
                    it('should have restored the entries', async function () {
                        this.timeout(30_000);
                        const {output} = await rega.exec(`
${getProgram}
WriteLine(prg.DayProfileEntry(0) # " " # prg.DayProfileEntry(1) # " " # prg.DayProfileEntry(5) # " " # prg.DayProfileEntry(23));
WriteLine(prg.DayTypeProgId() # " " # prg.PrgInfo());
                        `);
                        output.should.equal('100 -5 600 2400\r\n65535 DayProfileInfo\r\n');
                    });
                });
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/3156
        it('ChnNumber() should not log an error for channels without address', async function () {
            // fixed in ReGaHss R1.00.0388.0257
            requireRegaVersion(this, 'R1.00.0388.0257');
            this.timeout(30_000);
            const logged = [];
            const untap = regaInstance().log.tap(line => {
                if (/invalid (Address|channel address)/.test(line)) {
                    logged.push(line);
                }
            });
            try {
                // (ReGaHss logs the response of a script after executing it)
                const processed = waitForRega(/sends parsed file/, {buffered: false});
                processed.catch(() => undefined);
                // channels without address (e.g. the internal channels of the
                // gateway device) have no channel number
                const {output} = await rega.exec(`
string sId;
integer nEmpty = 0;
boolean bAllMinusOne = true;
integer nRF1 = 0;
foreach (sId, dom.GetObject(ID_CHANNELS).EnumUsedIDs()) {
  object oChn = dom.GetObject(sId);
  if (oChn.Address() == "") {
    nEmpty = nEmpty + 1;
    if (oChn.ChnNumber() != -1) { bAllMinusOne = false; }
  }
  if (oChn.Address() == "BidCoS-RF:1") { nRF1 = oChn.ChnNumber(); }
}
WriteLine(dom.GetObject(ID_GW_CHANNEL).ChnNumber() # " " # (nEmpty > 0) # " " # bAllMinusOne # " " # nRF1);
                `);
                output.should.equal('-1 true true 1\r\n');
                await processed;
                logged.should.deepEqual([]);
            } finally {
                untap();
            }
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2640
        describe('etUserPages enumerations tests', function () {
            // fixed in ReGaHss R1.00.0388.0262
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0262');
            });

            // (a license check for the unreleased user pages feature hid
            // all enumerations of the type etUserPages)
            it('should return ID_USERPAGES', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
object o = dom.GetObject(ID_USERPAGES);
WriteLine(o.ID() # " " # o.EnumType() # " " # o.IsTypeOf(OT_ENUM));
                `);
                output.should.equal('8 23 true\r\n');
            });

            // (they could neither be fetched nor deleted and remained as
            // inaccessible objects in the DOM)
            it('should get and delete an enumeration of the type etUserPages', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
object o = dom.CreateObject(OT_ENUM, "UserPagesTest");
integer id = o.ID();
WriteLine(o.EnumType(etUserPages));
object g = dom.GetObject(id);
WriteLine(g.Name() # " " # g.EnumType());
WriteLine(dom.DeleteObject(id));
WriteLine(dom.GetObject(id));
                `);
                output.should.equal('true\r\nUserPagesTest 23\r\ntrue\r\nnull\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2670 and
        // https://github.com/OpenCCU/OpenCCU/issues/2669
        describe('UTC time output and Format() tests', function () {
            // fixed in ReGaHss R1.00.0388.0261
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0261');
            });

            // (UTC time values like currenttime were output as local time,
            // while e.g. Hour() returned the UTC hour)
            it('should output UTC time values as UTC', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
time t = currenttime;
WriteLine(t.IsLocalTime());
WriteLine(t.Format("%Z %z"));
WriteLine(t.Format("%H").ToInteger() == t.Hour());
WriteLine(t.ToString().Substr(11, 2).ToInteger() == t.Hour());
integer d = localtime.ToInteger() - t.ToInteger();
WriteLine((d >= 0) && (d <= 2));
                `);
                output.should.equal('0\r\nGMT +0000\r\ntrue\r\ntrue\r\ntrue\r\n');
            });

            it('should still output local time values as local time', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
time t = localtime;
WriteLine(t.IsLocalTime());
WriteLine(t.Format("%H").ToInteger() == t.Hour());
WriteLine(t.ToString().Substr(11, 2).ToInteger() == t.Hour());
t = @2024-01-02 03:04:05@;
WriteLine(t # " " # t.IsLocalTime());
integer i = 1704164645;
WriteLine(i.ToTime().Format("%F %T") == i.ToTime().ToString());
                `);
                output.should.equal('1\r\ntrue\r\ntrue\r\n2024-01-02 03:04:05 1\r\ntrue\r\n');
            });

            // (Format() without a format aborted the script)
            it('should return the time like ToString() for Format() without a format', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
time t = @2024-01-02 03:04:05@;
WriteLine(t.Format());
WriteLine(t.Format() == t.ToString());
t = currenttime;
WriteLine(t.Format() == t.ToString());
WriteLine("end");
                `);
                output.should.equal('2024-01-02 03:04:05\r\ntrue\r\ntrue\r\nend\r\n');
            });

            // (the time 0 of an invalid conversion is still output as local
            // time)
            it('should keep the output of an invalid string to time conversion', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
time t = "abc".ToTime();
integer i = 0;
WriteLine(t.IsLocalTime() # " " # t.ToInteger());
WriteLine(t.ToString() == i.ToTime().ToString());
                `);
                output.should.equal('1 0\r\ntrue\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2614 (also #2613,
        // #2615, #2616, #2617, #2619, #2620 and #2622)
        describe('foreach() loop variable tests', function () {
            // fixed in ReGaHss R1.00.0388.0260
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0260');
            });

            // runs foreach(x, 10) with the given statement in the loop body,
            // outputs the iterations and the loop variable after the loop
            async function runForEach(declaration, statement) {
                const {output} = await rega.exec(`
${declaration}
string out = "";
integer count = 0;
string x;
foreach (x, 10) {
  count = count + 1;
  out = out # x # " ";
  ${statement}
}
WriteLine(out # "| " # count # " " # x.Type() # " " # x);
dom.GetObject("Admin").UserTempViewIDs3().RemoveAll();
                `);
                return output;
            }

            // (a value of another type assigned to the loop variable of a
            // foreach() over an integer count aborted or restarted the loop
            // and left a raw internal value in the loop variable: a pointer
            // for objects and idarrays, the bit pattern for times and reals;
            // the loop now continues with the next count)
            const values = [
                ['an object', 'object val = dom.GetObject(1);'],
                ['a null object', 'object val;'],
                ['an idarray', 'idarray val = dom.GetObject("Admin").UserTempViewIDs3(); val.Add(1);'],
                ['an empty idarray', 'idarray val = dom.GetObject("Admin").UserTempViewIDs3(); val.RemoveAll();'],
                ['a null idarray', 'idarray val;'],
                ['a time', 'time val = @2036-01-02 03:04:05@;'],
                ['a real', 'real val = 3.0;'],
                ['a string', 'string val = "7";']
            ];

            for (const [description, declaration] of values) {
                it('should continue the loop after assigning ' + description + ' to the loop variable', async function () {
                    this.timeout(30_000);
                    const output = await runForEach(declaration, 'if (count == 5) { x = val; }');
                    output.should.equal('1 2 3 4 5 6 7 8 9 10 | 10 integer 11\r\n');
                });
            }

            // (like in C, an integer assigned to the loop variable sets the
            // counter, and the loop variable is one above the count after the
            // loop ended)
            it('should continue with an integer assigned to the loop variable', async function () {
                this.timeout(30_000);
                const jump = await runForEach('', 'if (count == 3) { x = 7; }');
                jump.should.equal('1 2 3 8 9 10 | 6 integer 11\r\n');
                const restart = await runForEach('', 'if (count == 3) { x = 0; }');
                restart.should.equal('1 2 3 1 2 3 4 5 6 7 8 9 10 | 13 integer 11\r\n');
                const end = await runForEach('', 'if (count == 3) { x = 100; }');
                end.should.equal('1 2 3 | 3 integer 101\r\n');
            });

            // (the loop variable was incremented once more after break)
            it('should keep the value of the loop variable after break', async function () {
                this.timeout(30_000);
                const output = await runForEach('', 'if (count == 5) { break; }');
                output.should.equal('1 2 3 4 5 | 5 integer 5\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2612
        describe('foreach() loop variable of any type', function () {
            // fixed in ReGaHss R1.00.0388.0264
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0264');
            });

            // (the loop was skipped silently if the loop variable was not
            // declared as string, or as string or integer for a loop over an
            // integer count; the loop variable is set to the elements
            // (string) or the count (integer) anyway)
            for (const type of ['boolean', 'idarray', 'integer', 'object', 'real', 'string', 'time', 'var', 'xml']) {
                it('should loop with a loop variable declared as ' + type, async function () {
                    this.timeout(30_000);
                    const {output} = await rega.exec(`
idarray ia = dom.GetObject("Admin").UserTempViewIDs3(); ia.RemoveAll(); ia.Add(11); ia.Add(22);
${type} x; ${type} y; ${type} z;
string out = "";
foreach (x, "A\\tB") { out = out # x.Type() # ":" # x # " "; }
out = out # "| ";
foreach (y, ia) { out = out # y.Type() # ":" # y # " "; }
out = out # "| ";
foreach (z, 2) { out = out # z.Type() # ":" # z # " "; }
WriteLine(out # "| " # x.Type() # " " # y.Type() # " " # z.Type());
ia.RemoveAll();
                    `);
                    output.should.equal('string:A string:B | string:11 string:22 | integer:1 integer:2 | string string integer\r\n');
                });
            }
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/1420: a script doubling a
        // string in a loop used up all memory and crashed ReGaHss
        it('should end a script creating a string longer than 32 MiB with a runtime error', async function () {
            // fixed in ReGaHss R1.00.0388.0265
            requireRegaVersion(this, 'R1.00.0388.0265');
            this.timeout(60_000);
            const logged = regaInstance().waitFor(/string concatenation exceeds the maximum string length of 33554432 characters \(67108864\)/, {buffered: false, timeout: 30_000});
            const {output} = await rega.exec(`
string a = "A";
integer b = 0;
if (true) {
  while (b < 30) {
    b = b + 1;
    a = a # a;
  }
}
WriteLine("b=" # b # " length=" # a.Length());
            `);
            // (the 26th doubling would result in 64 MiB)
            output.should.equal('b=26 length=33554432\r\n');
            await logged;
            regaInstance().running.should.be.true();
        });

        // (Replace() could create strings of any length as well, and an empty
        // search string never ended)
        it('should end a script creating a string longer than 32 MiB with Replace() with a runtime error', async function () {
            // fixed in ReGaHss R1.00.0388.0265
            requireRegaVersion(this, 'R1.00.0388.0265');
            this.timeout(60_000);
            const logged = regaInstance().waitFor(/Replace\(\) exceeds the maximum string length of 33554432 characters/, {buffered: false, timeout: 30_000});
            const {output} = await rega.exec(`
string a = "A";
integer b = 0;
while (b < 20) {
  b = b + 1;
  a = a # a;
}
string x32 = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
string r = "";
if (true) {
  r = x32.Replace("x", a);
  Write(r.Length());
  r = (x32 # "x").Replace("x", a);
  Write(" not reached");
}
WriteLine(" " # r.Length() # " " # "abc".Replace("b", "XY") # " " # "abc".Replace("", "x"));
            `);
            // (32 times 1 MiB fit, 33 times would exceed 32 MiB; like for
            // other runtime errors in an assignment, the variable is set to
            // the string Replace() was called for)
            output.should.equal('33554432 33 aXYc abc\r\n');
            await logged;
            regaInstance().running.should.be.true();
        });

        // (the output of a script was not limited either)
        it('should end a script writing more than 32 MiB of output with a runtime error', async function () {
            // fixed in ReGaHss R1.00.0388.0265
            requireRegaVersion(this, 'R1.00.0388.0265');
            this.timeout(60_000);
            const logged = regaInstance().waitFor(/output exceeds the maximum output length of 33554432 characters/, {buffered: false, timeout: 30_000});
            const {output} = await rega.exec(`
string a = "A";
integer b = 0;
while (b < 20) {
  b = b + 1;
  a = a # a;
}
integer n = 0;
if (true) {
  while (n < 100) {
    n = n + 1;
    Write(a);
  }
}
Write("n=" # n);
            `);
            // (32 times 1 MiB fit, the 33rd write and the following ones would
            // exceed 32 MiB)
            output.length.should.equal(32 * 1024 * 1024);
            await logged;
            // (the limit applies per request)
            const next = await rega.exec('WriteLine("next");');
            next.output.should.equal('next\r\n');
            regaInstance().running.should.be.true();
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/1598: the message and
        // the link of the error page were output as two paragraphs, which the
        // WebUI (embedding the body of the error page) displayed on one line
        it('should output the message and the link of the error page for an invalid session in one paragraph', async function () {
            // fixed in ReGaHss R1.00.0388.0265
            requireRegaVersion(this, 'R1.00.0388.0265');
            this.timeout(30_000);
            const response = await rega.request({path: '/pages/index.htm?sid=@abcdefghij@'});
            response.statusCode.should.equal(500);
            response.text.should.containEql('<p>Sitzung ung\u00FCltig oder abgelaufen!\r\n<br><a href="/index.htm">Weiter</a></p>');
            response.text.should.not.containEql('</p><p>');
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2216
        describe('URL encoded characters in the URL parameters of remote script calls', function () {
            // fixed in ReGaHss R1.00.0388.0265
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0265');
            });

            // executes the given URL parameters via /x.exe and returns the
            // resulting variables (<xml>...</xml> without the fixed elements)
            const get = async query => {
                const response = await rega.request({path: '/x.exe?' + query});
                response.statusCode.should.equal(200);
                return response.text.replace(/<exec>[^<]*<\/exec><sessionId>[^<]*<\/sessionId><httpUserAgent>[^<]*<\/httpUserAgent>/, '');
            };

            // (the URL was decoded before it was split into its parameters,
            // so that an encoded '&' split the parameter)
            it('should decode an encoded & (%26) within a parameter', async function () {
                this.timeout(30_000);
                const output = await get('a=\'A%26B\'&b=\'C%26D\'');
                output.should.equal('<xml><a>A&amp;B</a><b>C&amp;D</b></xml>');
            });

            it('should set a system variable to a value with an encoded & (%26)', async function () {
                this.timeout(30_000);
                await rega.exec('object sv = dom.CreateObject(OT_VARDP, "url-test-2216"); sv.ValueType(ivtString); sv.ValueSubType(istChar8859); dom.GetObject(ID_SYSTEM_VARIABLES).Add(sv.ID());');
                try {
                    const output = await get('v=dom.GetObject(\'url-test-2216\').State(\'CURRENT=50%26VOLTAGE=240.5\')&w=dom.GetObject(\'url-test-2216\').Value()');
                    output.should.equal('<xml><v>true</v><w>CURRENT=50&amp;VOLTAGE=240.5</w></xml>');
                } finally {
                    await rega.exec('object sv = dom.GetObject("url-test-2216"); if (sv) { dom.GetObject(ID_SYSTEM_VARIABLES).Remove(sv.ID()); dom.DeleteObject(sv.ID()); }');
                }
            });

            // (an encoded '+' was decoded to a space as well)
            it('should decode an encoded + (%2B) to + and + to a space', async function () {
                this.timeout(30_000);
                const output = await get('a=\'1%2B2\'&b=\'1+2\'&c=1%2B2');
                output.should.equal('<xml><a>1+2</a><b>1 2</b><c>3</c></xml>');
            });

            // (the URL was decoded a second time, e.g. %2526 to '&')
            it('should decode the parameters only once', async function () {
                this.timeout(30_000);
                const output = await get('a=\'50%25\'&b=\'%2541\'&c=\'A%2526B\'&d=\'%41%42\'');
                output.should.equal('<xml><a>50%</a><b>%41</b><c>A%26B</c><d>AB</d></xml>');
            });

            // (a '%' not followed by two hex digits removed parts of the parameter)
            it('should keep a % not followed by two hex digits and an encoded nul-byte', async function () {
                this.timeout(30_000);
                const output = await get('a=\'50%25x\'&b=\'%4\'&c=\'x%00y\'');
                output.should.equal('<xml><a>50%x</a><b>%4</b><c>x%00y</c></xml>');
            });

            it('should still separate the parameters by a & that is not encoded', async function () {
                this.timeout(30_000);
                const output = await get('a=\'x\'&b=\'y\'');
                output.should.equal('<xml><a>x</a><b>y</b></xml>');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2623: a script runtime
        // error ends everything up to the next enclosing if block (or the
        // whole script), loops do not catch it. This behaviour is kept
        // deliberately (a loop should not continue after an obvious error),
        // these tests document it. A loop body enclosed in 'if (true) { ... }'
        // only ends the current iteration.
        describe('script runtime errors in loops', function () {
            // (dom.GetObject("65535") returns null, so .Name() raises a
            // script runtime error in the second iteration; the result is
            // assigned to a variable, as a Write() would output partial text)
            const foreachLoop = body => `string e; string n; foreach (e, "1\\t65535\\t2") { ${body} }`;
            const foreachBody = 'Write(e); n = dom.GetObject(e).Name(); Write(";");';
            const whileLoop = body => `string ids = "1\\t65535\\t2"; string n; integer i = 0; while (i < 3) { i = i + 1; ${body} }`;
            const whileBody = 'Write(i); n = dom.GetObject(ids.StrValueByIndex("\\t", i - 1)).Name(); Write(";");';

            const run = async script => {
                const {output} = await rega.exec(script);
                return output;
            };

            it('should end the script for an error in a block', async function () {
                this.timeout(30_000);
                const output1 = await run('object o; string n; Write("a"); n = o.Name(); WriteLine(" after");');
                output1.should.equal('a');
            });

            it('should continue after an if block with an error', async function () {
                this.timeout(30_000);
                const output2 = await run('object o; string n; if (true) { Write("a"); n = o.Name(); Write("b"); } WriteLine(" after");');
                output2.should.equal('a after\r\n');
                const output3 = await run('object o; if (o.Name()) { Write("x"); } WriteLine(" after");');
                output3.should.equal(' after\r\n');
            });

            for (const [name, loop, body, done, last] of [
                ['foreach()', foreachLoop, foreachBody, '1;65535', '2;'],
                ['while()', whileLoop, whileBody, '1;2', '3;']
            ]) {
                it(`should end ${name} and the script for an error in the loop`, async function () {
                    this.timeout(30_000);
                    const output = await run(loop(body) + ' WriteLine(" after");');
                    output.should.equal(done);
                });

                it(`should end ${name} up to the enclosing if block for an error in the loop`, async function () {
                    this.timeout(30_000);
                    const output = await run('if (true) { ' + loop(body) + ' Write(" if-end"); } WriteLine(" after");');
                    output.should.equal(done + ' after\r\n');
                });

                it(`should only end the iteration of ${name} for an error in a loop body enclosed in if (true)`, async function () {
                    this.timeout(30_000);
                    const output = await run(loop('if (true) { ' + body + ' }') + ' WriteLine(" after");');
                    output.should.equal(done + last + ' after\r\n');
                });
            }

            it('should end nested loops up to the enclosing if block for an error in the inner loop', async function () {
                this.timeout(30_000);
                const output = await run('integer m; if (true) { foreach (m, 2) { Write("<" # m # ":"); ' + foreachLoop(foreachBody) + ' Write(">"); } } WriteLine(" after");');
                output.should.equal('<1:1;65535 after\r\n');
            });

            it('should end while() and foreach() for an error in the condition or list', async function () {
                this.timeout(30_000);
                const output4 = await run('object o; if (true) { while (o.Name()) { Write("x"); } Write(" if-end"); } WriteLine(" after");');
                output4.should.equal(' after\r\n');
                const output5 = await run('object o; string e; if (true) { foreach (e, o.Name()) { Write("x"); } Write(" if-end"); } WriteLine(" after");');
                output5.should.equal(' after\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2611: the behaviour
        // of foreach() over a tab separated list is kept deliberately (many
        // scripts build lists with a trailing tab), these tests document it
        describe('foreach() over tab separated lists', function () {
            // (a tab terminates a list element, the tab of the last element
            // may be omitted: a trailing tab does not add an empty element,
            // an empty last element thus needs a trailing tab)
            it('should treat the tab as terminator of the list elements', async function () {
                this.timeout(30_000);
                const lists = ['', 'a', 'a\\t', 'a\\t\\t', '\\t', '\\t\\t', 'a\\tb', 'a\\t\\tb', 'a\\tb\\t', '\\tA\\tB\\tC\\tD\\t\\t'];
                const {output} = await rega.exec(lists.map(list => `
string e; integer n = 0; string out = "";
foreach (e, "${list}") { n = n + 1; out = out # "[" # e # "] "; }
WriteLine(n # ": " # out);
                `).join(''));
                output.should.equal([
                    '0: ',
                    '1: [a] ',
                    '1: [a] ',
                    '2: [a] [] ',
                    '1: [] ',
                    '2: [] [] ',
                    '2: [a] [b] ',
                    '3: [a] [] [b] ',
                    '2: [a] [b] ',
                    '6: [] [A] [B] [C] [D] [] '
                ].map(line => line + '\r\n').join(''));
            });

            // (.Split() only replaces the separator by tabs, so an empty last
            // element of the split string is not iterated; appending the
            // separator once makes foreach() iterate all elements)
            it('should iterate all elements of a split string with a trailing separator appended', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
string e; integer n; string out;
string l = ";A;B;C;D;;";
n = 0; out = ""; foreach (e, l.Split(";")) { n = n + 1; out = out # "[" # e # "] "; }
WriteLine(n # ": " # out);
n = 0; out = ""; foreach (e, (l # ";").Split(";")) { n = n + 1; out = out # "[" # e # "] "; }
WriteLine(n # ": " # out # "/ " # web.webGetValueListCount(l));
l = "A;B";
n = 0; out = ""; foreach (e, (l # ";").Split(";")) { n = n + 1; out = out # "[" # e # "] "; }
WriteLine(n # ": " # out);
                `);
                output.should.equal([
                    '6: [] [A] [B] [C] [D] [] ',
                    '7: [] [A] [B] [C] [D] [] [] / 7',
                    '2: [A] [B] '
                ].map(line => line + '\r\n').join(''));
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2692
        describe('system.SyslogIPAddress() tests', function () {
            // fixed in ReGaHss R1.00.0388.0259
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0259');
            });

            // (these values enabled logging via SYSLOG to the broadcast
            // address, which crashed ReGaHss with a SIGSEGV; invalid values
            // and the broadcast address now disable logging via SYSLOG)
            for (const value of ['-1', '"255.255.255.255"', '""', '"abc"']) {
                it('should not crash on SyslogIPAddress(' + value + ') and disable logging via SYSLOG', async function () {
                    this.timeout(30_000);
                    const {output} = await rega.exec(`
system.SyslogIPAddress("127.0.0.1");
system.SyslogIPAddress(${value});
WriteLine(system.SyslogIPAddress());
                    `);
                    output.should.equal('0.0.0.0\r\n');
                    const alive = await rega.exec('WriteLine("alive");');
                    alive.output.should.equal('alive\r\n');
                });
            }

            it('should still set a valid address', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
system.SyslogIPAddress("127.0.0.1");
WriteLine(system.SyslogIPAddress());
                `);
                output.should.equal('127.0.0.1\r\n');
            });

            it('should disable logging via SYSLOG with 0.0.0.0', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
system.SyslogIPAddress("0.0.0.0");
WriteLine(system.SyslogIPAddress());
                `);
                output.should.equal('0.0.0.0\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/2950
        describe('IsTypeOf() of enumerations tests', function () {
            // fixed in ReGaHss R1.00.0388.0259
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0259');
            });

            // (root enumerations, the type of their elements and their own type)
            const enumerations = [
                ['ID_DEVICES', 'OT_DEVICE', 'OT_DEVICES'],
                ['ID_CHANNELS', 'OT_CHANNEL', 'OT_CHANNELS'],
                ['ID_DATAPOINTS', 'OT_DP', 'OT_DPS'],
                ['ID_USERS', 'OT_USER', 'OT_USERS'],
                ['ID_RULES', 'OT_RULE', 'OT_RULES'],
                ['ID_INTERFACES', 'OT_INTERFACE', 'OT_INTERFACES']
            ];

            it('should not report enumerations to be of the type of their elements', async function () {
                this.timeout(30_000);
                const script = enumerations.map(([id, type, enumType]) => `
o = dom.GetObject(${id});
WriteLine("${id} " # o.IsTypeOf(${type}) # " " # o.IsTypeOf(${enumType}) # " " # o.IsTypeOf(OT_ENUM) # " " # o.IsTypeOf(OT_OBJECT));`).join('');
                const {output} = await rega.exec('object o;' + script);
                output.should.equal(enumerations.map(([id]) => id + ' false true true true\r\n').join(''));
            });

            it('should still report the elements to be of their type', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
object o = dom.GetObject(ID_GW_CHANNEL);
WriteLine("channel " # o.IsTypeOf(OT_CHANNEL) # " " # o.IsTypeOf(OT_CHANNELS) # " " # o.IsTypeOf(OT_ENUM) # " " # o.IsTypeOf(OT_OBJECT));
o = dom.GetObject(o.Device());
WriteLine("device " # o.IsTypeOf(OT_DEVICE) # " " # o.IsTypeOf(OT_DEVICES) # " " # o.IsTypeOf(OT_ENUM) # " " # o.IsTypeOf(OT_OBJECT));
o = dom.GetObject(ID_PRESENT);
WriteLine("dp " # o.IsTypeOf(OT_DP) # " " # o.IsTypeOf(OT_DPS) # " " # o.IsTypeOf(OT_ENUM) # " " # o.IsTypeOf(OT_VARDP));
o = dom.GetObject(dom.GetObject(ID_USERS).EnumUsedIDs().StrValueByIndex("\\t", 0));
WriteLine("user " # o.IsTypeOf(OT_USER) # " " # o.IsTypeOf(OT_USERS) # " " # o.IsTypeOf(OT_ENUM) # " " # o.IsTypeOf(OT_OBJECT));
o = dom.GetObject(dom.GetObject(ID_INTERFACES).EnumUsedIDs().StrValueByIndex("\\t", 0));
WriteLine("interface " # o.IsTypeOf(OT_INTERFACE) # " " # o.IsTypeOf(OT_INTERFACES) # " " # o.IsTypeOf(OT_ENUM) # " " # o.IsTypeOf(OT_OBJECT));
                `);
                output.should.equal('channel true false false true\r\ndevice true false false true\r\ndp true false false true\r\nuser true false false true\r\ninterface true false false true\r\n');
            });

            it('should not crash on a delayed State() of an enumeration', async function () {
                this.timeout(30_000);
                // (the scheduler executed it as State() of a data point or
                // channel, which crashed ReGaHss for ID_DATAPOINTS; wait for
                // both scheduler jobs before checking that ReGaHss still runs)
                const rejected = [5, 4].map(id => waitForRega(new RegExp(`execution of scheduler only allowed on DP, CHANNEL or PROGRAM - id= ${id}\\b`), {buffered: false}));
                for (const promise of rejected) {
                    promise.catch(() => undefined);
                }

                const {output} = await rega.exec(`
WriteLine(dom.GetObject(ID_DATAPOINTS).State(1, 300));
WriteLine(dom.GetObject(ID_CHANNELS).State(1, 300));
                `);
                output.should.equal('true\r\ntrue\r\n');
                await Promise.all(rejected);
                const alive = await rega.exec('WriteLine(dom.GetObject(ID_DATAPOINTS).Count() > 0);');
                alive.output.should.equal('true\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/467
        describe('LastValue() of the number of alarms and service messages', function () {
            // fixed in ReGaHss R1.00.0388.0266
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0266');
            });

            // creates two alarms of the given type, raises and receipts the
            // first one and updates the second one (without raising it) and
            // outputs the change of Value() and LastValue() of the counter
            const counterScript = (counter, list, alType, name) => `
object list = dom.GetObject(${list});
object a = dom.CreateObject(OT_ALARMDP, "${name} A");
list.Add(a.ID());
a.ValueType(ivtBinary);
a.ValueSubType(istAlarm);
a.AlType(${alType});
a.AlSetBinaryCondition();
a.AlArm(true);
object b = dom.CreateObject(OT_ALARMDP, "${name} B");
list.Add(b.ID());
b.ValueType(ivtBinary);
b.ValueSubType(istAlarm);
b.AlType(${alType});
b.AlSetBinaryCondition();
b.AlArm(true);
object c = dom.GetObject(${counter});
integer n = c.Value();
a.State(true);
WriteLine((c.Value() - n) # " " # (c.LastValue() - n));
b.State(false);
b.State(false);
WriteLine((c.Value() - n) # " " # (c.LastValue() - n));
a.State(false);
WriteLine((c.Value() - n) # " " # (c.LastValue() - n));
list.Remove(a.ID());
dom.DeleteObject(a.ID());
list.Remove(b.ID());
dom.DeleteObject(b.ID());
`;

            // (the number was set on every update of an alarm or service
            // message, even if it did not change, so that LastValue() was
            // overwritten with the current value)
            it('should keep LastValue() of ID_GW_SYSALARM on updates of an alarm', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(counterScript('ID_GW_SYSALARM', 'ID_SYSTEM_VARIABLES', 'atSystem', 'lastvalue-467-alarm'));
                output.should.equal('1 0\r\n1 0\r\n0 1\r\n');
            });

            it('should keep LastValue() of ID_GW_SYSSERVICE on updates of a service message', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(counterScript('ID_GW_SYSSERVICE', 'ID_SERVICES', 'atService', 'lastvalue-467-service'));
                output.should.equal('1 0\r\n1 0\r\n0 1\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/983
        describe('method calls on the result of a method call with a method call without parameters as last parameter', function () {
            // fixed in ReGaHss R1.00.0388.0266
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0266');
            });

            // (the end of the parameters of the outer method call was taken as
            // the end of the parameters of the inner method call, so that the
            // following method was called on the parameter instead of the
            // result of the outer method call, e.g. Name() on the channel ID
            // of 'dom.GetObject(o.Channel()).Name()', which failed with a
            // script runtime error or returned a wrong result)
            it('should call Name() on the result of dom.GetObject(o.Channel())', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
string id;
object src = null;
foreach (id, dom.GetObject(ID_DATAPOINTS).EnumUsedIDs()) {
  object o = dom.GetObject(id);
  if (o && (o.TypeName() == "HSSDP") && !src) {
    src = o;
  }
}
string works = (dom.GetObject(dom.GetObject(src).Channel())).Name();
string breaks = dom.GetObject(dom.GetObject(src).Channel()).Name();
WriteLine((works != "") # " " # (breaks == works));
WriteLine(dom.GetObject(src.Channel()).Name() == works);
WriteLine("done");
                `);
                output.should.equal('true true\r\ntrue\r\ndone\r\n');
            });

            it('should call a method on the result of a method call with ID() or Length() as last parameter', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
WriteLine(dom.GetObject(dom.GetObject(ID_SYSTEM_VARIABLES).ID()).Name());
string s = "  abc  ";
WriteLine("[" # s.Substr(0, s.Length()).Trim() # "]");
                `);
                output.should.equal('Root System Variables\r\n[abc]\r\n');
            });
        });

        // see https://github.com/OpenCCU/OpenCCU/issues/889
        describe('Next() of a time module which was never active', function () {
            // fixed in ReGaHss R1.00.0388.0266
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0266');
            });

            // (the timer thread initializes time modules only while they are
            // enabled, so Next() of a time module which was not enabled since
            // the start of ReGaHss, e.g. of an inactive program, logged
            // "interface pointer are not initialized" and returned an empty
            // string, which made e.g. Next().Format() fail with a script
            // runtime error; changes of a disabled time module were not
            // taken into account by Next() either)
            it('should return the next time of a disabled time module', async function () {
                this.timeout(30_000);
                const {output} = await rega.exec(`
object tm = dom.CreateObject(OT_CALENDARDP, "Next 889");
tm.Enabled(false);
tm.TimerType(ttCalDaily);
tm.Time("12:00:00");
dom.GetObject(ID_CALENDARDPS).Add(tm);
WriteLine(tm.Enabled() # " " # tm.Next().Format("%H:%M:%S"));
tm.Time("13:00:00");
WriteLine(tm.Next().Format("%H:%M:%S"));
dom.GetObject(ID_CALENDARDPS).Remove(tm.ID());
dom.DeleteObject(tm.ID());
WriteLine("done");
                `);
                output.should.equal('false 12:00:00\r\n13:00:00\r\ndone\r\n');
            });
        });

        describe('scripts with a syntax error', function () {
            // fixed in ReGaHss R1.00.0388.0266
            before(function () {
                requireRegaVersion(this, 'R1.00.0388.0266');
            });

            // (the scripts of programs, alarms and mappings were executed up
            // to the syntax error, e.g. the first statement and the second one
            // with a truncated parameter, unlike scripts of web requests)
            const script = name => `object l = dom.GetObject("${name}");
l.State(l.Value() # "1");
l.State(l.Value() # "2" # undeclaredSyntaxError);
l.State(l.Value() # "3");`;

            it('should not execute the script of a program', async function () {
                this.timeout(30_000);
                await createSysvars({'SE Trigger': 'bool', 'SE Program Log': 'string'});
                await createProgram({
                    name: 'SE Program',
                    rules: [{conditions: [[{sysvar: 'SE Trigger', value: true, trigger: 'change'}]], destinations: [{script: script('SE Program Log')}]}]
                });
                const logged = regaInstance().waitFor(/script of program 'SE Program' \(ID \d+\) not executed due to a syntax error/, {buffered: false, timeout: 20_000});
                await set('SE Trigger', true);
                await logged;
                const log = await value('SE Program Log');
                log.should.equal('');
            });

            it('should not execute the script of an alarm', async function () {
                this.timeout(30_000);
                await createSysvars({'SE Alarm Log': 'string'});
                const logged = regaInstance().waitFor(/script of alarm 'SE Alarm' \(ID \d+\) not executed due to a syntax error/, {buffered: false, timeout: 20_000});
                const {output} = await rega.exec(`
object a = dom.CreateObject(OT_ALARMDP, "SE Alarm");
dom.GetObject(ID_SYSTEM_VARIABLES).Add(a.ID());
a.ValueType(ivtBinary);
a.ValueSubType(istAlarm);
a.AlType(atSystem);
a.AlSetBinaryCondition();
a.AlExpression('${script('SE Alarm Log').replaceAll('\n', ' ')}');
a.AlArm(true);
a.State(true);
WriteLine(dom.GetObject("SE Alarm Log").Value());
dom.GetObject(ID_SYSTEM_VARIABLES).Remove(a.ID());
dom.DeleteObject(a.ID());
                `);
                await logged;
                output.should.equal('\r\n');
            });
        });
    });

    // cleanup test environment
    cleanupTest();
});
