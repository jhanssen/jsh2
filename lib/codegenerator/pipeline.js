/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("jsh.commands.push(new jsh.CommandPipeline());\n");
    for (var i = 0; i < ast.commands.length; ++i) {
        out += this._generate(ast.commands[i]);
    }
    out += this._i("jsh.commands.pop();\n");
    out += this._dec("}\n");
    return out;
};
