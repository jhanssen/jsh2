/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("jsh.commands.push(new jsh.CommandRunner());\n");
    // run left, wait and see if we should run right
    out += this._inc("jsh.commands.subscribe((status) => {\n");
    if (ast.op == "and")
        out += this._inc("if (!status) {\n");
    else
        out += this._inc("if (status) {\n");
    out += this._generate(ast.right);
    out += this._dec("}\n");
    out += this._dec("});\n");
    out += this._generate(ast.left);
    out += this._i("jsh.commands.pop();\n");
    out += this._dec("}\n");
    return out;
};
