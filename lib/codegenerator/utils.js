/*global require,module*/

function expand(generator, ast)
{
    const addify = (str) => {
        if (!str.length)
            return '""';
        return `"${str}"`;
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

module.exports = {
    expand: expand
};
