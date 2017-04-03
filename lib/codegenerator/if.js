/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._inc("let subkey = commands.subscribe(async function(status) {\n");
    out += this._i("commands.unsubscribe(subkey);\n");
    if (ast.then) {
        out += this._inc("if (status === 0) {\n");
        out += this._i("let newcommands = new jsh.CommandRunner(jsh.opts);\n");
        out += this._i("newcommands.setParent(commands);\n");
        out += this._inc("{\n");
        out += this._i("let commands = newcommands;\n");
        out += this._generate(ast.then);
        out += this._i("commands.run(jsh);\n");
        out += this._dec("}\n");
        out += this._dec("}\n");
    }
    if (ast.else) {
        out += this._inc("if (status) {\n");
        out += this._i("let newcommands = new jsh.CommandRunner(jsh.opts);\n");
        out += this._i("newcommands.setParent(commands);\n");
        out += this._inc("{\n");
        out += this._i("let commands = newcommands;\n");
        out += this._generate(ast.else);
        out += this._i("commands.run(jsh);\n");
        out += this._dec("}\n");
        out += this._dec("}\n");
    }
    out += this._dec("});\n");
    out += this._generate(ast.clause);
    out += this._dec("}\n");
    return out;
};
