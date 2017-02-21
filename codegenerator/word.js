/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    if (!ast.expansion)
        return `"${ast.text}"`;
    return utils.expand(this, ast);
};
