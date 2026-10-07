// Generates ReGa scripts which create programs (rules with conditions and
// destinations) and time modules the same way the WebUI does
// (/www/rega/esp/programs.fn, side.fn, system.fn).
//
//   programScript({
//       name: 'Test',
//       rules: [
//           {
//               // conditions: OR of AND groups ("Wenn ... und ... oder ...")
//               conditions: [[{sysvar: 'Num', compare: '>', value: 5, trigger: 'change'}]],
//               destinations: [{sysvar: 'Str', value: 'big', delay: 2}, {script: 'WriteLine(1);'}]
//           },
//           // further rules: "Sonst wenn" (with conditions) or "Sonst" (without)
//           {destinations: [{sysvar: 'Str', value: 'small'}]}
//       ]
//   })

// condition types and triggers of the script engine
const compareTypes = {
    '==': 5, range: 6, '>': 8, '>=': 9, '<': 10, '<=': 11
};
const triggers = {change: 4, update: 13, check: 15};

function literal(value) {
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }

    return String(value);
}

function conditionScript(condition, variable) {
    const lines = [];
    const trigger = triggers[condition.trigger || 'change'];
    if (trigger === undefined) {
        throw new Error('unknown trigger ' + condition.trigger);
    }

    if (condition.sysvar !== undefined) {
        const compare = condition.compare || '==';
        lines.push(
            `object ${variable}SV = dom.GetObject(${literal(condition.sysvar)});`,
            `${variable}.LeftValType(ivtSystemId);`,
            `${variable}.LeftVal(${variable}SV.ID());`
        );
        if (typeof condition.value === 'boolean') {
            // Binary system variables: "bei wahr/falsch"
            lines.push(`${variable}.ConditionType(1);`);
        } else if (compareTypes[compare] === undefined) {
            throw new Error('unknown comparison ' + compare);
        } else {
            lines.push(`${variable}.ConditionType(${compareTypes[compare]});`);
        }

        // (the values have the value type of the system variable)
        lines.push(
            `${variable}.RightVal1ValType(${variable}SV.ValueType());`,
            `${variable}.RightVal1(${literal(condition.value)});`
        );
        if (compare === 'range') {
            lines.push(
                `${variable}.RightVal2ValType(${variable}SV.ValueType());`,
                `${variable}.RightVal2(${literal(condition.value2)});`
            );
        }
    } else if (condition.datapoint !== undefined) {
        lines.push(
            `object ${variable}DP = dom.GetObject(${literal(condition.datapoint)});`,
            `${variable}.LeftValType(ivtObjectId);`,
            `${variable}.LeftVal(${variable}DP.ID());`,
            `${variable}.ConditionChannel(${variable}DP.Channel());`,
            `${variable}.ConditionType(1);`,
            `${variable}.RightVal1ValType(${variable}DP.ValueType());`,
            `${variable}.RightVal1(${literal(condition.value)});`
        );
    } else if (condition.timer === undefined) {
        throw new Error('condition without sysvar, datapoint or timer: ' + JSON.stringify(condition));
    } else {
        lines.push(
            `${variable}.LeftValType(ivtCurrentDate);`,
            `${variable}.RightVal1ValType(ivtObjectId);`,
            `${variable}.RightVal1(${condition.timer});`,
            `${variable}.ConditionType(3);`
        );
    }

    lines.push(`${variable}.ConditionType2(${trigger});`);
    return lines;
}

function destinationScript(destination, variable) {
    const lines = [];
    if (destination.sysvar !== undefined) {
        lines.push(
            `object ${variable}SV = dom.GetObject(${literal(destination.sysvar)});`,
            `${variable}.DestinationParam(ivtSystemId);`,
            `${variable}.DestinationDP(${variable}SV.ID());`,
            `${variable}.DestinationValueType(${variable}SV.ValueType());`,
            `${variable}.DestinationValue(${literal(destination.value)});`
        );
    } else if (destination.script !== undefined) {
        lines.push(
            `${variable}.DestinationParam(ivtString);`,
            `${variable}.DestinationValueType(ivtString);`,
            `${variable}.DestinationValue(${literal(destination.script)});`
        );
    } else if (destination.datapoint === undefined) {
        throw new Error('destination without sysvar, script or datapoint: ' + JSON.stringify(destination));
    } else {
        lines.push(
            `object ${variable}DP = dom.GetObject(${literal(destination.datapoint)});`,
            `${variable}.DestinationParam(ivtObjectId);`,
            `${variable}.DestinationChannel(${variable}DP.Channel());`,
            `${variable}.DestinationDP(${variable}DP.ID());`,
            `${variable}.DestinationValueType(${variable}DP.ValueType());`,
            `${variable}.DestinationValue(${literal(destination.value)});`
        );
    }

    if (destination.delay) {
        // (the delay is stored as 'HH:MM:SS', see SetDelay() in /www/rega/pages/tabs/admin/views/programs.htm)
        const pad = number => String(number).padStart(2, '0');
        const delay = pad(Math.floor(destination.delay / 3600)) + ':' + pad(Math.floor(destination.delay / 60) % 60) + ':' + pad(destination.delay % 60);
        lines.push(
            `${variable}.DestinationValueParamType(ivtDelay);`,
            `${variable}.DestinationValueParam(${literal(delay)});`
        );
    }

    return lines;
}

