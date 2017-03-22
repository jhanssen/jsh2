/*global require,module*/
const utils = require("./utils");

module.exports = function(ast) {
    if (!ast.name || ast.name.type !== "Name") {
        throw "Invalid 'for', name not found";
    }
    let name = ast.name.text;
    var out = this._inc("{\n");
    out += this._i("let assignments = {};\n");
    out += this._i("jsh.assignments.push(assignments);\n");
    out += this._i("let words = [];\n");
    out += this._inc("let append = (item) => {\n");
    out += this._inc("if (item instanceof Array) {\n");
    out += this._i("words = words.concat(item);\n");
    out += this._di("} else if (typeof item === \"string\") {\n");
    out += utils.splitString(this, "item");
    out += this._i("words = words.concat(out);\n");
    out += this._di("} else {\n");
    out += this._i("words.push(item);\n");
    out += this._dec("}\n");
    out += this._dec("};\n");
    for (let i = 0; i < ast.wordlist.length; ++i) {
        out += this._inc("{\n");
        out += this._inc("let func = async function() {\n");
        out += this._generate(ast.wordlist[i]);
        out += this._i("return out;\n");
        out += this._dec("};\n");
        out += this._i("append(await func());\n");
        out += this._dec("}\n");
    }
    out += this._inc("for (let wordidx = 0; wordidx < words.length; ++wordidx) {\n");
    out += this._i(`assignments["${name}"] = words[wordidx];\n`);
    out += this._generate(ast.do);
    out += this._dec("}\n");
    out += this._i("jsh.assignments.pop();\n");
    out += this._dec("}\n");
    return out;
};
