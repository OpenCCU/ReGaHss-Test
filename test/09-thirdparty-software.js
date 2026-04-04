/* global describe, it */
/* eslint-disable no-unused-vars, import-x/no-unassigned-import, no-template-curly-in-string, max-nested-callbacks, prefer-arrow-callback, capitalized-comments */

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
        initTest(flavor, false);

        describe('running examples from https://github.com/hobbyquaker/homematic-rega/tree/master/scripts', function () {
            it('should run variables.rega', function (done) {
                this.timeout(30000);
                rega.exec(`
!# variables.rega
!#
!# Dieses Script gibt die Systemvariablen im JSON Format aus
!#
!# 3'2013-9'2017 hobbyquaker https://github.com/hobbyquaker
!#

object oSysVar;
string sSysVarId;
string sValueType;
string sValue;
boolean bFirst = true;

Write('[');
WriteLine('{"id": "40", "name": "Alarmmeldungen", "val":' # dom.GetObject(40).Value() # ', "min": 0, "max": 65000, "unit": "", "type": "number", "enum": ""},');
Write('{"id": "41", "name": "Servicemeldungen", "val":' # dom.GetObject(41).Value() # ', "min": 0, "max": 65000, "unit": "", "type": "number", "enum": ""}');

foreach (sSysVarId, dom.GetObject(ID_SYSTEM_VARIABLES).EnumUsedIDs()) {
    WriteLine(',');
    oSysVar = dom.GetObject(sSysVarId);
    sValueType = oSysVar.ValueType();
    Write('{"id": "' # sSysVarId # '", "name": "' # oSysVar.Name() # '", "val": ');

    if (sValueType == 20) {
        Write('"' # oSysVar.Value() # '"');
    } else {
        sValue = oSysVar.Value();
        if (sValueType == 2) {
            if (sValue) {
                Write("true");
            } else {
                Write("false");
            }
        } else {
            if (sValue == "") {
                Write("0");
            } else {
                Write(sValue);
            }
        }
    }

    string sValueMin = oSysVar.ValueMin();
    if (sValueMin == '') {
        sValueMin = 'null';
    }

    string sValueMax = oSysVar.ValueMax();
    if (sValueMax == '') {
        sValueMax = 'null';
    }

    Write(',"ts":"' # oSysVar.Timestamp());
    Write('","min":' # sValueMin # ',"max":' # sValueMax # ',"unit":"' # oSysVar.ValueUnit() # '"');

    if (sValueType == 2) {
        Write(', "type": "boolean", "enum": "' # oSysVar.ValueName0() # ';' # oSysVar.ValueName1());
    } else {
        if (sValueType == 20) {
            Write(', "type": "string", "enum": "' # oSysVar.ValueList());
        } else {
            Write(', "type": "number", "enum": "' # oSysVar.ValueList());
        }
    }

    Write('"}');
}

Write(']');
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        const data = JSON.parse(output);
                        for (const datum of data) {
                            delete datum.ts;
                        }

                        data.should.deepEqual([
                            {
                                id: '40',
                                name: 'Alarmmeldungen',
                                val: 0,
                                min: 0,
                                max: 65000,
                                unit: '',
                                type: 'number',
                                enum: ''
                            },
                            {
                                id: '41',
                                name: 'Servicemeldungen',
                                val: 0,
                                min: 0,
                                max: 65000,
                                unit: '',
                                type: 'number',
                                enum: ''
                            },
                            {
                                id: '1234',
                                name: '${sysVarAlarmZone1}',
                                val: false,
                                min: null,
                                max: null,
                                unit: '',
                                type: 'boolean',
                                enum: '${sysVarAlarmZone1NotTriggered};${sysVarAlarmZone1Triggered}'
                            },
                            {
                                id: '950',
                                name: '${sysVarPresence}',
                                val: true,
                                min: null,
                                max: null,
                                unit: '',
                                type: 'boolean',
                                enum: '${sysVarPresenceNotPresent};${sysVarPresencePresent}'
                            },
                            {
                                id: '1923',
                                name: 'DutyCycle',
                                val: 0,
                                min: -1,
                                max: 100,
                                unit: '%',
                                type: 'number',
                                enum: ''
                            },
                            {
                                id: '1240',
                                name: 'VarAlarm1',
                                val: false,
                                min: null,
                                max: null,
                                unit: '',
                                type: 'boolean',
                                enum: 'nicht ausgelöst;ausgelöst'
                            },
                            {
                                id: '1237',
                                name: 'VarBool1',
                                val: false,
                                min: null,
                                max: null,
                                unit: '',
                                type: 'boolean',
                                enum: 'ist falsch;ist wahr'
                            },
                            {
                                id: '1238',
                                name: 'VarEnum1',
                                val: 0,
                                min: null,
                                max: null,
                                unit: '',
                                type: 'number',
                                enum: 'Wert 1;Wert 2;Wert 3'
                            },
                            {
                                id: '1239',
                                name: 'VarNum1',
                                val: 0,
                                min: 0,
                                max: 65000,
                                unit: '',
                                type: 'number',
                                enum: ''
                            },
                            {
                                id: '1243',
                                name: 'VarString1',
                                val: '???',
                                min: null,
                                max: null,
                                unit: '',
                                type: 'string',
                                enum: ''
                            }
                        ]);
                        done();
                    }
                });
            });

            it('should run programs.rega', function (done) {
                this.timeout(30000);
                rega.exec(`
!# programs.rega
!# Dieses Script gibt eine Liste der Programme im JSON Format aus
!#
!# 3'2013-9'2017 hobbyquaker https://github.com/hobbyquaker
!#

string oPrgID;
object oProgram;
boolean first = true;

Write('[');

foreach (oPrgID, dom.GetObject(ID_PROGRAMS).EnumUsedIDs()) {
    oProgram = dom.GetObject(oPrgID);

    if(oProgram != null) {
        if (first == false) {
            WriteLine(',');
        } else {
            first = false;
        }

        Write('{"id": "' # oPrgID # '", "name":"' # oProgram.Name() # '", "active":' # oProgram.Active());
        Write(',"ts":"' # oProgram.ProgramLastExecuteTime());
        Write('"}');
    }
}

Write(']');
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        const data = JSON.parse(output);
                        for (const datum of data) {
                            delete datum.ts;
                        }

                        data.should.deepEqual([
                            {
                                id: '1269',
                                name: 'Bool1OnFalse',
                                active: true
                            },
                            {
                                id: '1244',
                                name: 'Bool1OnFalseUpdate',
                                active: true
                            },
                            {
                                id: '1280',
                                name: 'Bool1OnTrue',
                                active: true
                            },
                            {
                                id: '1291',
                                name: 'Bool1OnTrueUpdate',
                                active: true
                            },
                            {id: '1337', name: 'Key1', active: true},
                            {
                                id: '1326',
                                name: 'Key16Key17',
                                active: true
                            },
                            {
                                id: '1911',
                                name: 'Time0000',
                                active: true
                            },
                            {
                                id: '1924',
                                name: 'Time0030',
                                active: true
                            },
                            {
                                id: '1314',
                                name: 'Time0100',
                                active: true
                            },
                            {
                                id: '1430',
                                name: 'Time0130',
                                active: true
                            },
                            {
                                id: '1458',
                                name: 'Time0155',
                                active: true
                            },
                            {
                                id: '1470',
                                name: 'Time0200',
                                active: true
                            },
                            {
                                id: '1498',
                                name: 'Time0205',
                                active: true
                            },
                            {
                                id: '1510',
                                name: 'Time0230',
                                active: true
                            },
                            {
                                id: '1522',
                                name: 'Time0255',
                                active: true
                            },
                            {
                                id: '1534',
                                name: 'Time0300',
                                active: true
                            },
                            {
                                id: '1546',
                                name: 'Time0305',
                                active: true
                            },
                            {
                                id: '1558',
                                name: 'Time0330',
                                active: true
                            },
                            {
                                id: '2148',
                                name: 'TimeEvery10s',
                                active: true
                            },
                            {
                                id: '1302',
                                name: 'TimeEveryMinute',
                                active: true
                            },
                            {
                                id: '1968',
                                name: 'TimeSpan0100-0103',
                                active: true
                            },
                            {
                                id: '2012',
                                name: 'TimeSpan0158-0202',
                                active: true
                            },
                            {
                                id: '2024',
                                name: 'TimeSpan0230-0200',
                                active: true
                            },
                            {
                                id: '2036',
                                name: 'TimeSpan0230-0232',
                                active: true
                            },
                            {
                                id: '2244',
                                name: 'TimeSpan2235-2305',
                                active: true
                            },
                            {
                                id: '2124',
                                name: 'TimeSpanDay',
                                active: true
                            },
                            {
                                id: '2112',
                                name: 'TimeSpanFullday',
                                active: true
                            },
                            {
                                id: '2136',
                                name: 'TimeSpanNight',
                                active: true
                            }
                        ]);
                        done();
                    }
                });
            });

            it('should run channels.rega', function (done) {
                this.timeout(30000);
                rega.exec(`
!# devices.rega
!#
!# Dieses Homematic-Script gibt eine Liste aller Geraete/Kanaele im JSON Format aus
!#
!# 3'2013-9'2017 hobbyquaker https://github.com/hobbyquaker
!#

string sDevId;
string sChnId;

Write('[');

boolean dFirst = true;

foreach (sDevId, root.Devices().EnumUsedIDs()) {

    object oDevice   = dom.GetObject(sDevId);
    boolean bDevReady = oDevice.ReadyConfig();

    if (bDevReady) {

        if (dFirst) {
            dFirst = false;
        } else {
            WriteLine(',');
        }

        Write('{"id": "' # sDevId # '", "address": "' # oDevice.Address() # '", "name": "' # oDevice.Name() # '"}');

        foreach(sChnId, oDevice.Channels()) {
            object oChannel = dom.GetObject(sChnId);
            WriteLine(',');
            Write('{"id": "' # sChnId # '", "address": "' # oChannel.Address() # '", "name":"' # oChannel.Name() # '"}');
        }

    }
}

Write(']');
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        const data = JSON.parse(output);
                        data.should.deepEqual([
                            {id: '1010', address: 'BidCoS-RF', name: 'HM-RCV-50 BidCoS-RF'},
                            {
                                id: '1011',
                                address: 'BidCoS-RF:0',
                                name: 'HM-RCV-50 BidCoS-RF:0'
                            },
                            {
                                id: '1013',
                                address: 'BidCoS-RF:1',
                                name: 'HM-RCV-50 BidCoS-RF:1'
                            },
                            {
                                id: '1017',
                                address: 'BidCoS-RF:2',
                                name: 'HM-RCV-50 BidCoS-RF:2'
                            },
                            {
                                id: '1021',
                                address: 'BidCoS-RF:3',
                                name: 'HM-RCV-50 BidCoS-RF:3'
                            },
                            {
                                id: '1025',
                                address: 'BidCoS-RF:4',
                                name: 'HM-RCV-50 BidCoS-RF:4'
                            },
                            {
                                id: '1029',
                                address: 'BidCoS-RF:5',
                                name: 'HM-RCV-50 BidCoS-RF:5'
                            },
                            {
                                id: '1033',
                                address: 'BidCoS-RF:6',
                                name: 'HM-RCV-50 BidCoS-RF:6'
                            },
                            {
                                id: '1037',
                                address: 'BidCoS-RF:7',
                                name: 'HM-RCV-50 BidCoS-RF:7'
                            },
                            {
                                id: '1041',
                                address: 'BidCoS-RF:8',
                                name: 'HM-RCV-50 BidCoS-RF:8'
                            },
                            {
                                id: '1045',
                                address: 'BidCoS-RF:9',
                                name: 'HM-RCV-50 BidCoS-RF:9'
                            },
                            {
                                id: '1049',
                                address: 'BidCoS-RF:10',
                                name: 'HM-RCV-50 BidCoS-RF:10'
                            },
                            {
                                id: '1053',
                                address: 'BidCoS-RF:11',
                                name: 'HM-RCV-50 BidCoS-RF:11'
                            },
                            {
                                id: '1057',
                                address: 'BidCoS-RF:12',
                                name: 'HM-RCV-50 BidCoS-RF:12'
                            },
                            {
                                id: '1061',
                                address: 'BidCoS-RF:13',
                                name: 'HM-RCV-50 BidCoS-RF:13'
                            },
                            {
                                id: '1065',
                                address: 'BidCoS-RF:14',
                                name: 'HM-RCV-50 BidCoS-RF:14'
                            },
                            {
                                id: '1069',
                                address: 'BidCoS-RF:15',
                                name: 'HM-RCV-50 BidCoS-RF:15'
                            },
                            {
                                id: '1073',
                                address: 'BidCoS-RF:16',
                                name: 'HM-RCV-50 BidCoS-RF:16'
                            },
                            {
                                id: '1077',
                                address: 'BidCoS-RF:17',
                                name: 'HM-RCV-50 BidCoS-RF:17'
                            },
                            {
                                id: '1081',
                                address: 'BidCoS-RF:18',
                                name: 'HM-RCV-50 BidCoS-RF:18'
                            },
                            {
                                id: '1085',
                                address: 'BidCoS-RF:19',
                                name: 'HM-RCV-50 BidCoS-RF:19'
                            },
                            {
                                id: '1089',
                                address: 'BidCoS-RF:20',
                                name: 'HM-RCV-50 BidCoS-RF:20'
                            },
                            {
                                id: '1093',
                                address: 'BidCoS-RF:21',
                                name: 'HM-RCV-50 BidCoS-RF:21'
                            },
                            {
                                id: '1097',
                                address: 'BidCoS-RF:22',
                                name: 'HM-RCV-50 BidCoS-RF:22'
                            },
                            {
                                id: '1101',
                                address: 'BidCoS-RF:23',
                                name: 'HM-RCV-50 BidCoS-RF:23'
                            },
                            {
                                id: '1105',
                                address: 'BidCoS-RF:24',
                                name: 'HM-RCV-50 BidCoS-RF:24'
                            },
                            {
                                id: '1109',
                                address: 'BidCoS-RF:25',
                                name: 'HM-RCV-50 BidCoS-RF:25'
                            },
                            {
                                id: '1113',
                                address: 'BidCoS-RF:26',
                                name: 'HM-RCV-50 BidCoS-RF:26'
                            },
                            {
                                id: '1117',
                                address: 'BidCoS-RF:27',
                                name: 'HM-RCV-50 BidCoS-RF:27'
                            },
                            {
                                id: '1121',
                                address: 'BidCoS-RF:28',
                                name: 'HM-RCV-50 BidCoS-RF:28'
                            },
                            {
                                id: '1125',
                                address: 'BidCoS-RF:29',
                                name: 'HM-RCV-50 BidCoS-RF:29'
                            },
                            {
                                id: '1129',
                                address: 'BidCoS-RF:30',
                                name: 'HM-RCV-50 BidCoS-RF:30'
                            },
                            {
                                id: '1133',
                                address: 'BidCoS-RF:31',
                                name: 'HM-RCV-50 BidCoS-RF:31'
                            },
                            {
                                id: '1137',
                                address: 'BidCoS-RF:32',
                                name: 'HM-RCV-50 BidCoS-RF:32'
                            },
                            {
                                id: '1141',
                                address: 'BidCoS-RF:33',
                                name: 'HM-RCV-50 BidCoS-RF:33'
                            },
                            {
                                id: '1145',
                                address: 'BidCoS-RF:34',
                                name: 'HM-RCV-50 BidCoS-RF:34'
                            },
                            {
                                id: '1149',
                                address: 'BidCoS-RF:35',
                                name: 'HM-RCV-50 BidCoS-RF:35'
                            },
                            {
                                id: '1153',
                                address: 'BidCoS-RF:36',
                                name: 'HM-RCV-50 BidCoS-RF:36'
                            },
                            {
                                id: '1157',
                                address: 'BidCoS-RF:37',
                                name: 'HM-RCV-50 BidCoS-RF:37'
                            },
                            {
                                id: '1161',
                                address: 'BidCoS-RF:38',
                                name: 'HM-RCV-50 BidCoS-RF:38'
                            },
                            {
                                id: '1165',
                                address: 'BidCoS-RF:39',
                                name: 'HM-RCV-50 BidCoS-RF:39'
                            },
                            {
                                id: '1169',
                                address: 'BidCoS-RF:40',
                                name: 'HM-RCV-50 BidCoS-RF:40'
                            },
                            {
                                id: '1173',
                                address: 'BidCoS-RF:41',
                                name: 'HM-RCV-50 BidCoS-RF:41'
                            },
                            {
                                id: '1177',
                                address: 'BidCoS-RF:42',
                                name: 'HM-RCV-50 BidCoS-RF:42'
                            },
                            {
                                id: '1181',
                                address: 'BidCoS-RF:43',
                                name: 'HM-RCV-50 BidCoS-RF:43'
                            },
                            {
                                id: '1185',
                                address: 'BidCoS-RF:44',
                                name: 'HM-RCV-50 BidCoS-RF:44'
                            },
                            {
                                id: '1189',
                                address: 'BidCoS-RF:45',
                                name: 'HM-RCV-50 BidCoS-RF:45'
                            },
                            {
                                id: '1193',
                                address: 'BidCoS-RF:46',
                                name: 'HM-RCV-50 BidCoS-RF:46'
                            },
                            {
                                id: '1197',
                                address: 'BidCoS-RF:47',
                                name: 'HM-RCV-50 BidCoS-RF:47'
                            },
                            {
                                id: '1201',
                                address: 'BidCoS-RF:48',
                                name: 'HM-RCV-50 BidCoS-RF:48'
                            },
                            {
                                id: '1205',
                                address: 'BidCoS-RF:49',
                                name: 'HM-RCV-50 BidCoS-RF:49'
                            },
                            {
                                id: '1209',
                                address: 'BidCoS-RF:50',
                                name: 'HM-RCV-50 BidCoS-RF:50'
                            },
                            {
                                id: '1759',
                                address: '001F58A992F2A6',
                                name: 'HmIP-RCV-50 001F58A992F2A6'
                            },
                            {
                                id: '1760',
                                address: '001F58A992F2A6:0',
                                name: 'HmIP-RCV-50 001F58A992F2A6:0'
                            },
                            {
                                id: '1761',
                                address: '001F58A992F2A6:1',
                                name: 'HmIP-RCV-50 001F58A992F2A6:1'
                            },
                            {
                                id: '1764',
                                address: '001F58A992F2A6:2',
                                name: 'HmIP-RCV-50 001F58A992F2A6:2'
                            },
                            {
                                id: '1767',
                                address: '001F58A992F2A6:3',
                                name: 'HmIP-RCV-50 001F58A992F2A6:3'
                            },
                            {
                                id: '1770',
                                address: '001F58A992F2A6:4',
                                name: 'HmIP-RCV-50 001F58A992F2A6:4'
                            },
                            {
                                id: '1773',
                                address: '001F58A992F2A6:5',
                                name: 'HmIP-RCV-50 001F58A992F2A6:5'
                            },
                            {
                                id: '1776',
                                address: '001F58A992F2A6:6',
                                name: 'HmIP-RCV-50 001F58A992F2A6:6'
                            },
                            {
                                id: '1779',
                                address: '001F58A992F2A6:7',
                                name: 'HmIP-RCV-50 001F58A992F2A6:7'
                            },
                            {
                                id: '1782',
                                address: '001F58A992F2A6:8',
                                name: 'HmIP-RCV-50 001F58A992F2A6:8'
                            },
                            {
                                id: '1785',
                                address: '001F58A992F2A6:9',
                                name: 'HmIP-RCV-50 001F58A992F2A6:9'
                            },
                            {
                                id: '1788',
                                address: '001F58A992F2A6:10',
                                name: 'HmIP-RCV-50 001F58A992F2A6:10'
                            },
                            {
                                id: '1791',
                                address: '001F58A992F2A6:11',
                                name: 'HmIP-RCV-50 001F58A992F2A6:11'
                            },
                            {
                                id: '1794',
                                address: '001F58A992F2A6:12',
                                name: 'HmIP-RCV-50 001F58A992F2A6:12'
                            },
                            {
                                id: '1797',
                                address: '001F58A992F2A6:13',
                                name: 'HmIP-RCV-50 001F58A992F2A6:13'
                            },
                            {
                                id: '1800',
                                address: '001F58A992F2A6:14',
                                name: 'HmIP-RCV-50 001F58A992F2A6:14'
                            },
                            {
                                id: '1803',
                                address: '001F58A992F2A6:15',
                                name: 'HmIP-RCV-50 001F58A992F2A6:15'
                            },
                            {
                                id: '1806',
                                address: '001F58A992F2A6:16',
                                name: 'HmIP-RCV-50 001F58A992F2A6:16'
                            },
                            {
                                id: '1809',
                                address: '001F58A992F2A6:17',
                                name: 'HmIP-RCV-50 001F58A992F2A6:17'
                            },
                            {
                                id: '1812',
                                address: '001F58A992F2A6:18',
                                name: 'HmIP-RCV-50 001F58A992F2A6:18'
                            },
                            {
                                id: '1815',
                                address: '001F58A992F2A6:19',
                                name: 'HmIP-RCV-50 001F58A992F2A6:19'
                            },
                            {
                                id: '1818',
                                address: '001F58A992F2A6:20',
                                name: 'HmIP-RCV-50 001F58A992F2A6:20'
                            },
                            {
                                id: '1821',
                                address: '001F58A992F2A6:21',
                                name: 'HmIP-RCV-50 001F58A992F2A6:21'
                            },
                            {
                                id: '1824',
                                address: '001F58A992F2A6:22',
                                name: 'HmIP-RCV-50 001F58A992F2A6:22'
                            },
                            {
                                id: '1827',
                                address: '001F58A992F2A6:23',
                                name: 'HmIP-RCV-50 001F58A992F2A6:23'
                            },
                            {
                                id: '1830',
                                address: '001F58A992F2A6:24',
                                name: 'HmIP-RCV-50 001F58A992F2A6:24'
                            },
                            {
                                id: '1833',
                                address: '001F58A992F2A6:25',
                                name: 'HmIP-RCV-50 001F58A992F2A6:25'
                            },
                            {
                                id: '1836',
                                address: '001F58A992F2A6:26',
                                name: 'HmIP-RCV-50 001F58A992F2A6:26'
                            },
                            {
                                id: '1839',
                                address: '001F58A992F2A6:27',
                                name: 'HmIP-RCV-50 001F58A992F2A6:27'
                            },
                            {
                                id: '1842',
                                address: '001F58A992F2A6:28',
                                name: 'HmIP-RCV-50 001F58A992F2A6:28'
                            },
                            {
                                id: '1845',
                                address: '001F58A992F2A6:29',
                                name: 'HmIP-RCV-50 001F58A992F2A6:29'
                            },
                            {
                                id: '1848',
                                address: '001F58A992F2A6:30',
                                name: 'HmIP-RCV-50 001F58A992F2A6:30'
                            },
                            {
                                id: '1851',
                                address: '001F58A992F2A6:31',
                                name: 'HmIP-RCV-50 001F58A992F2A6:31'
                            },
                            {
                                id: '1854',
                                address: '001F58A992F2A6:32',
                                name: 'HmIP-RCV-50 001F58A992F2A6:32'
                            },
                            {
                                id: '1857',
                                address: '001F58A992F2A6:33',
                                name: 'HmIP-RCV-50 001F58A992F2A6:33'
                            },
                            {
                                id: '1860',
                                address: '001F58A992F2A6:34',
                                name: 'HmIP-RCV-50 001F58A992F2A6:34'
                            },
                            {
                                id: '1863',
                                address: '001F58A992F2A6:35',
                                name: 'HmIP-RCV-50 001F58A992F2A6:35'
                            },
                            {
                                id: '1866',
                                address: '001F58A992F2A6:36',
                                name: 'HmIP-RCV-50 001F58A992F2A6:36'
                            },
                            {
                                id: '1869',
                                address: '001F58A992F2A6:37',
                                name: 'HmIP-RCV-50 001F58A992F2A6:37'
                            },
                            {
                                id: '1872',
                                address: '001F58A992F2A6:38',
                                name: 'HmIP-RCV-50 001F58A992F2A6:38'
                            },
                            {
                                id: '1875',
                                address: '001F58A992F2A6:39',
                                name: 'HmIP-RCV-50 001F58A992F2A6:39'
                            },
                            {
                                id: '1878',
                                address: '001F58A992F2A6:40',
                                name: 'HmIP-RCV-50 001F58A992F2A6:40'
                            },
                            {
                                id: '1881',
                                address: '001F58A992F2A6:41',
                                name: 'HmIP-RCV-50 001F58A992F2A6:41'
                            },
                            {
                                id: '1884',
                                address: '001F58A992F2A6:42',
                                name: 'HmIP-RCV-50 001F58A992F2A6:42'
                            },
                            {
                                id: '1887',
                                address: '001F58A992F2A6:43',
                                name: 'HmIP-RCV-50 001F58A992F2A6:43'
                            },
                            {
                                id: '1890',
                                address: '001F58A992F2A6:44',
                                name: 'HmIP-RCV-50 001F58A992F2A6:44'
                            },
                            {
                                id: '1893',
                                address: '001F58A992F2A6:45',
                                name: 'HmIP-RCV-50 001F58A992F2A6:45'
                            },
                            {
                                id: '1896',
                                address: '001F58A992F2A6:46',
                                name: 'HmIP-RCV-50 001F58A992F2A6:46'
                            },
                            {
                                id: '1899',
                                address: '001F58A992F2A6:47',
                                name: 'HmIP-RCV-50 001F58A992F2A6:47'
                            },
                            {
                                id: '1902',
                                address: '001F58A992F2A6:48',
                                name: 'HmIP-RCV-50 001F58A992F2A6:48'
                            },
                            {
                                id: '1905',
                                address: '001F58A992F2A6:49',
                                name: 'HmIP-RCV-50 001F58A992F2A6:49'
                            },
                            {
                                id: '1908',
                                address: '001F58A992F2A6:50',
                                name: 'HmIP-RCV-50 001F58A992F2A6:50'
                            }
                        ]);
                        done();
                    }
                });
            });

            it('should run functions.rega', function (done) {
                this.timeout(30000);
                rega.exec(`
!# functions.rega
!#
!# Dieses Script gibt eine Liste der Gewerke im JSON Format aus
!#
!# 9'2017 hobbyquaker
!# 6'2013-9'2013 bluefox, hobbyquaker
!#

object  oFunction;
string  sFunctionId;
string  sChannelId;
boolean bFirst       = true;
boolean bFirstSecond = true;

Write("[");

foreach (sFunctionId, dom.GetObject(ID_FUNCTIONS).EnumUsedIDs()) {

    if (bFirst == false) {
        WriteLine(',');
    } else {
        bFirst = false;
    }

    oFunction = dom.GetObject(sFunctionId);
    Write('{"id": "' # sFunctionId # '", "name": "' # oFunction.Name() # '", "channels": [');
    bFirstSecond = true;

    foreach(sChannelId, oFunction.EnumUsedIDs()) {
        if (bFirstSecond == false) {
            Write(',');
        } else {
            bFirstSecond = false;
        }
        Write(sChannelId);
    }

    Write(']}');
}

Write(']');
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        const data = JSON.parse(output);
                        data.should.deepEqual([
                            {id: '1220', name: 'funcButton', channels: []},
                            {
                                id: '1221',
                                name: 'funcCentral',
                                channels: [
                                    1013,
                                    1049,
                                    1053,
                                    1057,
                                    1061,
                                    1065,
                                    1069,
                                    1073,
                                    1077,
                                    1081,
                                    1085,
                                    1017,
                                    1089,
                                    1093,
                                    1097,
                                    1101,
                                    1105,
                                    1109,
                                    1113,
                                    1117,
                                    1121,
                                    1125,
                                    1021,
                                    1129,
                                    1133,
                                    1137,
                                    1141,
                                    1145,
                                    1149,
                                    1153,
                                    1157,
                                    1161,
                                    1165,
                                    1025,
                                    1169,
                                    1173,
                                    1177,
                                    1181,
                                    1185,
                                    1189,
                                    1193,
                                    1197,
                                    1201,
                                    1205,
                                    1029,
                                    1209,
                                    1033,
                                    1037,
                                    1041,
                                    1045,
                                    1760,
                                    1761,
                                    1788,
                                    1791,
                                    1794,
                                    1797,
                                    1800,
                                    1803,
                                    1806,
                                    1809,
                                    1812,
                                    1815,
                                    1764,
                                    1818,
                                    1821,
                                    1824,
                                    1827,
                                    1830,
                                    1833,
                                    1836,
                                    1839,
                                    1842,
                                    1845,
                                    1767,
                                    1848,
                                    1851,
                                    1854,
                                    1857,
                                    1860,
                                    1863,
                                    1866,
                                    1869,
                                    1872,
                                    1875,
                                    1770,
                                    1878,
                                    1881,
                                    1884,
                                    1887,
                                    1890,
                                    1893,
                                    1896,
                                    1899,
                                    1902,
                                    1905,
                                    1773,
                                    1908,
                                    1776,
                                    1779,
                                    1782,
                                    1785
                                ]
                            },
                            {id: '1215', name: 'funcClimateControl', channels: []},
                            {id: '1222', name: 'funcEnergy', channels: []},
                            {id: '1217', name: 'funcEnvironment', channels: []},
                            {id: '1214', name: 'funcHeating', channels: []},
                            {id: '1213', name: 'funcLight', channels: []},
                            {id: '1219', name: 'funcLock', channels: []},
                            {id: '1218', name: 'funcSecurity', channels: []},
                            {id: '1216', name: 'funcWeather', channels: []}
                        ]);
                        done();
                    }
                });
            });

            it('should run rooms.rega', function (done) {
                this.timeout(30000);
                rega.exec(`
!# rooms.rega
!#
!# Dieses Script gibt eine Liste der Raeume im JSON Format aus
!#
!# 9'2017 hobbyquaker
!# 5'2013-7'2013 bluefox, hobbyquaker
!#

object  oRoom;
string  sRoomId;
string  sChannelId;
boolean bFirst       = true;
boolean bFirstSecond = true;

Write("[");

foreach (sRoomId, dom.GetObject(ID_ROOMS).EnumUsedIDs()) {
    if (bFirst == false) {
        WriteLine(',');
    } else {
        bFirst = false;
    }

    oRoom = dom.GetObject(sRoomId);
    Write('{"id": "' # sRoomId # '", "name": "' # oRoom.Name() # '", ');
    Write('"channels":[');
    bFirstSecond = true;

    foreach(sChannelId, oRoom.EnumUsedIDs()) {
        if (bFirstSecond == false) {
            Write(',');
        } else {
            bFirstSecond = false;
        }
        Write(sChannelId);
    }

    Write(']}');
}

Write(']');
                `, function (error, output, objects) {
                    if (error) {
                        done(error);
                    } else {
                        const data = JSON.parse(output);
                        data.should.deepEqual([
                            {id: '1229', name: 'roomBathroom', channels: []},
                            {id: '1225', name: 'roomBedroom', channels: []},
                            {id: '1226', name: 'roomChildrensRoom1', channels: []},
                            {id: '1227', name: 'roomChildrensRoom2', channels: []},
                            {id: '1230', name: 'roomGarage', channels: []},
                            {id: '1232', name: 'roomGarden', channels: []},
                            {id: '1231', name: 'roomHWR', channels: []},
                            {id: '1224', name: 'roomKitchen', channels: []},
                            {id: '1223', name: 'roomLivingRoom', channels: []},
                            {id: '1228', name: 'roomOffice', channels: []},
                            {id: '1233', name: 'roomTerrace', channels: []}
                        ]);
                        done();
                    }
                });
            });
        });

        // cleanup test environment
        cleanupTest(flavor);
    });
});
