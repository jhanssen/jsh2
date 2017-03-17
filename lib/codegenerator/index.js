/*global require,module*/

function CodeGenerator()
{
    this._indent = 0;
}

CodeGenerator.types = {
    Script: require("./script"),
    Word: require("./word"),
    Pipeline: require("./pipeline"),
    Command: require("./command"),
    AssignmentWord: require("./assignmentword"),
    ParameterExpansion: require("./parameterexpansion"),
    CommandExpansion: require("./commandexpansion"),
    CompoundList: require("./compoundlist"),
    Redirect: require("./redirect"),
    Subshell: require("./subshell"),
    If: require("./if"),
    For: require("./for"),
    LogicalExpression: require("./logicalexpression")
};

CodeGenerator.prototype = {
    _indent: undefined,

    generate: function generate(ast, indent) {
        if (typeof indent === "number")
            this._indent = indent;
        var out = this._inc("module.exports = ((jsh) => {\n");
        out += this._generate(ast);
        return out + this._dec("});\n");
    },

    get indent() { return this._indent; },

    _generate: function _generate(ast) {
        if (ast.type in CodeGenerator.types) {
            var out = CodeGenerator.types[ast.type].call(this, ast);
            return out;
        } else {
            this._indent = 0;
            throw new SyntaxError(`Unrecognized ast type ${ast.type}`);
        }
        return "";
    },

    _i: function _i(str) {
        var i = "";
        for (var k = 0; k < this._indent; ++k)
            i += " ";
        return i + str;
    },

    _inc: function _inc(str) {
        var out = this._i(str);
        this._indent += 4;
        return out;
    },

    _dec: function _dec(str) {
        this._indent -= 4;
        return this._i(str);
    },

    _di: function _di(str) {
        this._indent -= 4;
        var out = this._i(str);
        this._indent += 4;
        return out;
    }
};

module.exports = CodeGenerator;
