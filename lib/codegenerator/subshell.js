/*global require,module*/

module.exports = function(ast) {
    const CodeGenerator = require("./index");
    var generator = new CodeGenerator();
    var out = this._inc("jsh.commands.add(new jsh.Subshell((jsh) => {\n");
    try {
        var sub = generator.generate({ type: "Script", commands: [ast.list] }, this.indent);
        out += sub;
    } catch (e) {
        throw e;
    };
    out += this._dec("}));\n");
    return out;
};
