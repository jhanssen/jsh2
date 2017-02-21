/*global require,module*/

module.exports = function(ast) {
    var out = "";
    if (ast.commands) {
        for (let i = 0; i < ast.commands.length; ++i) {
            out += this._generate(ast.commands[i]);
        }
    }
    if (ast.redirections) {
        console.error("handle redirections for compoundlist");
    }
    return out;
};
