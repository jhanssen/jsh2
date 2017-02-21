/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    var name;
    var out = this._inc("{\n");
    out += this._inc("(() => {\n");
    if (ast.expansion) {
        out += utils.expand(this, ast);
        out += this._i("assign(out);\n");
    } else {
        out += this._i(`assign("${ast.text}");\n`);
    }
    out += this._dec("})();\n");
    out += this._dec("}\n");
    return out;
};
