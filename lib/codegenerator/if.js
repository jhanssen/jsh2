/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._inc("let subkey = commands.subscribe((status) => {\n");
    out += this._i("commands.unsubscribe(subkey);\n");
    if (ast.then) {
        out += this._inc("if (!status) {\n");
        out += this.generate(ast.then);
        out += this._dec("}\n");
    }
    if (ast.else) {
        out += this._inc("if (status) {\n");
        out += this.generate(ast.else);
        out += this._dec("}\n");
    }
    out += this._dec("});\n");
    out += this.generate(ast.clause);
    out += this._dec("}\n");
    return out;
};
