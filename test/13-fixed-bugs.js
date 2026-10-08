/* global describe, it, before, after */
/* eslint-disable no-unused-vars, max-nested-callbacks, prefer-arrow-callback, capitalized-comments */

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    waitForRega,
    regaInstance
} = require('../lib/helper.js');

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
                server.close();
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
    });

    // cleanup test environment
    cleanupTest();
});
