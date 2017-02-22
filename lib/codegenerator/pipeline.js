/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("let commands = new jsh.CommandPipeline();\n");
    for (var i = 0; i < ast.commands.length; ++i) {
        out += this._generate(ast.commands[i]);
    }
    out += this._i("commands.run();\n");
    out += this._dec("}\n");
    return out;
};
