/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("let newcommands = new jsh.CommandPipeline(jsh.opts);\n");
    out += this._i("let isExpander = commands instanceof jsh.CommandExpander;\n");
    out += this._inc("if (!isExpander) {\n");
    out += this._i("commands.addChildCommands(newcommands);\n");
    out += this._dec("}\n");
    out += this._inc("{\n");
    out += this._i("let commands = newcommands;\n");
    for (var i = 0; i < ast.commands.length; ++i) {
        out += this._generate(ast.commands[i]);
    }
    out += this._inc("if (!isExpander) {\n");
    out += this._i("commands.run(jsh);\n");
    out += this._dec("}\n");
    out += this._dec("}\n");
    out += this._inc("if (isExpander) {\n");
    out += this._i("await commands.runPipeline(jsh, newcommands);\n");
    out += this._dec("}\n");
    out += this._dec("}\n");
    return out;
};