function ruleScript(rule, variable) {
    const lines = [];
    const groups = rule.conditions || [];
    for (const [groupIndex, group] of groups.entries()) {
        const cnd = `${variable}C${groupIndex}`;
        lines.push(
            `object ${cnd} = ${variable}.RuleAddCondition();`,
            // (conditions are combined with OR, their single conditions with AND)
            `${cnd}.CndOperatorType(2);`
        );
        for (const [index, condition] of group.entries()) {
            const single = `${cnd}S${index}`;
            lines.push(
                `object ${single} = ${cnd}.CndAddSingle();`,
                `${single}.OperatorType(1);`,
                ...conditionScript(condition, single)
            );
        }
    }

    const destination = `${variable}D`;
    lines.push(`object ${destination} = ${variable}.RuleDestination();`);
    if (rule.breakOnRestart !== undefined) {
        lines.push(`${destination}.BreakOnRestart(${rule.breakOnRestart});`);
    }

    for (const [index, single] of (rule.destinations || []).entries()) {
        const sd = `${destination}S${index}`;
        lines.push(`object ${sd} = ${destination}.DestAddSingle();`, ...destinationScript(single, sd));
    }

    return lines;
}

/**
 * Generates a script creating a program. The script writes the ID of the new
 * program.
 *
 * @param {object} program
 * @param {string} program.name
 * @param {object[]} program.rules - first rule: "Wenn", further rules: "Sonst wenn" or "Sonst"
 * @param {boolean} [program.active=true]
 * @returns {string}
 */
function programScript({name, rules, active = true}) {
    const lines = [
        `object prg = dom.CreateObject(OT_PROGRAM, ${literal(name)});`,
        'dom.GetObject(ID_PROGRAMS).Add(prg.ID());',
        `prg.Active(${active});`,
        'prg.Visible(true);',
        'object r0 = prg.Rule();'
    ];
    for (const [index, rule] of rules.entries()) {
        const variable = 'r' + index;
        if (index > 0) {
            lines.push(`object ${variable} = r${index - 1}.RuleCreateSubRule();`);
            if (!rule.conditions || rule.conditions.length === 0) {
                // "Sonst"
                lines.push(`r${index - 1}.ElseIfFlag(true);`);
            }
        }

        lines.push(...ruleScript(rule, variable));
    }

    // (activates the program, like the WebUI does after editing it)
    lines.push('prg.ProgramUpdate();', 'Write(prg.ID());');
    return lines.join('\n');
}

const timerTypes = {
    once: 'ttCalOnce', periodic: 'ttPeriodic', daily: 'ttCalDaily', weekly: 'ttCalWeekly', monthly: 'ttCalMonthly', yearly: 'ttCalYearly'
};
const sunOffsetTypes = {
    none: 'sotNone', beforeSunrise: 'sotBeforeSunrise', afterSunrise: 'sotAfterSunrise', beforeSunset: 'sotBeforeSunset', afterSunset: 'sotAfterSunset'
};

/**
 * Generates a script creating a time module (calendar datapoint). The script
 * writes the ID of the new time module.
 *
 * @param {object} timer
 * @param {string} [timer.name]
 * @param {string} timer.type - once, periodic, daily, weekly, monthly or yearly
 * @param {string} [timer.time] - time of the day (daily timers, e.g. '2007-01-01 07:30:00')
 *     or the offset to sunrise/sunset ('1970-01-01 01:05:00': 5 minutes, in CET)
 * @param {number} [timer.period] - period in seconds (periodic timers)
 * @param {string} [timer.sunOffset=none] - none, beforeSunrise, afterSunrise, beforeSunset or afterSunset
 * @param {object} [timer.properties] - further properties, e.g. {CalDuration: 60}
 * @returns {string}
 */
function timerScript({name = 'Zeitmodul', type, time, period, sunOffset = 'none', properties = {}}) {
    if (!timerTypes[type] || !sunOffsetTypes[sunOffset]) {
        throw new Error('unknown timer type ' + type + ' or sun offset ' + sunOffset);
    }

    const lines = [
        `object tm = dom.CreateObject(OT_CALENDARDP, ${literal(name)});`,
        'dom.GetObject(ID_CALENDARDPS).Add(tm);',
        `tm.TimerType(${timerTypes[type]});`,
        `tm.SunOffsetType(${sunOffsetTypes[sunOffset]});`
    ];
    if (time !== undefined) {
        lines.push(`tm.Time(${literal(time)});`);
    }

    if (period !== undefined) {
        lines.push(`tm.Period(${period});`);
    }

    for (const [key, value] of Object.entries(properties)) {
        lines.push(`tm.${key}(${literal(value)});`);
    }

    lines.push('Write(tm.ID());');
    return lines.join('\n');
}

module.exports = {
    programScript,
    timerScript,
    compareTypes,
    triggers
};
