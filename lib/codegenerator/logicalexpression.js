/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("let newcommands = new jsh.CommandRunner();\n");
    out += this._i("commands.addChildCommands(newcommands);\n");
    out += this._inc("{\n");
    out += this._i("let commands = newcommands;\n");
    // run left, wait and see if we should run right
    out += this._inc("let subkey = commands.subscribe((status) => {\n");
    out += this._i("commands.unsubscribe(subkey);\n");
    if (ast.op == "and")
        out += this._inc("if (!status) {\n");
    else
        out += this._inc("if (status) {\n");
    out += this._generate(ast.right);
    out += this._i("commands.run();\n");
    out += this._dec("}\n");
    out += this._dec("});\n");
    out += this._generate(ast.left);
    out += this._i("commands.run();\n");
    out += this._dec("}\n");
    out += this._dec("}\n");
    return out;
};
