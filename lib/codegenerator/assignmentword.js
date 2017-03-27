/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    var name;
    var out = this._inc("{\n");
    out += this._inc("let assignmentWord = async function() {\n");
    if (ast.expansion) {
        out += utils.expand(this, ast);
        out += this._i("await assign(out);\n");
    } else {
        out += this._i(`await assign("${ast.text}");\n`);
    }
    out += this._dec("};\n");
    out += this._i("await assignmentWord();\n");
    out += this._dec("}\n");
    return out;
};
