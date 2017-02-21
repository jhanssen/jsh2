/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    if (!ast.expansion)
        return this._i(`var out = "${ast.text}";\n`);
    return utils.expand(this, ast);
};
