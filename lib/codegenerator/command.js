/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("let assignments = {};\n");
    out += this._i("jsh.assignments.push(assignments);\n");
    out += this._inc("let assign = (n) => {\n");
    out += this._i("var p = n.indexOf('=');\n");
    out += this._inc("if (p < 1)\n");
    out += this._i("throw new SyntaxError(`Invalid assignment ${n}`);\n");
    out += this._dec("assignments[n.substr(0, p)] = jsh.value(n.substr(p + 1));\n");
    out += this._dec("}\n");
    if (ast.prefix) {
        for (let i = 0; i < ast.prefix.length; ++i)
            out += this._generate(ast.prefix[i]);
    }
    out += this._inc("let cmdname = () => {\n");
    out += this._generate(ast.name);
    out += this._i("return out;\n");
    out += this._dec("};\n");
    if (ast.name) {
        out += this._i("let cmd = new jsh.Command(cmdname());\n");
        if (ast.suffix) {
            for (let i = 0; i < ast.suffix.length; ++i) {
                switch (ast.suffix[i].type) {
                case "Word":
                    // argument
                    out += this._inc("(() => {\n");
                    out += this._generate(ast.suffix[i]);
                    out += this._i("cmd.addArgument(jsh.value(out));\n");
                    out += this._dec("})();\n");
                    break;
                case "Redirect":
                    out += this._inc("(() => {\n");
                    out += this._generate(ast.suffix[i]);
                    out += this._i("cmd.redirect(out);\n");
                    out += this._dec("})();\n");
                    break;
                default:
                    console.error(`Unrecognized suffix for command ${ast.suffix[i].type}`);
                    break;
                }
            }
        }
        out += this._i("cmd.setAssignments(jsh.assignments.clone());\n");
        out += this._i("jsh.commands.add(cmd);\n");
    }
    out += this._i("jsh.assignments.pop();\n");
    out += this._dec("}\n");
    return out;
};
