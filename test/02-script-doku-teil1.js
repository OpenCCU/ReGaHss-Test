/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, no-useless-escape, camelcase, max-nested-callbacks, prefer-arrow-callback, capitalized-comments */

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
        describe('running examples from HM-Skript_Teil_1_Sprachbeschreibung...', function () {
            it('2.2 should handle comments', function (done) {
                this.timeout(30000);
                rega.exec(`
! Dies ist ein Kommentar.
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

            it('3.2 should declare and initialize variables', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i; ! Deklaration ohne Initialisierung
integer j = 1; ! Deklaration mit Initialisierung
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.j.should.equal('1');
                        done();
                    }
                });
            });

            it('3.3 should dynamically change type', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = "Hallo Welt!"; ! i ist eine Zeichenkette
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('Hallo Welt!');
                        done();
                    }
                });
            });

            it('4.0 should handle operators correctly', function (done) {
                this.timeout(30000);
                rega.exec(`
var i = 1; ! i=1
var j = i + 1;  ! j=2
var k = i - 1;  ! k=0
var l = i * 10; ! l=10
real m = i / 10; ! m=0
boolean b = (i == 1); ! b=true
boolean c = (i <> 1); ! c=false
boolean d = (i != 1); ! d=false
boolean e = (i < 1);  ! e=false
boolean f = (i <= 1); ! f=true
boolean g = (i > 1);  ! g=false
boolean h = (i >= 1); ! h=true
boolean n = (b && true); ! n=true
boolean o = (b || true); ! o=true
boolean p = !b; ! p=false
integer q = i & 1; ! q=1
integer r = i | 1; ! r=1
string s = "Hallo" # "Welt"; ! s="HalloWelt"
boolean t = system.IsVar("i"); ! t=true
integer u = i % 3; ! u=1
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('1');
                        objects.j.should.equal('2');
                        objects.k.should.equal('0');
                        objects.l.should.equal('10');
                        objects.m.should.equal('0');
                        objects.b.should.equal('true');
                        objects.c.should.equal('false');
                        objects.d.should.equal('false');
                        objects.e.should.equal('false');
                        objects.f.should.equal('true');
                        objects.g.should.equal('false');
                        objects.h.should.equal('true');
                        objects.n.should.equal('true');
                        objects.o.should.equal('true');
                        objects.p.should.equal('false');
                        objects.q.should.equal('1');
                        objects.r.should.equal('1');
                        objects.s.should.equal('HalloWelt');
                        objects.t.should.equal('true');
                        objects.u.should.equal('1');
                        done();
                    }
                });
            });

            it('4.1 should do right to left interpretation', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = 1 + 2 * 3; ! i = (3 * 2) + 1 = 7
integer j = 3 * 2 + 1; ! j = (1 + 2) * 3 = 9
integer k = (3 * 2) + 1; ! k = 1 + (3 * 2) = 7
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('7');
                        objects.j.should.equal('9');
                        objects.k.should.equal('7');
                        done();
                    }
                });
            });

            it('4.2.0 should cast to left operands type', function (done) {
                this.timeout(30000);
                rega.exec(`
var x = 1 / 10.0; ! x = 0; x ist eine Ganzzahl
var y = 1.0 / 10; ! y = 0.1; y ist eine Gleitkommazahl
var z = 1.0 + "1.0"; ! z == 2.0
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.x.should.equal('0');
                        objects.y.should.equal('0.100000');
                        objects.z.should.equal('2.000000');
                        done();
                    }
                });
            });

            it('4.2.1 should cast to left operands type', function (done) {
                this.timeout(30000);
                rega.exec(`
var a = 3 * 2.5; ! a = 6; a ist eine Ganzzahl
var b = 2.5 * 3; ! b = 7.5; b ist eine Gleitkommazahl
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.a.should.equal('6');
                        objects.b.should.equal('7.500000');
                        done();
                    }
                });
            });

            it('4.2.2 should cast to left operands type', function (done) {
                this.timeout(30000);
                rega.exec(`
var c = 0.0 + 3; ! c = 3.0; c ist eine Gleitkommazahl
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.c.should.equal('3.000000');
                        done();
                    }
                });
            });

            it('5.1 should do if else', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = 1;
string s;
if (i == 1) { s = "i == 1"; }
else { s = "i != 1"; }
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.s.should.equal('i == 1');
                        done();
                    }
                });
            });

            it('5.1.1 should be able to handle elseif()', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = 2;
string s;
if (i == 1) { s = "i == 1"; }
elseif (i == 2) { s = "i == 2"; }
else { s = "i != 1 && i != 2"; }
integer x = 3;
integer y = 1;
if (y==1) {
  if (x == 1) { y = 2; }
  elseif (x == 2) { y = 3; }
  elseif (x == 3) { y = 4; }
  elseif (x == 4) { y = 5; }
  elseif (x == 5) { y = 6; }
  elseif (x == 6) { y = 7; }
  elseif (x == 7) { y = 8; }
  else { y = 9; }
  x=10;
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.s.should.equal('i == 2');
                        objects.x.should.equal('10');
                        objects.y.should.equal('4');
                        done();
                    }
                });
            });

            it('5.1.1 should be able to handle elseif() in while()/foreach()', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = 0;
while (i < 10) {
    if     (i == 0) { WriteLine("i=0"); }
    elseif (i == 1) { WriteLine("i=1"); }
    elseif (i == 2) { WriteLine("i=2"); i=5; }
    elseif (i == 7) { WriteLine("i=7"); }
    else            { WriteLine("I=" # i); }
    i = i + 1;
    WriteLine("next:" # i);
}
WriteLine("END:" # i);

string liste = "a\\tb\\tc\\td\\te\\tf";
string res;
foreach(res, liste) {
  if     (res == "a") { WriteLine("res=a"); }
  elseif (res == "b") { WriteLine("res=b"); }
  elseif (res == "c") { WriteLine("res=c"); }
  elseif (res == "e") { WriteLine("res=e"); }
  else                { WriteLine("RES=" # res); }
  WriteLine("next:" # res);
}
WriteLine("END:" # res);
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('10');
                        objects.res.should.equal('f');
                        output.should.equal('i=0\r\nnext:1\r\ni=1\r\nnext:2\r\ni=2\r\nnext:6\r\nI=6\r\nnext:7\r\ni=7\r\nnext:8\r\nI=8\r\nnext:9\r\nI=9\r\nnext:10\r\nEND:10\r\nres=a\r\nnext:a\r\nres=b\r\nnext:b\r\nres=c\r\nnext:c\r\nRES=d\r\nnext:d\r\nres=e\r\nnext:e\r\nRES=f\r\nnext:f\r\nEND:f\r\n');
                        done();
                    }
                });
            });

            it('5.1.1 should be able to handle break/continue for while()/foreach()', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = 0;
while (i < 10) {
    if     (i == 0) { WriteLine("i=0"); }
    elseif (i == 1) { WriteLine("i=1"); }
    elseif (i == 2) { WriteLine("i=2"); i=5; continue; WriteLine("ERROR"); }
    elseif (i == 7) { WriteLine("i=7"); break; WriteLine("ERROR"); }
    else            { WriteLine("I=" # i); }
    i = i + 1;
    WriteLine("next:" # i);
}
WriteLine("END:" # i);

string liste = "a\\tb\\tc\\td\\te\\tf";
string res;
foreach(res, liste) {
  if     (res == "a") { WriteLine("res=a");}
  elseif (res == "b") { WriteLine("res=b");}
  elseif (res == "c") { WriteLine("res=c"); continue; WriteLine("ERROR");}
  elseif (res == "e") { WriteLine("res=e"); break; WriteLine("ERROR");}
  else                { WriteLine("RES=" # res); }
  WriteLine("next:" # res);
}
WriteLine("END:" # res);
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('7');
                        objects.res.should.equal('e');
                        output.should.equal('i=0\r\nnext:1\r\ni=1\r\nnext:2\r\ni=2\r\nI=5\r\nnext:6\r\nI=6\r\nnext:7\r\ni=7\r\nEND:7\r\nres=a\r\nnext:a\r\nres=b\r\nnext:b\r\nres=c\r\nRES=d\r\nnext:d\r\nres=e\r\nEND:e\r\n');
                        done();
                    }
                });
            });

            it('5.2 should terminate while(true) after 1M iterations (system.MaxIterations())', function (done) {
                this.timeout(30000);
                rega.exec(`
system.MaxIterations(1000000);
integer i = 0;
while (true) { i = i + 1; }
            `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('1000000');
                        done();
                    }
                });
            });

            it('5.3 should do foreach', function (done) {
                this.timeout(30000);
                rega.exec(`
string liste = "a\\tb\\tc"; ! Liste { "a", "b", "c" }
string ausgabe = ""; ! Ausgabe
string index; ! Indexvariable 
foreach (index, liste)
{
    ausgabe = index # ausgabe;
}
! ausgabe = "cba";
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.ausgabe.should.equal('cba');
                        done();
                    }
                });
            });

            it('5.4 should quit a script', function (done) {
                this.timeout(30000);
                rega.exec(`
integer even = 3;
if (even & 1) { quit; } ! "even" ist nicht gerade -> Abbruch
boolean didNotQuit = true;
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.even.should.equal('3');
                        objects.didNotQuit.should.not.equal('true');
                        done();
                    }
                });
            });

            it('6.1.1 should determine standard VarType()', function (done) {
                this.timeout(30000);
                rega.exec(`
boolean b;
integer bType = b.VarType(); ! 1;

integer i;
integer iType = i.VarType(); ! 2;

real r;
integer rType = r.VarType(); ! 3;

string s;
integer sType = s.VarType(); ! 4;

time t;
integer tType = t.VarType(); ! 5

            `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.bType.should.equal('1');
                        objects.iType.should.equal('2');
                        objects.rType.should.equal('3');
                        objects.sType.should.equal('4');
                        objects.tType.should.equal('5');
                        done();
                    }
                });
            });

            it('6.1.1 should determine additional VarType() (community)', function (done) {
                if (flavor === '.normal') {
                    return this.skip();
                }

                this.timeout(30000);
                rega.exec(`
var v;
integer vType = v.VarType(); ! 0;                
                
object o;
integer oType = o.VarType(); ! 9

idarray d;
integer dType = d.VarType(); ! 10

            `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.vType.should.equal('0');
                        objects.oType.should.equal('9');
                        objects.dType.should.equal('10');
                        done();
                    }
                });
            });

            it('6.1.2 should do ToString()', function (done) {
                this.timeout(30000);
                rega.exec(`
var i = 1.23456;
var s = i.ToString(3); ! s = "1.235"; s ist eine Zeichenkette
var r = s.ToString(1); ! r = "1.2"; r ist eine Zeichenkette
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('1.234560');
                        objects.s.should.equal('1.235');
                        objects.r.should.equal('1.2');
                        done();
                    }
                });
            });

            it('6.1.2.1 should do ToString() on time', function (done) {
                this.timeout(30000);
                rega.exec(`
time t = @2008-12-24 18:30:00@;
string sDate = t.ToString("%d.%m.%Y"); ! sDate = "24.12.2008";
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.sDate.should.equal('24.12.2008');
                        done();
                    }
                });
            });

            it('6.1.2.2 should deal with @time@ strings', function (done) {
                this.timeout(30000);
                rega.exec(`
time t1 = @2019-05-01 12:34:56@;
string s1 = t1.ToString();
time t2 = @2019-05-01 12:34@;
string s2 = t2.ToString();
time t3 = @05-01 12:34:56@;
string s3 = t3.ToString();
time t4 = @05-01 12:34@;
string s4 = t4.ToString();
time t5 = @01 12:34:56@;
string s5 = t5.ToString();
time t6 = @01 12:34@;
string s6 = t6.ToString();
time t7 = @2019-05-01@;
string s7 = t7.ToString();
time t8 = @2019-05-1@;
string s8 = t8.ToString();
time t9 = @2019-5-01@;
string s9 = t9.ToString();
time t10 = @2019-5-1@;
string s10 = t10.ToString();
time t11 = @12:34:56@;
string s11 = t11.ToString();
time t12 = @1:2:3@;
string s12 = t12.ToString();
time t13 = @12:34@;
string s13 = t13.ToString();
time t14 = @05-01@;
string s14 = t14.ToString();
time t15 = @01@;
string s15 = t15.ToString();
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        const curDate = new Date();
                        const year = curDate.getFullYear();
                        const month = ('0' + (curDate.getMonth() + 1)).slice(-2);
                        const day = ('0' + (curDate.getDate())).slice(-2);
                        objects.s1.should.equal('2019-05-01 12:34:56');
                        objects.s2.should.equal('2019-05-01 12:34:00');
                        objects.s3.should.equal(year + '-05-01 12:34:56');
                        objects.s4.should.equal(year + '-05-01 12:34:00');
                        objects.s5.should.equal(year + '-' + month + '-01 12:34:56');
                        objects.s6.should.equal(year + '-' + month + '-01 12:34:00');
                        objects.s7.should.equal('2019-05-01 00:00:00');
                        objects.s8.should.equal('2019-05-01 00:00:00');
                        objects.s9.should.equal('2019-05-01 00:00:00');
                        objects.s10.should.equal('2019-05-01 00:00:00');
                        objects.s11.should.equal(year + '-' + month + '-' + day + ' 12:34:56');
                        objects.s12.should.equal(year + '-' + month + '-' + day + ' 01:02:03');
                        objects.s13.should.equal(year + '-' + month + '-' + day + ' 12:34:00');
                        objects.s14.should.equal(year + '-05-01 00:00:00');
                        objects.s15.should.equal(year + '-' + month + '-01 00:00:00');
                        done();
                    }
                });
            });

            it('6.1.3 should do string.ToInteger()', function (done) {
                this.timeout(30000);
                rega.exec(`
var s = "100";
var i = s.ToInteger(); ! i = 100; i ist eine Ganzzahl
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.s.should.equal('100');
                        objects.i.should.equal('100');
                        done();
                    }
                });
            });

            it('6.1.3 should do real.ToInteger()', function (done) {
                this.timeout(30000);
                rega.exec(`
real r = 100.000;
var i = r.ToInteger(); ! i = 100; i ist eine Ganzzahl
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.r.should.equal('100.000000');
                        objects.i.should.equal('100');
                        done();
                    }
                });
            });

            it('6.1.4 should do ToTime()', function (done) {
                this.timeout(30000);
                rega.exec(`
var i = 1;
var t = i.ToTime(); ! t = @1970-01-01 01:00:01@ (CET)
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.t.should.equal('1970-01-01 01:00:01');
                        done();
                    }
                });
            });

            it('6.2 should handle boolean values', function (done) {
                this.timeout(30000);
                rega.exec(`
boolean bTRUE = true;
boolean bFALSE = false;
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.bTRUE.should.equal('true');
                        objects.bFALSE.should.equal('false');
                        done();
                    }
                });
            });

            it('6.3 should handle negative integers', function (done) {
                this.timeout(30000);
                rega.exec(`
integer i = -123;
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.i.should.equal('-123');
                        done();
                    }
                });
            });

            it('6.4 should handle real values', function (done) {
                this.timeout(30000);
                rega.exec(`
real r = 1.0;
real s = "-1.0E-1".ToFloat(); ! -0.1
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.r.should.equal('1.000000');
                        objects.s.should.equal('-0.100000');
                        done();
                    }
                });
            });

            it('6.5.1 should do Year(), Month(), Day(), ...', function (done) {
                this.timeout(30000);
                rega.exec(`
time t = @2008-12-24 18:30:00@;
integer year = t.Year(); ! year = 2008
integer month = t.Month(); ! month = 12
integer day = t.Day(); ! day = 24
integer hour = t.Hour(); ! hour = 18
integer minute = t.Minute(); ! minute = 30
integer second = t.Second(); ! second = 0
integer week = t.Week(); ! week = 51
integer weekday = t.Weekday(); ! weekday = 4
integer yearday = t.Yearday(); ! yearday = 359
integer isLocalTime = t.IsLocalTime(); ! isLocalTime = 1
integer isDST = t.IsDST(); ! isDST = 0
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.should.containEql({
                            t: '2008-12-24 18:30:00',
                            year: '2008',
                            month: '12',
                            day: '24',
                            hour: '18',
                            minute: '30',
                            second: '0',
                            week: '51',
                            weekday: '4',
                            yearday: '359',
                            isLocalTime: '1',
                            isDST: '0'
                        });
                        done();
                    }
                });
            });

            it('6.5.2 should do date/time Format()', function (done) {
                this.timeout(30000);
                rega.exec(`
time t = @2008-12-24 18:30:00@;
string perc = t.Format("%%");   ! perc = "%"
string lowerA = t.Format("%a"); ! lowerA = "Wed"
string upperA = t.Format("%A"); ! upperA = "Wednesday"
string lowerB = t.Format("%b"); ! lowerB = "Dec"
string upperB = t.Format("%B"); ! upperB = "December"
string lowerC = t.Format("%c"); ! lowerC = "Wed Dec 24 18:30:00 2008"
string upperC = t.Format("%C"); ! upperC = "20"
string lowerD = t.Format("%d"); ! lowerD = "24"
string upperD = t.Format("%D"); ! upperD = "12/24/08"
string upperF = t.Format("%F"); ! upperF = "2008-12-24"
string lowerH = t.Format("%h"); ! lowerH = "Dec"
string upperH = t.Format("%H"); ! upperH = "18"
string upperI = t.Format("%I"); ! upperI = "06"
string lowerJ = t.Format("%j"); ! lowerJ = "359"
string lowerM = t.Format("%m"); ! lowerM = "12"
string upperM = t.Format("%M"); ! upperM = "30"
string lowerN = t.Format("%n"); ! lowerN = "<NEWLINE>"
string lowerP = t.Format("%p"); ! lowerP = "PM"
string lowerR = t.Format("%r"); ! lowerR = "06:30:00 PM"
string upperS = t.Format("%S"); ! upperS = "00"
string lowerT = t.Format("%t"); ! lowerT = "<TAB>"
string upperT = t.Format("%T"); ! upperT = "18:30:00"
string lowerU = t.Format("%u"); ! lowerU = "3"
string upperU = t.Format("%U"); ! upperU = "51"
string upperV = t.Format("%V"); ! upperV = "52"
string lowerW = t.Format("%w"); ! lowerW = "3"
string upperW = t.Format("%W"); ! upperW = "51"
string lowerX = t.Format("%x"); ! lowerX = "12/24/08"
string upperX = t.Format("%X"); ! upperX = "18:30:00"
string lowerY = t.Format("%y"); ! lowerY = "08"
string upperY = t.Format("%Y"); ! upperY = "2008"
string lowerZ = t.Format("%z"); ! lowerZ = "+0100"
string upperZ = t.Format("%Z"); ! upperZ = "CET"
string sDate = t.Format("%d.%m.%Y"); ! sDate = "24.12.2008"
string sTime = t.Format("%H:%M:%S"); ! sTime = "18:30:00"
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.should.containEql({
                            perc: '%',
                            lowerA: 'Wed',
                            upperA: 'Wednesday',
                            lowerB: 'Dec',
                            upperB: 'December',
                            lowerC: 'Wed Dec 24 18:30:00 2008',
                            upperC: '20',
                            lowerD: '24',
                            upperD: '12/24/08',
                            upperF: '2008-12-24',
                            lowerH: 'Dec',
                            upperH: '18',
                            upperI: '06',
                            lowerJ: '359',
                            lowerM: '12',
                            upperM: '30',
                            lowerN: '\n',
                            lowerP: 'PM',
                            lowerR: '06:30:00 PM',
                            upperS: '00',
                            lowerT: '\t',
                            upperT: '18:30:00',
                            lowerU: '3',
                            upperU: '51',
                            upperV: '52',
                            lowerW: '3',
                            upperW: '51',
                            lowerX: '12/24/08',
                            upperX: '18:30:00',
                            lowerY: '08',
                            upperY: '2008',
                            lowerZ: '+0100',
                            upperZ: 'CET',
                            sDate: '24.12.2008',
                            sTime: '18:30:00'
                        });
                        done();
                    }
                });
            });

            it('6.6 should output Hello World', function (done) {
                this.timeout(30000);
                rega.exec('string x = "Hello";\nWriteLine(x # " World!");', function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('Hello World!\r\n');
                        done();
                    }
                });
            });

            it('6.6.1 should correctly deal with escape (\\) chars', function (done) {
                this.timeout(30000);
                rega.exec(`
string a = "xxx\\\\xxx";
string b = "xxx\\\"xxx";
string c = "xxx\\\'xxx";
string d = "xxx\\txxx";
string e = "xxx\\nxxx";
string f = "xxx\\rxxx";
string g = "xxx\\\\\\\\xxx";
string h = "xxx\\\\\\"xxx";
string i = "xxx\\\\'xxx";
string j = "xxx\\\\txxx";
string k = "xxx\\\\nxxx";
string l = "xxx\\\\rxxx";
string m = "\\\"";
string n = "\\\\";
string o = "\\\\\\"";
string p = "\\\\\\\\";
string q = "\\\\\\t\\"";
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.a.should.equal('xxx\\xxx');
                        objects.b.should.equal('xxx"xxx');
                        objects.c.should.equal('xxx\'xxx');
                        objects.d.should.equal('xxx\txxx');
                        objects.e.should.equal('xxx\nxxx');
                        objects.f.should.equal('xxx\rxxx');
                        objects.g.should.equal('xxx\\\\xxx');
                        objects.h.should.equal('xxx\\\"xxx');
                        objects.i.should.equal('xxx\\\'xxx');
                        objects.j.should.equal('xxx\\txxx');
                        objects.k.should.equal('xxx\\nxxx');
                        objects.l.should.equal('xxx\\rxxx');
                        objects.m.should.equal('"');
                        objects.n.should.equal('\\');
                        objects.o.should.equal('\\"');
                        objects.p.should.equal('\\\\');
                        objects.q.should.equal('\\\t"');
                        done();
                    }
                });
            });

            it('6.6.1 should correctly deal with raw/super string (^xxx^) literal', function (done) {
                this.timeout(30000);
                rega.exec(`
string a = ^\\\\t\\n\\r\\\'\\\"\"\'\'~&=^;
string b = ^\\^;
string c = ^\\\\^;
string d = ^\\\\\\^;
string e = ^abcd\\zui^.Replace(^\\^,^\\\\^);
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.a.should.equal('\\\\t\\n\\r\\\'\\\"\"\'\'~&=');
                        objects.b.should.equal('\\');
                        objects.c.should.equal('\\\\');
                        objects.d.should.equal('\\\\\\');
                        objects.e.should.equal('abcd\\\\zui');
                        done();
                    }
                });
            });

            // see https://en.wikipedia.org/wiki/ISO/IEC_8859-1
            it('6.6.1 should correctly deal with all ISO-8859-1 chars in strings', function (done) {
                this.timeout(30000);
                rega.exec(`
string chars2X = "\u0020\u0021\\\u0022\u0023\u0024\u0025\u0026\u0027\u0028\u0029\u002A\u002B\u002C\u002D\u002E\u002F";
string chars3X = "\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u003A\u003B\u003C\u003D\u003E\u003F";
string chars4X = "\u0040\u0041\u0042\u0043\u0044\u0045\u0046\u0047\u0048\u0049\u004A\u004B\u004C\u004D\u004E\u004F";
string chars5X = "\u0050\u0051\u0052\u0053\u0054\u0055\u0056\u0057\u0058\u0059\u005A\u005B\\\u005C\u005D\u005E\u005F";
string chars6X = "\u0060\u0061\u0062\u0063\u0064\u0065\u0066\u0067\u0068\u0069\u006A\u006B\u006C\u006D\u006E\u006F";
string chars7X = "\u0070\u0071\u0072\u0073\u0074\u0075\u0076\u0077\u0078\u0079\u007A\u007B\u007C\u007D\u007E";
string charsAX = "\u00A0\u00A1\u00A2\u00A3\u00A4\u00A5\u00A6\u00A7\u00A8\u00A9\u00AA\u00AB\u00AC\u00AD\u00AE\u00AF";
string charsBX = "\u00B0\u00B1\u00B2\u00B3\u00B4\u00B5\u00B6\u00B7\u00B8\u00B9\u00BA\u00BB\u00BC\u00BD\u00BE\u00BF";
string charsCX = "\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB\u00CC\u00CD\u00CE\u00CF";
string charsDX = "\u00D0\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D7\u00D8\u00D9\u00DA\u00DB\u00DC\u00DD\u00DE\u00DF";
string charsEX = "\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00E6\u00E7\u00E8\u00E9\u00EA\u00EB\u00EC\u00ED\u00EE\u00EF";
string charsFX = "\u00F0\u00F1\u00F2\u00F3\u00F4\u00F5\u00F6\u00F7\u00F8\u00F9\u00FA\u00FB\u00FC\u00FD\u00FE\u00FF";
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.chars2X.should.equal('\u0020\u0021\u0022\u0023\u0024\u0025\u0026\u0027\u0028\u0029\u002A\u002B\u002C\u002D\u002E\u002F');
                        objects.chars3X.should.equal('\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u003A\u003B\u003C\u003D\u003E\u003F');
                        objects.chars4X.should.equal('\u0040\u0041\u0042\u0043\u0044\u0045\u0046\u0047\u0048\u0049\u004A\u004B\u004C\u004D\u004E\u004F');
                        objects.chars5X.should.equal('\u0050\u0051\u0052\u0053\u0054\u0055\u0056\u0057\u0058\u0059\u005A\u005B\u005C\u005D\u005E\u005F');
                        objects.chars6X.should.equal('\u0060\u0061\u0062\u0063\u0064\u0065\u0066\u0067\u0068\u0069\u006A\u006B\u006C\u006D\u006E\u006F');
                        objects.chars7X.should.equal('\u0070\u0071\u0072\u0073\u0074\u0075\u0076\u0077\u0078\u0079\u007A\u007B\u007C\u007D\u007E');
                        objects.charsAX.should.equal('\u00A0\u00A1\u00A2\u00A3\u00A4\u00A5\u00A6\u00A7\u00A8\u00A9\u00AA\u00AB\u00AC\u00AD\u00AE\u00AF');
                        objects.charsBX.should.equal('\u00B0\u00B1\u00B2\u00B3\u00B4\u00B5\u00B6\u00B7\u00B8\u00B9\u00BA\u00BB\u00BC\u00BD\u00BE\u00BF');
                        objects.charsCX.should.equal('\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB\u00CC\u00CD\u00CE\u00CF');
                        objects.charsDX.should.equal('\u00D0\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D7\u00D8\u00D9\u00DA\u00DB\u00DC\u00DD\u00DE\u00DF');
                        objects.charsEX.should.equal('\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00E6\u00E7\u00E8\u00E9\u00EA\u00EB\u00EC\u00ED\u00EE\u00EF');
                        objects.charsFX.should.equal('\u00F0\u00F1\u00F2\u00F3\u00F4\u00F5\u00F6\u00F7\u00F8\u00F9\u00FA\u00FB\u00FC\u00FD\u00FE\u00FF');
                        done();
                    }
                });
            });

            it('6.6.2 should do ToFloat()', function (done) {
                this.timeout(30000);
                rega.exec(`
string s = "1.01";
real r1 = s.ToFloat(); ! r1 = 1.01;
real r2 = "0.1".ToFloat(); ! r2 = 0.1;
real r3 = "1E-1".ToFloat(); ! r3 = 0.1       
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.r1.should.equal('1.010000');
                        objects.r2.should.equal('0.100000');
                        objects.r3.should.equal('0.100000');
                        done();
                    }
                });
            });

            it('6.6.3 should do Length()', function (done) {
                this.timeout(30000);
                rega.exec(`
string s = "Hallo\\tWelt!";
integer length = s.Length(); ! length = 11
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.length.should.equal('11');
                        done();
                    }
                });
            });

            it('6.6.4 should do Substr()', function (done) {
                this.timeout(30000);
                rega.exec(`
string s = "Hallo Welt!";
string world = s.Substr(6, 4); ! world = "Welt"
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.world.should.equal('Welt');
                        done();
                    }
                });
            });

            it('6.6.5 should Find() string positions', function (done) {
                this.timeout(30000);
                rega.exec(`
string s = "Hallo Welt";
integer World = s.Find("Welt"); ! World = 6
integer world = s.Find("welt"); ! world = -1
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.World.should.equal('6');
                        objects.world.should.equal('-1');
                        done();
                    }
                });
            });

            it('6.6.5.1 should test Contains(), StartsWith(), EndsWith()', function (done) {
                this.timeout(30000);
                rega.exec(`
string s = "Hallo Welt";
boolean bWorld = s.Contains("Welt"); ! bWorld = true
boolean bStart = s.StartsWith("Hallo"); !bStart = true
boolean bEnd = s.EndsWith("Welt"); !bEnd = true
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.bWorld.should.equal('true');
                        objects.bStart.should.equal('true');
                        objects.bEnd.should.equal('true');
                        done();
                    }
                });
            });

            it('6.6.6 should do Split() and sum up ToInteger()', function (done) {
                this.timeout(30000);
                rega.exec(`
string summanden = "1,2,3";
integer summe = 0;
string summand;
foreach(summand, summanden.Split(","))
{
    summe = summe + summand.ToInteger();
}
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.summe.should.equal('6');
                        done();
                    }
                });
            });

            it('6.6.7 should do StrValueByIndex(()', function (done) {
                this.timeout(30000);
                rega.exec(`
string Rezept = "Butter,Eier,Mehl,Milch,Zucker";
string ErsteZutat = Rezept.StrValueByIndex(",", 0); ! ErsteZutat = Butter
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.ErsteZutat.should.equal('Butter');
                        done();
                    }
                });
            });

            it('6.6.8 should use UriEncode()/UriDecode() (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
string str = " !\\\"#$%&'()";
string kodiert = str.UriEncode(); ! kodiert = %20%21%22%23%24%25%26%27%28%29
string dekodiert = kodiert.UriDecode(); ! dekodiert = !"#$%&\\'()
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.kodiert.should.equal('%20%21%22%23%24%25%26%27%28%29');
                        objects.dekodiert.should.equal(' !"#$%&\'()');
                        done();
                    }
                });
            });

            it('6.6.9 should use ToUTF8()/ToLatin() (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
string str = "Übergrößenträger";
string utf8 = str.ToUTF8(); ! utf8 = "ÃbergrÃ¶ÃentrÃ¤ger“
string latin = utf8.ToLatin(); ! latin= "Übergrößenträger“
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.utf8.should.equal('ÃbergrÃ¶ÃentrÃ¤ger');
                        objects.latin.should.equal('Übergrößenträger');
                        done();
                    }
                });
            });

            it('6.6.10 should use ToUpper()/ToLower() (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
string str = "AbCdEfGhI";
string upper = str.ToUpper(); ! upper = "ABCDEFGHI“
string lower = str.ToLower(); ! lower = "abcdefghi“
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.upper.should.equal('ABCDEFGHI');
                        objects.lower.should.equal('abcdefghi');
                        done();
                    }
                });
            });

            it('6.6.11 should use Trim()/LTrim()/RTrim() (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
string str = " \\tAnfang und Ende \\r\\n";
string trim = str.Trim();               ! trim = "Anfang und Ende"
string ltrim = str.LTrim();             ! ltrim = "Anfang und Ende \\r\\n"
string rtrim = str.RTrim();             ! rtrim = " \\tAnfang und Ende"
string trimc = str.Trim(" \\t\\nAnfang"); ! trimc = "und Ende \\r"
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.trim.should.equal('Anfang und Ende');
                        objects.ltrim.should.equal('Anfang und Ende \r\n');
                        objects.rtrim.should.equal(' \tAnfang und Ende');
                        objects.trimc.should.equal('und Ende \r');
                        done();
                    }
                });
            });

            it('6.6.12 should use Replace() (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
string str = "John hates Jane";
string replaced = str.Replace("hates", "loves"); ! replaced = "John loves Jane"
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.replaced.should.equal('John loves Jane');
                        done();
                    }
                });
            });

            it('8.1 should use additional math functions (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
var a;
a = -1.5;
var b = a.Abs();      ! b = 1.5
a = 5.0;
var c = a.Mod(3);     ! c = 2.0
var d = a.Min(8.0);   ! d = 5.0
var e = a.Max(8.0);   ! e = 8.0
a = 2.0;
var f = a.Exp();      ! f = 7.389056
var g = a.Exp2();     ! g = 4.0
var h = a.Exp10();    ! h = 100.0
var i = a.Expm1();    ! i = 6.389056
var j = a.Log();      ! j = 0.693147
var k = a.Log2();     ! k = 1.0
var l = a.Log10();    ! l = 0.301030
var m = a.Log1p();    ! m = 1.098612
var n = a.Sqrt();     ! n = 1.414214
var o = a.Cbrt();     ! o = 1.259921
var p = a.Pow(2.0);   ! p = 4.0
var q = a.Sin();      ! q = 0.909297
var r = a.Cos();      ! r = -0.416147
var s = a.Tan();      ! s = -2.185040
a = 1.0;
var t = a.Asin();     ! t = 1.570796
a = 0.0;
var u = a.Acos();     ! u = 1.570796
a = 2.0;
var v = a.Atan();     ! v = 1.107149
var w = a.Sinh();     ! w = 3.626860
var x = a.Cosh();     ! x = 3.762196
var y = a.Tanh();     ! y = 0.964028
var z = a.Asinh();    ! z = 1.443635
var za = a.Acosh();   ! za = 1.316958
a = 0.5;
var zb = a.Atanh();   ! zb = 0.549306
a = 0.4521;
var zc = a.Ceil();    ! zc = 1.0
var zd = a.Floor();   ! zd = 0.0
var ze = a.Trunc(1);  ! ze = 0.4
var zf = a.Round(1);  ! zf = 0.5
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.should.containEql({
                            b: '1.500000',
                            c: '2.000000',
                            d: '5.000000',
                            e: '8.000000',
                            f: '7.389056',
                            g: '4.000000',
                            h: '100.000000',
                            i: '6.389056',
                            j: '0.693147',
                            k: '1.000000',
                            l: '0.301030',
                            m: '1.098612',
                            n: '1.414214',
                            o: '1.259921',
                            p: '4.000000',
                            q: '0.909297',
                            r: '-0.416147',
                            s: '-2.185040',
                            t: '1.570796',
                            u: '1.570796',
                            v: '1.107149',
                            w: '3.626860',
                            x: '3.762196',
                            y: '0.964028',
                            z: '1.443635',
                            za: '1.316958',
                            zb: '0.549306',
                            zc: '1.000000',
                            zd: '0.000000',
                            ze: '0.400000',
                            zf: '0.500000'
                        });
                        done();
                    }
                });
            });

            it('8.2 should have math constants like M_E, M_PI, etc. (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
var one = 1.0;
var two = 2.0;
var ten = 10.0;
var m_e = one.Exp() == M_E;
var m_log2e = M_E.Log2() == M_LOG2E;
var m_log10e = M_E.Log10() == M_LOG10E;
var m_ln2 = two.Log() == M_LN2;
var m_ln10 = ten.Log() == M_LN10;
var m_pi = 3.141592653589793 == M_PI;
var m_pi_2 = (M_PI / 2.0) == M_PI_2;
var m_pi_4 = (M_PI / 4.0) == M_PI_4;
var m_1_pi = (1.0 / M_PI) == M_1_PI;
var m_2_pi = (2.0 / M_PI) == M_2_PI;
var m_2_sqrtpi = (2.0 / M_PI.Sqrt()) == M_2_SQRTPI;
var m_sqrt2 = (two.Sqrt() == M_SQRT2);
var m_sqrt1_2 = (1.0 / two.Sqrt()) == M_SQRT1_2;
var r = 4.2; ! Kreisradius in cm
var A = (M_PI * r.Pow(2)).Round(2); ! Kreisfläche A =  pi * r^2 = 55.42 cm
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        objects.should.containEql({
                            one: '1.000000',
                            two: '2.000000',
                            ten: '10.000000',
                            m_e: 'true',
                            m_log2e: 'true',
                            m_log10e: 'true',
                            m_ln2: 'true',
                            m_ln10: 'true',
                            m_pi: 'true',
                            m_pi_2: 'true',
                            m_pi_4: 'true',
                            m_1_pi: 'true',
                            m_2_pi: 'true',
                            m_2_sqrtpi: 'true',
                            m_sqrt2: 'true',
                            m_sqrt1_2: 'true',
                            A: '55.420000'
                        });
                        done();
                    }
                });
            });

            it('8.2 should return M_PI with 6 digits (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec('Write(M_PI);', function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('3.141593');
                        done();
                    }
                });
            });

            it('8.2 should return M_PI with 15 digits (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec('var pi = M_PI;\nWrite(pi.ToString(15));', function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        output.should.equal('3.141592653589793');
                        done();
                    }
                });
            });

            it('9.1 should have working random generator (standard/community)', function (done) {
                this.timeout(30000);
                rega.exec(`
var dice = system.Random(1, 6);
system.Srandom(12345);
var nonrandom = system.Random(-1000, 1000); ! nonrandom = 545
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        Number.parseFloat(objects.dice).should.be.within(1, 6);
                        objects.nonrandom.should.equal('545');
                        done();
                    }
                });
            });
        });

        // cleanup test environment
        cleanupTest(flavor);
    });
});
