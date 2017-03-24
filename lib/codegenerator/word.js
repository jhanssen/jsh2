/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    let globbed = utils.globbed(ast.text);
    if (globbed) {
        return this._i(`let out = new jsh.Glob("${globbed}");\n`);
    }
    if (!ast.expansion)
        return this._i(`let out = "${utils.fixup(ast.text)}";\n`);
    return utils.expand(this, ast);
};
