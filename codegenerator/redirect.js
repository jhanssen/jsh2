/*global require,module*/

module.exports = function(ast) {
    var out = `{ op: "${ast.op.text}"`;

    if (ast.file)
        out += ", file: " + this._generate(ast.file);
    if ("numberIo" in ast)
        out += `, io: ${ast.numberIo.text}`;

    out += " }";
    return out;
};
