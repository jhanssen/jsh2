/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("let newcommands = new jsh.CommandExpander(jsh.opts);\n");
    out += this._i("commands.addChildCommands(newcommands);\n");
    out += this._inc("{\n");
    out += this._i("let commands = newcommands;\n");
    for (var i = 0; i < ast.commandAST.commands.length; ++i) {
        out += this._generate(ast.commandAST.commands[i]);
    }
    out += this._i("let ret = commands.run(jsh);\n");
    out += this._inc("if (ret instanceof Promise) {\n");
    out += this._i("await ret;\n");
    out += this._dec("}\n");
    out += this._i("out += commands.stdout;\n");
    out += this._dec("}\n");
    out += this._dec("}\n");
    return out;
};
