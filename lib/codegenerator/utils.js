/*global require,module*/

function fixup(str, exp)
{
    let State = { Normal: 0, Escaped: 1, SingleQuote: 2, DoubleQuote: 3 };
    let state = [State.Normal];
    let lastState = () => {
        return state[state.length - 1];
    };
    let removeEscape = () => {
        if (lastState() == State.Escaped)
            state.pop();
    };
    let out = "";

    for (var i = 0; i < str.length; ++i) {
        switch (str[i]) {
        case '\\':
            if (lastState() == State.Normal) {
                out += "\\\\";
                state.push(State.Escaped);
            } else if (lastState() == State.Escaped) {
                out += "\\\\";
                state.pop();
            }
            break;
        case '"':
            if (lastState() == State.Normal) {
                if (!exp)
                    out += "\\\"";
                state.push(State.DoubleQuote);
            } else if (lastState() == State.DoubleQuote) {
                if (!exp)
                    out += "\\\"";
                state.pop();
            } else if (lastState() == State.Escaped) {
                out += "\\\"";
                state.pop();
            }
            break;
        case '\'':
            if (lastState() == State.Normal) {
                if (!exp)
                    out += "'";
                state.push(State.SingleQuote);
            } else if (lastState() == State.SingleQuote) {
                if (!exp)
                    out += "'";
                state.pop();
            } else if (lastState() == State.Escaped) {
                out += "\\\'";
                state.pop();
            }
            break;
        default:
            out += str[i];
            removeEscape();
            break;
        }
    }
    return out;
}

function expand(generator, ast)
{
    const addify = (str) => {
        if (!str.length)
            return '""';
        return `"${fixup(str, true)}"`;
    };
    var out = generator._i('let out = "";\n');
    var cur = 0;
    for (var i = 0; i < ast.expansion.length; ++i) {
        var exp = ast.expansion[i];
        // put in text from cur to loc.start
        out += generator._i("out += " + addify(ast.text.substr(cur, exp.loc.start - cur)) + ";\n");
        //a replace the characters with our expansion
        out += generator._generate(exp);
        cur = exp.loc.end + 1;
    }
    // add any remaining text
    var rem = addify(ast.text.substr(cur));
    if (rem.length > 2)
        out += generator._i("out += " + rem + ";\n");
    return out;
}

function splitString(generator, strname)
{
    var out = generator._i("let out;\n");
    out += generator._inc("{\n");
    out += generator._i("let ifs = jsh.expandAssignment('IFS');\n");
    out += generator._inc("if (!ifs || ifs == '') {\n");
    out += generator._i("ifs = '\\t\\n ';\n");
    out += generator._dec("}\n");
    out += generator._i("out = " + strname + ".split(new RegExp(`[${ifs}]+`, 'g'));\n");
    out += generator._dec("}\n");
    return out;
}

module.exports = {
    expand: expand,
    fixup: fixup,
    splitString: splitString
};
