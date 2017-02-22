/*global require,module*/

module.exports = function(ast) {
    var out = this._i("let commands = new jsh.CommandRunner();\n");
    for (var i = 0; i < ast.commands.length; ++i) {
        out += this._generate(ast.commands[i]);
    }
    out += this._i("commands.run();\n");
    return out;
};
