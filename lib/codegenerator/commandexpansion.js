/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("let expander = { data: '' };\n");
    out += this._i("let waitfor = commands.waitFor(new jsh.CommandExpander(expander));\n");
    out += this._inc("{\n");
    out += this._i("let commands = waitfor;\n");
    for (var i = 0; i < ast.commandAST.commands.length; ++i) {
        out += this._generate(ast.commandAST.commands[i]);
    }
    out += this._dec("}\n");
    out += this._i("commands.run();\n");
    out += this._i("out += expander.data;\n");
    out += this._dec("}\n");
    return out;
};
