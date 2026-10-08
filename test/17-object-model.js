/* global describe, it */
/* eslint-disable prefer-arrow-callback, capitalized-comments */

// Object model tests: creates system variables of all types, rooms,
// functions and a program the same way the WebUI does, checks their
// properties, saves the regadom, restarts ReGaHss with it (persistence round
// trip) and deletes the objects again.

const fs = require('fs');

const {
    rega,
    regaLabel,
    initTest,
    cleanupTest,
    regaInstance
} = require('../lib/helper.js');
const {programScript} = require('../lib/program-builder.js');
const {until} = require('../lib/script-helpers.js');

require('should');

// system variables (see ::SaveSysVar in /www/rega/esp/system.fn)
const sysvars = `
object list = dom.GetObject(ID_SYSTEM_VARIABLES);
object sv;

sv = dom.CreateObject(OT_VARDP, "OM Bool");
list.Add(sv.ID());
sv.DPInfo("bool info");
sv.ValueUnit("");
sv.ValueType(ivtBinary);
sv.ValueSubType(istBool);
sv.ValueName1("an");
sv.ValueName0("aus");
sv.State(false);

sv = dom.CreateObject(OT_ALARMDP, "OM Alarm");
list.Add(sv.ID());
sv.DPInfo("alarm info");
sv.ValueType(ivtBinary);
sv.ValueSubType(istAlarm);
sv.ValueName1("ausgelöst");
sv.ValueName0("nicht ausgelöst");
sv.AlType(atSystem);
sv.AlArm(true);

sv = dom.CreateObject(OT_VARDP, "OM Number");
list.Add(sv.ID());
sv.DPInfo("number info");
sv.ValueUnit("°C");
sv.ValueType(ivtFloat);
sv.ValueSubType(istGeneric);
sv.ValueMin(-10);
sv.ValueMax(40);
sv.State(-10);

sv = dom.CreateObject(OT_VARDP, "OM Enum");
list.Add(sv.ID());
sv.DPInfo("enum info");
sv.ValueType(ivtInteger);
sv.ValueSubType(istEnum);
sv.ValueList("rot;gelb;grün");
sv.State(0);

sv = dom.CreateObject(OT_VARDP, "OM String");
list.Add(sv.ID());
sv.DPInfo("string info");
sv.ValueType(ivtString);
sv.ValueSubType(istChar8859);
sv.State("???");

dom.RTUpdate(0);
`;

// properties of the system variables
const sysvarProperties = `
string name;
foreach (name, "OM Bool\\tOM Alarm\\tOM Number\\tOM Enum\\tOM String") {
  object sv = dom.GetObject(name);
  if (sv) {
    WriteLine(sv.Name() # "|" # sv.TypeName() # "|" # sv.ValueType() # "|" # sv.ValueSubType() # "|" # sv.DPInfo() # "|" # sv.ValueUnit() # "|" # sv.ValueName0() # "|" # sv.ValueName1() # "|" # sv.ValueMin() # "|" # sv.ValueMax() # "|" # sv.ValueList() # "|" # sv.Value() # "|" # dom.GetObject(ID_SYSTEM_VARIABLES).Get(name).ID().ToString().Length() > 0);
  } else {
    WriteLine(name # "|missing");
  }
}
`;

// (name|type|value type|value sub type|info|unit|name 0|name 1|min|max|value list|value|listed)
const expectedSysvars = (values = {}) => [
    'OM Bool|VARDP|2|2|bool info||aus|an||||' + (values.bool ?? 'false') + '|true',
    'OM Alarm|ALARMDP|2|6|alarm info||nicht ausgelöst|ausgelöst||||' + (values.alarm ?? '') + '|true',
    'OM Number|VARDP|4|0|number info|°C|0|1|-10|40||' + (values.number ?? '-10.000000') + '|true',
    'OM Enum|VARDP|16|29|enum info||0|1|||rot;gelb;grün|' + (values.enum ?? '0') + '|true',
    'OM String|VARDP|20|11|string info||0|1||||' + (values.string ?? '???') + '|true'
].join('\r\n') + '\r\n';

