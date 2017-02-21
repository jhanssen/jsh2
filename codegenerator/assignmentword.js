/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    var name;
    if (ast.expansion) {
        name = utils.expand(this, ast);
    } else {
        name = `"${ast.text}"`;
    }
    return this._i(`assign(${name});\n`);
};
