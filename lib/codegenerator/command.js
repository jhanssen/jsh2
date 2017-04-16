/*global require,module*/

module.exports = function(ast) {
    var out = this._inc("{\n");
    out += this._i("let assignments = {};\n");
    out += this._i("jsh.assignments.push(assignments);\n");
    out += this._inc("let assign = async function(n) {\n");
    out += this._i("var p = n.indexOf('=');\n");
    out += this._inc("if (p < 1) {\n");
    out += this._i("throw new SyntaxError(`Invalid assignment ${n}`);\n");
    out += this._dec("}\n");
    out += this._inc("{\n");
    out += this._i("let v = await jsh.value(n.substr(p + 1));\n");
    out += this._i("assignments[n.substr(0, p)] = v;\n");
    out += this._dec("}\n");
    out += this._dec("}\n");
    out += this._inc("let cmdname = async function() {\n");
    out += this._generate(ast.name);
    out += this._i("return out;\n");
    out += this._dec("};\n");
    if (ast.name) {
        out += this._i("let cmd = new jsh.Command(await cmdname(), ");
        out += (ast.async ? "true" : "false") + ");\n";
    } else {
        out += this._i("let cmd = undefined;\n");
    }
    if (ast.prefix) {
        for (let i = 0; i < ast.prefix.length; ++i) {
            switch (ast.prefix[i].type) {
            case "Redirect":
                out += this._inc("{\n");
                out += this._inc("let adder = async function() {\n");
                out += this._generate(ast.prefix[i]);
                out += this._i("cmd.addRedirect(out);\n");
                out += this._dec("};\n");
                out += this._i("if (cmd) await adder();\n");
                out += this._dec("}\n");
                break;
            default:
                out += this._generate(ast.prefix[i]);
                break;
            }
        }
    }
    if (ast.name) {
        if (ast.suffix) {
            for (let i = 0; i < ast.suffix.length; ++i) {
                out += this._inc("{\n");
                switch (ast.suffix[i].type) {
                case "Word":
                    // argument
                    out += this._inc("let adder = async function() {\n");
                    out += this._generate(ast.suffix[i]);
                    out += this._i("let v = await jsh.value(out);\n");
                    out += this._i("cmd.addArgument(v);\n");
                    out += this._dec("};\n");
                    break;
                case "Redirect":
                    out += this._inc("let adder = async function() {\n");
                    out += this._generate(ast.suffix[i]);
                    out += this._i("cmd.addRedirect(out);\n");
                    out += this._dec("};\n");
                    break;
                default:
                    console.error(`Unrecognized suffix for command ${ast.suffix[i].type}`);
                    break;
                }
                out += this._i("await adder();\n");
                out += this._dec("}\n");
            }
        }
        out += this._i("cmd.setAssignments(jsh.assignments.flatten());\n");
        out += this._i("commands.add(cmd);\n");
    }
    out += this._i("jsh.assignments.pop();\n");
    out += this._dec("}\n");
    return out;
};