// rooms and functions with a channel (see rooms.fn, functions.fn, channels.fn)
const enums = `
object chn = dom.GetObject("HM-RCV-50 BidCoS-RF:1");
object room = dom.CreateObject(OT_ENUM, "OM Room");
room.EnumType(etRoom);
dom.GetObject(ID_ROOMS).Add(room);
room.Add(chn.ID());
object func = dom.CreateObject(OT_ENUM, "OM Function");
func.EnumType(etFunction);
dom.GetObject(ID_FUNCTIONS).Add(func);
func.Add(chn.ID());
WriteLine(dom.GetObject(ID_ROOMS).Get("OM Room").ID() == room.ID());
WriteLine(dom.GetObject(ID_FUNCTIONS).Get("OM Function").ID() == func.ID());
`;

const enumProperties = `
string name;
foreach (name, "OM Room\\tOM Function") {
  object e = dom.GetObject(name);
  if (e) {
    string ids = "";
    string id;
    foreach (id, e.EnumUsedIDs()) {
      ids = ids # dom.GetObject(id).Name() # ",";
    }
    WriteLine(e.Name() # "|" # e.TypeName() # "|" # e.EnumType() # "|" # ids);
  } else {
    WriteLine(name # "|missing");
  }
}
object chn = dom.GetObject("HM-RCV-50 BidCoS-RF:1");
string rooms = "";
string id;
foreach (id, chn.ChnRoom()) {
  rooms = rooms # dom.GetObject(id).Name() # ",";
}
WriteLine("channel rooms: " # rooms);
`;

const program = programScript({
    name: 'OM Program',
    rules: [
        {
            conditions: [[{
                sysvar: 'OM Number', compare: '>', value: 30, trigger: 'change'
            }]],
            destinations: [{sysvar: 'OM String', value: 'hot'}, {sysvar: 'OM Bool', value: true}]
        },
        {destinations: [{sysvar: 'OM String', value: 'normal'}]}
    ]
});

async function value(name) {
    const result = await rega.exec('Write(dom.GetObject("' + name + '").Value());');
    return result.output;
}

async function setAndWait(name, newValue, observed, expected) {
    await rega.exec('dom.GetObject("' + name + '").State(' + JSON.stringify(newValue) + ');');
    const deadline = Date.now() + 10_000;
    let actual = await value(observed);
    while (actual !== expected && Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => {
            setTimeout(resolve, 100);
        });
        // eslint-disable-next-line no-await-in-loop
        actual = await value(observed);
    }

    actual.should.equal(expected, observed + ' after setting ' + name + ' to ' + newValue);
}

