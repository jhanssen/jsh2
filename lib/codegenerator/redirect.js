/*global require,module*/

module.exports = function(ast) {
    var out = this._i(`let out = { op: "${ast.op.text}"`);

    if ("numberIo" in ast)
        out += `, io: ${ast.numberIo.text}`;

    out += " };\n";
    if (ast.file) {
        out += this._inc("out.file = (() => {\n");
        out += this._generate(ast.file);
        out += this._i("return out;\n");
        out += this._dec("})();\n");
    }
    return out;
};
