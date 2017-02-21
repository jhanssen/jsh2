/*global require,module*/

function expand(generator, ast)
{
    const addify = (str) => {
        if (!str.length)
            return "";
        return ` + "${str}"`;
    };
    var out = '""';
    var cur = 0;
    for (var i = 0; i < ast.expansion.length; ++i) {
        var exp = ast.expansion[i];
        // put in text from cur to loc.start
        out += addify(ast.text.substr(cur, exp.loc.start - cur));
        // replace the characters with our expansion
        out += " + " + generator._generate(exp);
        cur = exp.loc.end + 1;
    }
    // add any remaining text
    out += addify(ast.text.substr(cur));
    return out;
}

module.exports = {
    expand: expand
};
