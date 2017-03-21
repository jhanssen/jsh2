/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    let out = this._inc("{\n");
    out += this._inc("let clause = (() => {\n");
    out += this._generate(ast.clause);
    out += this._i("return out;\n");
    out += this._dec("})();\n");
    out += this._i("let globs = [];\n");
    for (let idx = 0; idx < ast.cases.length; ++idx) {
        let c = ast.cases[idx];
        out += this._inc("{\n");
        out += this._i("let items = [];\n");
        for (let pidx = 0; pidx < c.pattern.length; ++pidx) {
            out += this._inc("(() => {\n");
            out += this._generate(c.pattern[pidx]);
            out += this._i("items.push(out);\n");
            out += this._dec("})();\n");
        }
        out += this._i("globs.push(items);\n");
        out += this._dec("}\n");
    }
    for (let idx = 0; idx < ast.cases.length; ++idx) {
        let c = ast.cases[idx];
        if (!idx)
            out += this._inc(`if (jsh.globMatch(clause, globs[${idx}])) {\n`);
        else
            out += this._inc(`else if (jsh.globMatch(clause, globs[${idx}])) {\n`);
        out += this._generate(c.body);
        out += this._dec("}\n");
    }
    out += this._dec("}\n");
    return out;
};