describe('Running ' + __filename.split('/').reverse()[0] + ' [' + regaLabel + ']', function () {
    describe('creating objects', function () {
        initTest({sim: false});

        describe('system variables, rooms, functions, programs', function () {
            it('should create system variables of all types', async function () {
                await rega.exec(sysvars);
                const {output} = await rega.exec(sysvarProperties);
                output.should.equal(expectedSysvars());
            });

            it('should create a second object with the same name (names are not unique)', async function () {
                const {output} = await rega.exec(`
object first = dom.GetObject("OM Bool");
object sv = dom.CreateObject(OT_VARDP, "OM Bool");
WriteLine((sv.ID() != first.ID()) # " " # (dom.GetObject("OM Bool").ID() == first.ID()));
WriteLine(dom.DeleteObject(sv));
`);
                output.should.equal('true true\r\ntrue\r\n');
            });

            it('should set values of system variables', async function () {
                await rega.exec(`
dom.GetObject("OM Alarm").State(true);
dom.GetObject("OM Number").State(21.5);
dom.GetObject("OM Enum").State(2);
dom.GetObject("OM String").State("Grüße");
`);
                const {output} = await rega.exec(sysvarProperties);
                output.should.equal(expectedSysvars({
                    alarm: 'true', number: '21.500000', enum: '2', string: 'Grüße'
                }));
            });

            it('should not limit values to the range of number variables', async function () {
                await rega.exec('dom.GetObject("OM Number").State(100);');
                const above = await value('OM Number');
                await rega.exec('dom.GetObject("OM Number").State(-100);');
                const below = await value('OM Number');
                await rega.exec('dom.GetObject("OM Number").State(21.5);');
                // (records the behaviour: ReGaHss does not clip the values)
                above.should.equal('100.000000');
                below.should.equal('-100.000000');
            });

            it('should create rooms and functions with a channel', async function () {
                const {output} = await rega.exec(enums);
                output.should.equal('true\r\ntrue\r\n');
            });

            it('should list the channel in the room and function', async function () {
                const {output} = await rega.exec(enumProperties);
                output.should.equal('OM Room|ENUM|2|HM-RCV-50 BidCoS-RF:1,\r\nOM Function|ENUM|4|HM-RCV-50 BidCoS-RF:1,\r\nchannel rooms: OM Room,\r\n');
            });

            it('should create a program', async function () {
                const {output} = await rega.exec(program);
                Number(output).should.be.above(0);
            });

            it('should execute the program on a value change', async function () {
                this.timeout(30_000);
                await setAndWait('OM Number', 35, 'OM String', 'hot');
                // (the second destination may run after the first one)
                await until(value.bind(null, 'OM Bool'), 'true');
                await setAndWait('OM Number', 20, 'OM String', 'normal');
            });

            it('should save the regadom', async function () {
                const {output} = await rega.exec('WriteLine(system.Save());');
                output.should.equal('true\r\n');
                const dom = fs.readFileSync(regaInstance().domFile, 'latin1');
                for (const name of ['OM Bool', 'OM Alarm', 'OM Number', 'OM Enum', 'OM String', 'OM Room', 'OM Function', 'OM Program']) {
                    dom.should.containEql('<name>' + name + '</name>');
                }
            });
        });

        cleanupTest();
    });

    describe('restarting ReGaHss with the saved regadom', function () {
        initTest({sim: false, nocopy: true});

        describe('persisted objects', function () {
            it('should have kept the system variables and their values (except the alarm state)', async function () {
                const {output} = await rega.exec(sysvarProperties);
                // (records the behaviour: the state of alarm variables is not restored)
                output.should.equal(expectedSysvars({
                    bool: 'true', alarm: '', number: '20.000000', enum: '2', string: 'normal'
                }));
            });

            it('should have kept the rooms and functions', async function () {
                const {output} = await rega.exec(enumProperties);
                output.should.equal('OM Room|ENUM|2|HM-RCV-50 BidCoS-RF:1,\r\nOM Function|ENUM|4|HM-RCV-50 BidCoS-RF:1,\r\nchannel rooms: OM Room,\r\n');
            });

            it('should still execute the program', async function () {
                this.timeout(30_000);
                await setAndWait('OM Number', 31, 'OM String', 'hot');
                await setAndWait('OM Number', 10, 'OM String', 'normal');
            });

            it('should delete the objects', async function () {
                const {output} = await rega.exec(`
string name;
foreach (name, "OM Bool\\tOM Alarm\\tOM Number\\tOM Enum\\tOM String\\tOM Room\\tOM Function\\tOM Program") {
  object o = dom.GetObject(name);
  ! (result in a variable: "Write(dom.DeleteObject(o.ID()) # ...)" would pass
  ! the concatenation to DeleteObject, see test/corpus/09-expressions.rega)
  var deleted = dom.DeleteObject(o);
  Write(deleted # ",");
}
WriteLine("");
foreach (name, "OM Bool\\tOM Alarm\\tOM Number\\tOM Enum\\tOM String\\tOM Room\\tOM Function\\tOM Program") {
  Write(dom.GetObject(name) # ",");
}
WriteLine("");
WriteLine(system.Save());
`);
                output.should.equal('true,true,true,true,true,true,true,true,\r\nnull,null,null,null,null,null,null,null,\r\ntrue\r\n');
            });
        });

        cleanupTest();
    });

    describe('restarting ReGaHss after deleting the objects', function () {
        initTest({sim: false, nocopy: true});

        describe('deleted objects', function () {
            it('should not contain the deleted objects anymore', async function () {
                const {output} = await rega.exec(`
string name;
foreach (name, "OM Bool\\tOM Alarm\\tOM Number\\tOM Enum\\tOM String\\tOM Room\\tOM Function\\tOM Program") {
  Write(dom.GetObject(name) # ",");
}
`);
                output.should.equal('null,null,null,null,null,null,null,null,');
            });

            it('should still contain the objects of the test regadom', async function () {
                const {output} = await rega.exec('WriteLine(dom.GetObject("VarBool1").Name() # " " # dom.GetObject("TimeEveryMinute").Name());');
                output.should.equal('VarBool1 TimeEveryMinute\r\n');
            });
        });

        cleanupTest();
    });
});
